// Server-side reimplementation of the "QA Control Center" Azure DevOps
// dashboard widget (a custom marketplace extension, gregorio-qa.qa-control-
// center-widget) - ported from its client-side qa-data.js/widget.js so the
// same execution-velocity/forecast/workload model can render inside this
// app instead of only inside an ADO dashboard iframe (which ADO itself
// blocks from being embedded cross-origin - see TeamDashboardPage.tsx).
//
// This is a v1: any plan/suite can be pointed at (not just the one fixed
// dashboard instance), but the widget's configurable knobs (complexity
// field/mapping, base hours, per-filter outcome/tester/configuration,
// adaptive-estimate toggle) are fixed at the widget's own defaults rather
// than exposed as UI - see DEFAULT_SETTINGS below.
import {
    getTestPointsRecursive,
    getWorkItems,
    getBugWorkItemTypeStates,
    getTestRunsForPlan,
    getTestRunResults,
    getTestPlan,
    getSuites,
} from "./azdo.js";
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";
import type {
    QaControlCenterResponse,
    QaControlCenterTeamMember,
    QaControlCenterTrendDay,
    QaTrendStatus,
} from "./types.js";

const CACHE_DURATION_MS = 5 * 60 * 1000;
const cache = new Map<
    string,
    { data: QaControlCenterResponse; timestamp: number }
>();

interface Settings {
    outcome: "all" | "pending" | "failed" | "passed" | "inconclusive";
    tester: string;
    configuration: string;
    automation: "all" | "manual" | "automated";
    complexityField: string;
    complexityMapping: string;
    baseHours: number;
    adaptiveEstimates: boolean;
    calibrationDays: number;
    lookbackDays: number;
    healthThreshold: number;
}

// Matches qa-data.js's `defaults` object exactly (the widget's own factory
// settings), except `automation` - the one live dashboard instance this was
// reverse-engineered from overrides it to "manual", but the widget's own
// default (and the more broadly useful one for a generic replica) is "all".
const DEFAULT_SETTINGS: Settings = {
    outcome: "all",
    tester: "all",
    configuration: "",
    automation: "all",
    complexityField: "",
    complexityMapping: "Very Low=0.5;Low=0.75;Medium=1.5;High=3;Very High=4",
    baseHours: 1,
    adaptiveEstimates: true,
    calibrationDays: 30,
    lookbackDays: 7,
    healthThreshold: 90,
};

interface Entry {
    point: any;
    caseId: number;
    caseItem: any;
    weight: number;
    bugs: any[];
    activeBugs: any[];
}

function testCaseId(point: any): number {
    return Number(
        point.testCaseReference?.id ?? point.testCase?.id ?? 0
    );
}

function linkedWorkItemId(relation: any): number {
    const match = String(relation?.url ?? "").match(/\/workItems\/(\d+)/i);
    return match ? Number(match[1]) : 0;
}

function parseComplexityMapping(text: string): Record<string, number> {
    const mapping: Record<string, number> = {};

    for (const pair of String(text || "").split(";")) {
        const parts = pair.split("=");
        if (parts.length !== 2) continue;
        const weight = Number(parts[1].trim().replace(",", "."));
        if (parts[0].trim() && isFinite(weight) && weight > 0) {
            mapping[parts[0].trim().toLowerCase()] = weight;
        }
    }

    return mapping;
}

function complexityWeight(workItem: any, settings: Settings): number {
    const baseHours = Math.max(0.1, Number(settings.baseHours) || 1);
    if (!settings.complexityField || !workItem?.fields) return baseHours;

    const value = workItem.fields[settings.complexityField];
    if (value == null || value === "") return baseHours;

    const numeric = Number(String(value).replace(",", "."));
    if (isFinite(numeric) && numeric > 0) return numeric;

    const mapping = parseComplexityMapping(settings.complexityMapping);
    return mapping[String(value).trim().toLowerCase()] ?? baseHours;
}

function isActiveBug(bug: any): boolean {
    const category = bug?._stateCategory;
    return category !== "Completed" && category !== "Removed";
}

async function enrichPoints(
    points: any[],
    settings: Settings,
    project: string | undefined
): Promise<Entry[]> {
    const caseIds = [
        ...new Set(points.map(testCaseId).filter((id) => id > 0)),
    ];

    const caseItems = await getWorkItems(caseIds, undefined, project, {
        expand: "relations",
    });
    const casesById = new Map<number, any>(
        caseItems.map((item: any) => [item.id, item])
    );

    const relatedIds = [
        ...new Set(
            caseItems.flatMap((item: any) =>
                (item.relations ?? [])
                    .map(linkedWorkItemId)
                    .filter((id: number) => id > 0 && !casesById.has(id))
            )
        ),
    ];

    const relatedItems = await getWorkItems(
        relatedIds,
        ["System.Id", "System.WorkItemType", "System.State", "System.Title"],
        project
    );
    const bugItems = relatedItems.filter(
        (item: any) =>
            String(item.fields?.["System.WorkItemType"] ?? "").toLowerCase() ===
            "bug"
    );

    const bugStates = await getBugWorkItemTypeStates(project);
    const categoryByState = new Map<string, string>(
        bugStates.map((s) => [s.name.toLowerCase(), s.category])
    );
    const bugsById = new Map<number, any>(
        bugItems.map((item: any) => {
            const state = String(item.fields?.["System.State"] ?? "").toLowerCase();
            item._stateCategory = categoryByState.get(state) ?? "InProgress";
            return [item.id, item];
        })
    );

    return points.map((point: any): Entry => {
        const caseId = testCaseId(point) || point.id;
        const caseItem = casesById.get(caseId);
        const bugs: any[] = [];
        for (const relation of caseItem?.relations ?? []) {
            const bug = bugsById.get(linkedWorkItemId(relation));
            if (bug && !bugs.some((b) => b.id === bug.id)) bugs.push(bug);
        }

        return {
            point,
            caseId,
            caseItem,
            weight: complexityWeight(caseItem, settings),
            bugs,
            activeBugs: bugs.filter(isActiveBug),
        };
    });
}

// Rolling 7-day windows covering `days` back from now, same shape as
// qa-data.js's queryRuns - the /test/runs list endpoint's date filter is
// most reliable over short windows, so a long lookback is split into
// several parallel window queries rather than one wide one.
async function queryRuns(
    planId: number,
    settings: Settings,
    project: string | undefined
): Promise<any[]> {
    const workingDays = Math.max(1, Math.min(30, settings.lookbackDays || 7));
    const forecastCalendarDays = Math.ceil((workingDays * 7) / 5) + 3;
    const days = Math.max(
        1,
        Math.min(
            60,
            Math.max(
                forecastCalendarDays,
                settings.adaptiveEstimates ? settings.calibrationDays || 30 : 0
            )
        )
    );

    const finalEnd = new Date();
    const finalStart = new Date(finalEnd.getTime() - days * 86400000);
    const windows: { start: Date; end: Date }[] = [];
    let end = finalEnd;
    while (end.getTime() > finalStart.getTime()) {
        const start = new Date(
            Math.max(finalStart.getTime(), end.getTime() - 7 * 86400000 + 1000)
        );
        windows.push({ start, end });
        end = new Date(start.getTime() - 1000);
    }

    const batches = await Promise.all(
        windows.map((w) => getTestRunsForPlan(planId, w.start, w.end, project))
    );

    const byId = new Map<number, any>();
    for (const run of batches.flat()) byId.set(run.id, run);

    return [...byId.values()].sort(
        (a, b) =>
            new Date(b.completedDate ?? b.lastUpdatedDate).getTime() -
            new Date(a.completedDate ?? a.lastUpdatedDate).getTime()
    );
}

async function loadHistory(
    planId: number,
    settings: Settings,
    entries: Entry[],
    project: string | undefined
): Promise<{
    history: any[];
    truncated: boolean;
    fallback: boolean;
    error?: string;
}> {
    const allowedPoints = new Set(entries.map((e) => Number(e.point.id)));

    try {
        const runs = await queryRuns(planId, settings, project);
        const truncated = runs.length > 100;
        const selectedRuns = runs.slice(0, 100);

        const batches = await mapWithConcurrency(selectedRuns, 5, (run) =>
            getTestRunResults(run.id, project, { includePoints: true })
        );

        const history = batches
            .flat()
            .filter((result: any) =>
                allowedPoints.has(Number(result.testPoint?.id ?? 0))
            );

        return { history, truncated, fallback: false };
    } catch (error: any) {
        return {
            history: [],
            truncated: false,
            fallback: true,
            error: error?.message ?? String(error),
        };
    }
}

function pointOutcome(entry: Entry): string {
    return String(
        entry.point.results?.outcome ?? entry.point.outcome ?? "none"
    ).toLowerCase();
}

const PENDING_OUTCOMES = new Set([
    "none",
    "unspecified",
    "notexecuted",
    "not run",
    "active",
    "inprogress",
    "paused",
    "notimpacted",
    "not impacted",
]);
const FAILED_OUTCOMES = new Set([
    "failed",
    "inconclusive",
    "aborted",
    "timeout",
    "error",
]);

function isPending(outcome: string): boolean {
    return PENDING_OUTCOMES.has(outcome);
}
function isNotApplicable(outcome: string): boolean {
    return outcome === "notapplicable" || outcome === "not applicable";
}
function isPassed(outcome: string): boolean {
    return outcome === "passed";
}
function isFailed(outcome: string): boolean {
    return FAILED_OUTCOMES.has(outcome);
}
function isBlocked(outcome: string): boolean {
    return outcome === "blocked";
}
function isExecuted(outcome: string): boolean {
    return !isPending(outcome) && !isNotApplicable(outcome);
}

function testerInfo(entry: Entry): { key: string; name: string } {
    const tester = entry.point.tester ?? entry.point.testCaseReference?.assignedTo;
    let displayName = tester?.displayName;
    const isUnassigned =
        !displayName || /^(unassigned|non assegnato)$/i.test(String(displayName).trim());
    const key = isUnassigned
        ? "__unassigned__"
        : String(tester?.uniqueName ?? tester?.id ?? displayName);
    displayName = isUnassigned ? "Unassigned" : displayName;
    return { key: key.toLowerCase(), name: displayName };
}

function contains(value: unknown, filter: string): boolean {
    return (
        !filter ||
        String(value ?? "").toLowerCase().includes(filter.toLowerCase())
    );
}

function matches(entry: Entry, settings: Settings): boolean {
    const outcome = pointOutcome(entry);
    const tester = testerInfo(entry);

    if (
        settings.tester &&
        settings.tester !== "all" &&
        tester.key !== settings.tester.toLowerCase()
    )
        return false;
    if (settings.outcome === "pending" && !isPending(outcome)) return false;
    if (settings.outcome === "failed" && !isFailed(outcome)) return false;
    if (settings.outcome === "passed" && !isPassed(outcome)) return false;
    if (settings.outcome === "inconclusive" && outcome !== "inconclusive")
        return false;
    if (!contains(entry.point.configuration?.name, settings.configuration))
        return false;
    if (settings.automation === "manual" && entry.point.isAutomated)
        return false;
    if (settings.automation === "automated" && !entry.point.isAutomated)
        return false;

    return true;
}

function dayStart(value: Date | string | number): Date {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dateKey(value: Date | string | number): string {
    const d = dayStart(value);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function isWorkingDay(date: Date): boolean {
    return date.getDay() !== 0 && date.getDay() !== 6;
}

interface Activity {
    date: Date;
    weight: number;
    caseId: number;
}

function uniqueCaseIdsForDay(activity: Activity[], date: Date): string[] {
    const key = dateKey(date);
    const ids = new Set<string>();
    for (const item of activity) {
        if (dateKey(item.date) === key) ids.add(String(item.caseId));
    }
    return [...ids];
}

interface ForecastDay {
    date: Date;
    count: number;
    caseIds: string[];
}

interface Forecast {
    tomorrow: Date;
    predicted: number;
    weightedAverage: number;
    days: ForecastDay[];
    samples: number;
    trend: QaTrendStatus;
    isTomorrowWorkingDay: boolean;
}

function historicalForecast(
    activity: Activity[],
    remainingCases: number,
    lookbackDays: number
): Forecast {
    const today = dayStart(new Date());
    const days: ForecastDay[] = [];
    const requestedWorkingDays = Math.max(1, Math.min(30, lookbackDays || 7));
    const cursor = new Date(today.getTime());

    while (days.length < requestedWorkingDays) {
        cursor.setDate(cursor.getDate() - 1);
        if (isWorkingDay(cursor)) {
            const date = new Date(cursor.getTime());
            const caseIds = uniqueCaseIdsForDay(activity, date);
            days.unshift({ date, count: caseIds.length, caseIds });
        }
    }

    let weightedTotal = 0;
    let weightTotal = 0;
    let total = 0;
    days.forEach((day, index) => {
        const weight = index + 1;
        weightedTotal += day.count * weight;
        weightTotal += weight;
        total += day.count;
    });
    const weightedAverage = weightTotal ? weightedTotal / weightTotal : 0;

    const tomorrow = new Date(today.getTime());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrowWorkingDay = isWorkingDay(tomorrow);
    const predicted = Math.max(
        0,
        Math.min(
            remainingCases,
            isTomorrowWorkingDay ? Math.round(weightedAverage) : 0
        )
    );

    const split = Math.max(1, Math.floor(days.length / 2));
    const older = days.slice(0, days.length - split);
    const recent = days.slice(days.length - split);
    const average = (values: ForecastDay[]) =>
        values.length
            ? values.reduce((sum, d) => sum + d.count, 0) / values.length
            : 0;
    const olderAverage = average(older);
    const recentAverage = average(recent);

    let trend: QaTrendStatus = "stable";
    if (days.length < 3 || total === 0) trend = "limitedData";
    else if (recentAverage > olderAverage + 0.5) trend = "up";
    else if (recentAverage + 0.5 < olderAverage) trend = "down";

    return {
        tomorrow,
        predicted,
        weightedAverage,
        days,
        samples: days.length,
        trend,
        isTomorrowWorkingDay,
    };
}

interface Calibration {
    factor: number;
    samples: number;
}

// Median of (observed manual-run duration ÷ estimated weight) over the
// calibration window, blended toward gradually as samples accumulate (full
// weight only once >= 3 case samples exist) - same as qa-data.js's
// calibrateEstimate. Automated points never feed or receive this factor.
function calibrateEstimate(
    entries: Entry[],
    history: any[],
    settings: Settings,
    historyFallback: boolean
): Calibration {
    const neutral: Calibration = { factor: 1, samples: 0 };
    if (!settings.adaptiveEstimates || historyFallback || !history.length)
        return neutral;

    const byPoint = new Map<number, Entry>();
    for (const entry of entries) {
        if (!entry.point.isAutomated) byPoint.set(Number(entry.point.id), entry);
    }

    const days = Math.max(1, Math.min(30, settings.calibrationDays || 30));
    const cutoff = Date.now() - days * 86400000;
    const newestByCase = new Map<string, { completed: Date; ratio: number }>();

    for (const result of history) {
        const entry = byPoint.get(Number(result.testPoint?.id ?? 0));
        const completed = new Date(result.completedDate ?? "");
        const duration = Number(result.durationInMs);
        if (
            !entry ||
            !isExecuted(String(result.outcome ?? "none").toLowerCase()) ||
            !isFinite(duration) ||
            duration < 2 * 60000 ||
            duration > 8 * 3600000 ||
            isNaN(completed.getTime()) ||
            completed.getTime() < cutoff
        )
            continue;

        const caseId = String(entry.caseId);
        const existing = newestByCase.get(caseId);
        if (!existing || completed > existing.completed) {
            newestByCase.set(caseId, {
                completed,
                ratio: duration / 3600000 / entry.weight,
            });
        }
    }

    const ratios = [...newestByCase.values()]
        .map((v) => v.ratio)
        .sort((a, b) => a - b);
    if (!ratios.length) return neutral;

    const middle = Math.floor(ratios.length / 2);
    let median = ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
    median = Math.max(0.25, Math.min(4, median));

    return {
        factor: 1 + (median - 1) * Math.min(1, ratios.length / 3),
        samples: ratios.length,
    };
}

interface CaseAggregate {
    id: number;
    remaining: boolean;
    unassigned: boolean;
    passed: boolean;
    failed: boolean;
    blocked: boolean;
    pending: boolean;
    otherExecuted: boolean;
    notApplicable: boolean;
    executed: boolean;
    status:
        | "failed"
        | "blocked"
        | "partial"
        | "other"
        | "passed"
        | "notApplicable"
        | "pending";
}

interface TeamAggregate {
    key: string;
    name: string;
    assignedCases: Set<number>;
    remainingCases: Set<number>;
    effort: number;
}

function buildModel(
    allEntries: Entry[],
    settings: Settings,
    history: any[],
    historyFallback: boolean
) {
    const entries = allEntries.filter((e) => matches(e, settings));
    const calibration = calibrateEstimate(entries, history, settings, historyFallback);

    let passed = 0,
        failed = 0,
        blocked = 0,
        pending = 0,
        partial = 0,
        other = 0,
        notApplicable = 0;
    let remainingEffort = 0;

    const cases = new Map<
        number,
        {
            id: number;
            remaining: boolean;
            unassigned: boolean;
            passed: boolean;
            failed: boolean;
            blocked: boolean;
            pending: boolean;
            otherExecuted: boolean;
            notApplicable: boolean;
        }
    >();
    const team = new Map<string, TeamAggregate>();
    const entriesByPoint = new Map<number, Entry>();
    const activity: Activity[] = [];
    const historyBugsByPoint = new Map<number, any[]>();

    for (const entry of entries) {
        const estimate = entry.point.isAutomated
            ? entry.weight
            : entry.weight * calibration.factor;
        const outcome = pointOutcome(entry);
        const tester = testerInfo(entry);
        const needsWork = !isPassed(outcome) && !isNotApplicable(outcome);

        entriesByPoint.set(Number(entry.point.id), entry);
        if (needsWork) remainingEffort += estimate;

        if (!cases.has(entry.caseId)) {
            cases.set(entry.caseId, {
                id: entry.caseId,
                remaining: false,
                unassigned: false,
                passed: false,
                failed: false,
                blocked: false,
                pending: false,
                otherExecuted: false,
                notApplicable: false,
            });
        }
        const c = cases.get(entry.caseId)!;
        c.remaining = c.remaining || needsWork;
        c.unassigned = c.unassigned || (needsWork && tester.key === "__unassigned__");
        if (isPassed(outcome)) c.passed = true;
        else if (isNotApplicable(outcome)) c.notApplicable = true;
        else if (isBlocked(outcome)) c.blocked = true;
        else if (isFailed(outcome)) c.failed = true;
        else if (isPending(outcome)) c.pending = true;
        else c.otherExecuted = true;

        if (!team.has(tester.key)) {
            team.set(tester.key, {
                key: tester.key,
                name: tester.name,
                assignedCases: new Set(),
                remainingCases: new Set(),
                effort: 0,
            });
        }
        const t = team.get(tester.key)!;
        t.assignedCases.add(entry.caseId);
        if (needsWork) {
            t.remainingCases.add(entry.caseId);
            t.effort += estimate;
        }
    }

    if (!historyFallback) {
        for (const result of history) {
            const pointId = Number(result.testPoint?.id ?? 0);
            const entry = entriesByPoint.get(pointId);
            const completed = result.completedDate ?? result.lastUpdatedDate;
            const outcome = String(result.outcome ?? "none").toLowerCase();
            if (!entry || !completed || !isExecuted(outcome)) continue;

            const date = new Date(completed);
            if (isNaN(date.getTime())) continue;

            const observedEstimate = entry.point.isAutomated
                ? entry.weight
                : entry.weight * calibration.factor;
            activity.push({ date, weight: observedEstimate, caseId: entry.caseId });

            if (!historyBugsByPoint.has(pointId)) historyBugsByPoint.set(pointId, []);
            const bugs = result.associatedBugs ?? [];
            historyBugsByPoint.get(pointId)!.push(...bugs);
        }
    } else {
        for (const entry of entries) {
            const outcome = pointOutcome(entry);
            const details = entry.point.results?.lastResultDetails;
            const completed = details?.dateCompleted ? new Date(details.dateCompleted) : null;
            if (!completed || isNaN(completed.getTime()) || !isExecuted(outcome)) continue;
            activity.push({ date: completed, weight: entry.weight, caseId: entry.caseId });
        }
    }

    // Governance: a failed/blocked case is "blocked by bug" if it has a bug
    // still Proposed/InProgress, "ready for retest" if its only relevant
    // bugs are Resolved/Completed, else (failed with no usable bug) flagged
    // as failed-without-bug.
    const openBugs = new Map<number, any>();
    const blockedCaseIds = new Set<number>();
    const retestCaseIds = new Set<number>();
    const failedWithoutBugCaseIds = new Set<number>();
    const bugsByCase = new Map<number, Map<number, any>>();

    for (const entry of entries) {
        const outcome = pointOutcome(entry);
        if (!isFailed(outcome) && !isBlocked(outcome)) continue;
        if (!bugsByCase.has(entry.caseId)) bugsByCase.set(entry.caseId, new Map());
        const bucket = bugsByCase.get(entry.caseId)!;
        for (const bug of [
            ...entry.bugs,
            ...(historyBugsByPoint.get(Number(entry.point.id)) ?? []),
        ]) {
            if (bug?.id) bucket.set(bug.id, bug);
        }
    }

    for (const [caseId, c] of cases) {
        if (!c.failed && !c.blocked) continue;
        const bugs = [...(bugsByCase.get(caseId)?.values() ?? [])].filter(
            (bug) => bug._stateCategory !== "Removed"
        );
        const blocking = bugs.filter(
            (bug) => bug._stateCategory === "Proposed" || bug._stateCategory === "InProgress"
        );
        blocking.forEach((bug) => openBugs.set(bug.id, bug));
        if (blocking.length) blockedCaseIds.add(caseId);
        else if (
            bugs.some(
                (bug) => bug._stateCategory === "Resolved" || bug._stateCategory === "Completed"
            )
        )
            retestCaseIds.add(caseId);
        else if (c.failed) failedWithoutBugCaseIds.add(caseId);
    }

    const caseList: CaseAggregate[] = [...cases.values()].map((c) => {
        const executed = c.passed || c.failed || c.blocked || c.otherExecuted;
        let status: CaseAggregate["status"];
        if (c.failed) {
            status = "failed";
            failed += 1;
        } else if (c.blocked) {
            status = "blocked";
            blocked += 1;
        } else if (executed && c.pending) {
            status = "partial";
            partial += 1;
        } else if (c.otherExecuted) {
            status = "other";
            other += 1;
        } else if (c.passed) {
            status = "passed";
            passed += 1;
        } else if (c.notApplicable) {
            status = "notApplicable";
            notApplicable += 1;
        } else {
            status = "pending";
            pending += 1;
        }
        return { ...c, executed, status };
    });

    const remainingCases = caseList.filter((c) => c.remaining).length;
    const unassignedCount = caseList.filter((c) => c.remaining && c.unassigned).length;
    const executedCases = caseList.filter((c) => c.executed).length;
    const passRatePct = executedCases ? Math.round((passed / executedCases) * 100) : 0;
    const executionRatePct = caseList.length
        ? Math.round((executedCases / caseList.length) * 100)
        : 0;

    const yesterday = dayStart(new Date());
    yesterday.setDate(yesterday.getDate() - 1);
    const todayCaseIds = uniqueCaseIdsForDay(activity, new Date());
    const yesterdayCaseIds = uniqueCaseIdsForDay(activity, yesterday);
    const forecast = historicalForecast(activity, remainingCases, settings.lookbackDays);

    const team_: QaControlCenterTeamMember[] = [...team.values()]
        .map((member): QaControlCenterTeamMember => {
            const assigned = member.assignedCases.size;
            const remaining = member.remainingCases.size;
            return {
                key: member.key,
                name: member.name,
                assigned,
                remaining,
                effortHours: Math.round(member.effort * 100) / 100,
                completionPct: assigned
                    ? Math.round(((assigned - remaining) / assigned) * 100)
                    : 0,
            };
        })
        .sort((a, b) => {
            if (a.key === "__unassigned__") return -1;
            if (b.key === "__unassigned__") return 1;
            return b.remaining - a.remaining;
        });

    return {
        totalCases: caseList.length,
        remainingCases,
        unassignedCount,
        passed,
        failed,
        blocked,
        pending,
        partial,
        other,
        notApplicable,
        executedCases,
        executionRatePct,
        passRatePct,
        todayCases: todayCaseIds.length,
        yesterdayCases: yesterdayCaseIds.length,
        tomorrowForecast: forecast.predicted,
        tomorrowIsWorkingDay: forecast.isTomorrowWorkingDay,
        historicalAveragePerDay: Math.round(forecast.weightedAverage * 100) / 100,
        historicalSamples: forecast.samples,
        trendStatus: forecast.trend,
        tomorrow: forecast.tomorrow,
        remainingEffortHours: Math.round(remainingEffort * 100) / 100,
        calibrationFactor: Math.round(calibration.factor * 100) / 100,
        calibrationSamples: calibration.samples,
        team: team_,
        openBugs: openBugs.size,
        blockedByBug: blockedCaseIds.size,
        readyForRetest: retestCaseIds.size,
        failedWithoutBug: failedWithoutBugCaseIds.size,
        activity,
    };
}

function buildTrend(
    activity: Activity[],
    tomorrow: Date,
    tomorrowForecast: number
): QaControlCenterTrendDay[] {
    const today = dayStart(new Date());
    const days: { date: Date; key: string; count: number; forecast: boolean }[] = [];

    for (let index = 5; index >= 0; index -= 1) {
        const date = new Date(today.getTime() - index * 86400000);
        days.push({ date, key: dateKey(date), count: 0, forecast: false });
    }
    days.push({
        date: tomorrow,
        key: dateKey(tomorrow),
        count: tomorrowForecast,
        forecast: true,
    });

    const countsByDay = new Map<string, Set<string>>();
    for (const item of activity) {
        const key = dateKey(item.date);
        if (!countsByDay.has(key)) countsByDay.set(key, new Set());
        countsByDay.get(key)!.add(String(item.caseId));
    }

    for (const day of days) {
        if (!day.forecast) day.count = countsByDay.get(day.key)?.size ?? 0;
    }

    return days.map((d) => ({
        date: d.date.toISOString(),
        count: d.count,
        forecast: d.forecast,
    }));
}

async function computeQaControlCenter(
    planId: number,
    suiteId: number,
    project: string | undefined,
    includeChildren: boolean
): Promise<QaControlCenterResponse> {
    const settings = { ...DEFAULT_SETTINGS };

    const [plan, suites, points] = await Promise.all([
        getTestPlan(planId, project),
        getSuites(planId, project),
        getTestPointsRecursive(planId, suiteId, project, includeChildren),
    ]);
    const suite = suites.find((s: any) => s.id === suiteId);

    const entries = await enrichPoints(points, settings, project);
    const historyData = await loadHistory(planId, settings, entries, project);

    const model = buildModel(entries, settings, historyData.history, historyData.fallback);
    const trend = buildTrend(model.activity, model.tomorrow, model.tomorrowForecast);

    return {
        planId,
        planName: plan?.name ?? String(planId),
        suiteId,
        suiteName: suite?.name ?? String(suiteId),
        generatedAt: new Date().toISOString(),

        totalCases: model.totalCases,
        remainingCases: model.remainingCases,
        unassignedCount: model.unassignedCount,

        passed: model.passed,
        failed: model.failed,
        blocked: model.blocked,
        pending: model.pending,
        partial: model.partial,
        other: model.other,
        notApplicable: model.notApplicable,
        executedCases: model.executedCases,
        executionRatePct: model.executionRatePct,
        passRatePct: model.passRatePct,
        healthThreshold: settings.healthThreshold,

        todayCases: model.todayCases,
        yesterdayCases: model.yesterdayCases,
        tomorrowForecast: model.tomorrowForecast,
        tomorrowIsWorkingDay: model.tomorrowIsWorkingDay,
        historicalAveragePerDay: model.historicalAveragePerDay,
        historicalSamples: model.historicalSamples,
        trendStatus: model.trendStatus,
        trend,

        remainingEffortHours: model.remainingEffortHours,
        calibrationFactor: model.calibrationFactor,
        calibrationSamples: model.calibrationSamples,

        team: model.team,

        openBugs: model.openBugs,
        blockedByBug: model.blockedByBug,
        readyForRetest: model.readyForRetest,
        failedWithoutBug: model.failedWithoutBug,

        historyTruncated: historyData.truncated,
        historyFallback: historyData.fallback,
        historyError: historyData.error,
    };
}

export async function getQaControlCenter(
    planId: number,
    suiteId: number,
    project: string | undefined,
    includeChildren: boolean
): Promise<QaControlCenterResponse> {
    const cacheKey = `${project ?? ""}:${planId}:${suiteId}:${includeChildren}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`qaControlCenter:${cacheKey}`, async () => {
        const fresh = cache.get(cacheKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const data = await computeQaControlCenter(
            planId,
            suiteId,
            project,
            includeChildren
        );
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    });
}

export function clearQaControlCenterCache(): void {
    cache.clear();
}
