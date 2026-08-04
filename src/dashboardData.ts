import {
    getTestPlans,
    getSuites,
    getTestCases,
    getTestPoints,
    getTestRuns,
    getTestRunStatistics,
    getWorkItem,
    getWorkItems,
    extractWorkItemIds,
    buildWorkItemUrl,
    buildTestRunUrl,
    deleteTestCase,
    deleteTestCasesFromSuite,
} from "./azdo.js";
import type {
    TestCaseRow,
    Outcome,
    SuiteStat,
    RunCard,
    DashboardStats,
    TrendPoint,
    TestPlanSummary,
    TestSuiteSummary,
    TestCaseSummary,
    DeleteTestCaseItem,
    DeleteTestCasesResult,
} from "./types.js";

let dashboardCache: TestCaseRow[] | null = null;
let cacheTimestamp = 0;

const CACHE_DURATION_MS = 5 * 60 * 1000;

// Sprint 1 test execution kicked off on this date; runs before it are
// leftover data from prior activity and excluded from the execution trend.

const SPRINT_1_START_DATE = "2026-07-07";

export function getCacheTimestamp(): number {
    return cacheTimestamp;
}

// A test point's `results.outcome` can carry a stale/interim verdict (e.g.
// "passed") left over from a prior completed run even while the point's
// *current* result is still open - `results.lastResultState` is what
// actually reflects whether that latest result is finished, so it takes
// priority: only a "completed" result's outcome is trustworthy as
// Passed/Failed/etc, everything else maps to the in-limbo states below
// (verified against Azure's own Test Plans UI numbers for a suite where the
// two had diverged - see the "Test Agenti" suiteId/InProgress/Paused
// investigation this was added for).
export function resolveTestPointStatus(point: any): string {
    const lastResultState = point.results?.lastResultState;

    if (lastResultState == null) {
        return "notrun";
    }

    const normalized = String(lastResultState).toLowerCase();

    if (normalized === "completed") {
        return String(point.results?.outcome ?? "none").toLowerCase();
    }

    if (normalized === "pending") {
        return "inprogress";
    }

    // "inProgress" and "paused" (and any other in-limbo state Azure adds)
    // pass through as-is, to be matched by resolveOutcome() below.
    return normalized;
}

export function resolveOutcome(
    outcomes: string[]
): Outcome {
    const normalized = outcomes.map((o) =>
        o.toLowerCase()
    );

    if (normalized.length === 0) {
        return "NotRun";
    }

    if (normalized.includes("failed")) {
        return "Failed";
    }

    if (normalized.includes("blocked")) {
        return "Blocked";
    }

    if (normalized.includes("paused")) {
        return "Paused";
    }

    if (normalized.includes("inprogress")) {
        return "InProgress";
    }

    if (normalized.every((o) => o === "notapplicable")) {
        return "NotApplicable";
    }

    if (normalized.every((o) => o === "passed")) {
        return "Passed";
    }

    return "NotRun";
}

export async function buildTestCaseRow(
    tc: any,
    planName: string,
    suiteName: string,
    suiteId: number,
    outcomesByTestCase: Record<number, string[]>,
    lastRunByTestCase: Record<number, number>,
    planIteration?: string
): Promise<TestCaseRow> {
    const workItem = await getWorkItem(
        tc.workItem.id
    );

    const linkedIds = extractWorkItemIds(
        workItem.relations
    );

    const linkedItems = await getWorkItems(
        linkedIds
    );

    const bugs = linkedItems.filter(
        (item: any) =>
            item.fields[
            "System.WorkItemType"
            ] === "Bug"
    );

    const openBugs = bugs.filter(
        (b: any) =>
            b.fields["System.State"] !==
            "Closed"
    );

    const lastRunId =
        lastRunByTestCase[tc.workItem.id];

    return {
        planName,
        areaPath:
            workItem.fields[
            "System.AreaPath"
            ],
        iteration: planIteration,
        suiteName,
        suiteId,
        testCaseId: tc.workItem.id,
        testCaseTitle: tc.workItem.name,
        testCaseUrl:
            workItem._links?.html?.href,
        priority:
            workItem.fields[
            "Microsoft.VSTS.Common.Priority"
            ] ?? 4,
        hasOpenBugs: openBugs.length > 0,
        outcome: resolveOutcome(
            outcomesByTestCase[
            tc.workItem.id
            ] ?? []
        ),
        bugs: bugs.map((b: any) => ({
            id: b.id,
            title: b.fields["System.Title"],
            state: b.fields["System.State"],
            url: buildWorkItemUrl(b.id),
            creator: b.fields["System.CreatedBy"]?.displayName,
            assignee: b.fields["System.AssignedTo"]
                ? {
                    displayName:
                        b.fields["System.AssignedTo"].displayName,
                    uniqueName:
                        b.fields["System.AssignedTo"].uniqueName,
                }
                : undefined,
        })),
        lastRunId,
        lastRunUrl: lastRunId
            ? buildTestRunUrl(lastRunId)
            : undefined,
    };
}

interface SuiteTestPointIndex {
    outcomesByTestCase: Record<number, string[]>;
    lastRunByTestCase: Record<number, number>;
}

// Reduces a suite's raw test points down to, per test case: every recorded
// outcome (for pass/fail history) and the run ID of its most recently
// completed result (ties broken by dateCompleted, since a test case can be
// re-run and points don't come back in run order).
function indexSuiteTestPoints(testPoints: any[]): SuiteTestPointIndex {
    const outcomesByTestCase: Record<number, string[]> = {};
    const lastRunByTestCase: Record<number, number> = {};
    const lastRunDateByTestCase: Record<number, number> = {};

    for (const point of testPoints) {
        const tcId = point.testCaseReference?.id;

        if (tcId == null) {
            continue;
        }

        if (!outcomesByTestCase[tcId]) {
            outcomesByTestCase[tcId] = [];
        }

        outcomesByTestCase[tcId].push(
            resolveTestPointStatus(point)
        );

        const runId = point.results?.lastTestRunId;

        if (runId == null) {
            continue;
        }

        const completedDate = new Date(
            point.results?.lastResultDetails
                ?.dateCompleted ?? 0
        ).getTime();

        if (
            completedDate >=
            (lastRunDateByTestCase[tcId] ?? -1)
        ) {
            lastRunDateByTestCase[tcId] = completedDate;
            lastRunByTestCase[tcId] = runId;
        }
    }

    return { outcomesByTestCase, lastRunByTestCase };
}

export async function buildDashboard(): Promise<
    TestCaseRow[]
> {
    const plans = await getTestPlans();

    const allTestCases: TestCaseRow[] = [];

    for (const plan of plans) {
        const suites = await getSuites(plan.id);

        for (const suite of suites) {
            const testCases = await getTestCases(
                plan.id,
                suite.id
            );

            const testPoints = await getTestPoints(
                plan.id,
                suite.id
            );

            const { outcomesByTestCase, lastRunByTestCase } =
                indexSuiteTestPoints(testPoints);

            const rows = await Promise.all(
                testCases.map((tc: any) =>
                    buildTestCaseRow(
                        tc,
                        plan.name,
                        suite.name,
                        suite.id,
                        outcomesByTestCase,
                        lastRunByTestCase,
                        plan.iteration
                    )
                )
            );

            allTestCases.push(...rows);
        }
    }

    return allTestCases;
}

export async function getDashboardData(): Promise<
    TestCaseRow[]
> {
    const now = Date.now();

    if (
        dashboardCache &&
        now - cacheTimestamp <
        CACHE_DURATION_MS
    ) {
        console.log("CACHE HIT");
        return dashboardCache;
    }

    console.log("CACHE MISS");

    dashboardCache = await buildDashboard();
    cacheTimestamp = now;

    return dashboardCache;
}

export function clearDashboardCache(): void {
    dashboardCache = null;
    cacheTimestamp = 0;
}

export function computeDashboardStats(
    allTestCases: TestCaseRow[]
): DashboardStats {
    const grouped: Record<
        string,
        TestCaseRow[]
    > = {};

    for (const tc of allTestCases) {
        const key = String(tc.priority);

        if (!grouped[key]) {
            grouped[key] = [];
        }

        grouped[key].push(tc);
    }

    Object.keys(grouped).forEach(
        (priority) => {
            grouped[priority].sort((a, b) => {
                if (
                    a.hasOpenBugs &&
                    !b.hasOpenBugs
                ) {
                    return -1;
                }

                if (
                    !a.hasOpenBugs &&
                    b.hasOpenBugs
                ) {
                    return 1;
                }

                return a.testCaseTitle.localeCompare(
                    b.testCaseTitle
                );
            });
        }
    );

    const areaPaths = [
        ...new Set(
            allTestCases
                .map((tc) => tc.areaPath)
                .filter(Boolean)
        ),
    ].sort((a, b) => a.localeCompare(b));

    const suites = [
        ...new Set(
            allTestCases.map(
                (tc) => tc.suiteName
            )
        ),
    ].sort((a, b) => a.localeCompare(b));

    const priorities = [
        ...new Set(
            allTestCases.map(
                (tc) => tc.priority
            )
        ),
    ].sort((a, b) => a - b);

    const totalTestCases = allTestCases.length;

    const withOpenBugs = allTestCases.filter(
        (tc) => tc.hasOpenBugs
    ).length;

    const withoutOpenBugs =
        totalTestCases - withOpenBugs;

    const passedCount = allTestCases.filter(
        (tc) => tc.outcome === "Passed"
    ).length;

    const failedCount = allTestCases.filter(
        (tc) => tc.outcome === "Failed"
    ).length;

    const blockedCount = allTestCases.filter(
        (tc) => tc.outcome === "Blocked"
    ).length;

    const notApplicableCount = allTestCases.filter(
        (tc) => tc.outcome === "NotApplicable"
    ).length;

    const notRunCount = allTestCases.filter(
        (tc) => tc.outcome === "NotRun"
    ).length;

    const executedCount =
        passedCount + failedCount + blockedCount;

    const passRate = totalTestCases
        ? Math.round(
            (passedCount / totalTestCases) * 1000
        ) / 10
        : 0;

    return {
        areaPaths,
        suites,
        priorities,
        totalTestCases,
        withOpenBugs,
        withoutOpenBugs,
        passedCount,
        failedCount,
        blockedCount,
        notApplicableCount,
        notRunCount,
        executedCount,
        passRate,
        groupedByPriority: grouped,
    };
}

export function computeSuiteStats(
    allTestCases: TestCaseRow[]
): Record<string, SuiteStat> {
    const suiteStats: Record<
        string,
        SuiteStat
    > = {};

    for (const tc of allTestCases) {
        if (!suiteStats[tc.suiteName]) {
            suiteStats[tc.suiteName] = {
                total: 0,
                passed: 0,
                failed: 0,
                blocked: 0,
                notApplicable: 0,
                notRun: 0,
                openBugs: 0,
            };
        }

        const stat = suiteStats[tc.suiteName];

        stat.total++;

        if (tc.outcome === "Passed") {
            stat.passed++;
        } else if (tc.outcome === "Failed") {
            stat.failed++;
        } else if (tc.outcome === "Blocked") {
            stat.blocked++;
        } else if (tc.outcome === "NotApplicable") {
            stat.notApplicable++;
        } else {
            stat.notRun++;
        }

        if (tc.hasOpenBugs) {
            stat.openBugs++;
        }
    }

    return suiteStats;
}

function summarizeRunStats(
    stats: any[]
): {
    counts: Record<Outcome, number>;
    total: number;
    passRate: number;
} {
    const counts: Record<Outcome, number> = {
        Passed: 0,
        Failed: 0,
        Blocked: 0,
        NotApplicable: 0,
        Paused: 0,
        InProgress: 0,
        NotRun: 0,
    };

    for (const s of stats) {
        const outcome = (
            s.outcome ?? ""
        ).toLowerCase();

        if (outcome === "passed") {
            counts.Passed += s.count;
        } else if (outcome === "failed") {
            counts.Failed += s.count;
        } else if (outcome === "blocked") {
            counts.Blocked += s.count;
        } else if (outcome === "notapplicable") {
            counts.NotApplicable += s.count;
        } else {
            counts.NotRun += s.count;
        }
    }

    const total =
        counts.Passed +
        counts.Failed +
        counts.Blocked +
        counts.NotApplicable +
        counts.NotRun;

    const passRate = total
        ? Math.round(
            (counts.Passed / total) * 1000
        ) / 10
        : 0;

    return { counts, total, passRate };
}

export async function computeTestPlans(): Promise<
    TestPlanSummary[]
> {
    const plans = await getTestPlans();

    const org = process.env.AZDO_ORG;
    const project = encodeURIComponent(
        process.env.AZDO_PROJECT!
    );

    return plans.map((plan: any): TestPlanSummary => ({
        id: plan.id,
        name: plan.name,
        url: `https://dev.azure.com/${org}/${project}/_testPlans/define?planId=${plan.id}&suiteId=${plan.rootSuite?.id ?? plan.id}`,
        areaPath: plan.areaPath,
        iteration: plan.iteration,
        state: plan.state,
        owner: plan.owner?.displayName,
    }));
}

export async function computePlanSuites(
    planId: number
): Promise<TestSuiteSummary[]> {
    const suites = await getSuites(planId);

    const testCasesBySuiteId = new Map<
        number,
        TestCaseSummary[]
    >(
        await Promise.all(
            suites.map(
                async (
                    suite: any
                ): Promise<
                    [number, TestCaseSummary[]]
                > => {
                    const testCases =
                        await getTestCases(
                            planId,
                            suite.id
                        );

                    return [
                        suite.id,
                        testCases.map((tc: any) => ({
                            id: tc.workItem.id,
                            title: tc.workItem.name,
                            suiteId: suite.id,
                        })),
                    ];
                }
            )
        )
    );

    const nodesById = new Map<
        number,
        TestSuiteSummary
    >(
        suites.map((suite: any) => [
            suite.id,
            {
                id: suite.id,
                name: suite.name,
                testCases:
                    testCasesBySuiteId.get(suite.id) ??
                    [],
                children: [],
            },
        ])
    );

    const roots: TestSuiteSummary[] = [];

    for (const suite of suites) {
        const node = nodesById.get(suite.id)!;
        const parentId = suite.parentSuite?.id;
        const parentNode = parentId
            ? nodesById.get(parentId)
            : undefined;

        if (parentNode) {
            parentNode.children.push(node);
        } else {
            roots.push(node);
        }
    }

    if (
        roots.length === 1 &&
        roots[0].children.length > 0
    ) {
        return roots[0].children;
    }

    return roots;
}

export async function computeRunCards(): Promise<
    RunCard[]
> {
    const runs = await getTestRuns();

    const last10 = [...runs]
        .sort((a: any, b: any) => {
            const aDate = new Date(
                a.completedDate ??
                a.startedDate
            ).getTime();

            const bDate = new Date(
                b.completedDate ??
                b.startedDate
            ).getTime();

            return bDate - aDate;
        })
        .slice(0, 10);

    const cards = await Promise.all(
        last10.map(
            async (run: any): Promise<RunCard | null> => {
                const stats =
                    await getTestRunStatistics(
                        run.id
                    );

                // A null result means Azure DevOps no longer has this run
                // (it lingers in the runs list after deletion) - drop it
                // rather than showing a phantom zeroed-out card.
                if (stats === null) {
                    return null;
                }

                const { counts, total, passRate } =
                    summarizeRunStats(stats);

                return {
                    id: run.id,
                    name: run.name,
                    state: run.state,
                    startedDate:
                        run.startedDate,
                    completedDate:
                        run.completedDate,
                    url: run.webAccessUrl,
                    counts,
                    total,
                    passRate,
                };
            }
        )
    );

    return cards.filter(
        (card): card is RunCard => card !== null
    );
}

export async function computeExecutionTrend(): Promise<
    TrendPoint[]
> {
    const runs = await getTestRuns();

    const runStatsWithNulls = await Promise.all(
        runs.map(async (run: any) => {
            const stats = await getTestRunStatistics(
                run.id
            );

            // See computeRunCards: a null result means the run no longer
            // exists in Azure DevOps despite still appearing in the runs
            // list, so it's excluded from the trend entirely.
            if (stats === null) {
                return null;
            }

            return {
                run,
                ...summarizeRunStats(stats),
            };
        })
    );

    const runStats = runStatsWithNulls.filter(
        (entry): entry is NonNullable<typeof entry> =>
            entry !== null
    );

    const byDate = new Map<
        string,
        {
            passed: number;
            failed: number;
            blocked: number;
            notApplicable: number;
            notRun: number;
        }
    >();

    for (const { run, counts } of runStats) {
        const rawDate =
            run.completedDate ?? run.startedDate;

        if (!rawDate) {
            continue;
        }

        const date = new Date(rawDate)
            .toISOString()
            .slice(0, 10);

        if (date < SPRINT_1_START_DATE) {
            continue;
        }

        const bucket = byDate.get(date) ?? {
            passed: 0,
            failed: 0,
            blocked: 0,
            notApplicable: 0,
            notRun: 0,
        };

        bucket.passed += counts.Passed;
        bucket.failed += counts.Failed;
        bucket.blocked += counts.Blocked;
        bucket.notApplicable += counts.NotApplicable;
        bucket.notRun += counts.NotRun;

        byDate.set(date, bucket);
    }

    let cumulativeExecuted = 0;

    return [...byDate.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((date): TrendPoint => {
            const bucket = byDate.get(date)!;

            const total =
                bucket.passed +
                bucket.failed +
                bucket.blocked +
                bucket.notApplicable +
                bucket.notRun;

            cumulativeExecuted +=
                bucket.passed +
                bucket.failed +
                bucket.blocked;

            const passRate = total
                ? Math.round(
                    (bucket.passed / total) * 1000
                ) / 10
                : 0;

            return {
                date,
                total,
                passed: bucket.passed,
                failed: bucket.failed,
                blocked: bucket.blocked,
                notApplicable: bucket.notApplicable,
                notRun: bucket.notRun,
                passRate,
                cumulativeExecuted,
            };
        });
}

export async function deleteTestCases(
    items: DeleteTestCaseItem[]
): Promise<DeleteTestCasesResult> {
    // Unlinking from the suite is what actually makes the test case
    // disappear from the suite tree the UI renders (see the comment on
    // deleteTestCasesFromSuite) - items sharing a (planId, suiteId) are
    // batched into a single unlink request.
    const groups = new Map<
        string,
        { planId: number; suiteId: number; testCaseIds: number[] }
    >();

    for (const item of items) {
        const key = `${item.planId}:${item.suiteId}`;
        const group = groups.get(key);

        if (group) {
            group.testCaseIds.push(item.testCaseId);
        } else {
            groups.set(key, {
                planId: item.planId,
                suiteId: item.suiteId,
                testCaseIds: [item.testCaseId],
            });
        }
    }

    const groupList = [...groups.values()];

    const unlinkResults = await Promise.allSettled(
        groupList.map((group) =>
            deleteTestCasesFromSuite(
                group.planId,
                group.suiteId,
                group.testCaseIds
            )
        )
    );

    const deleted: number[] = [];
    const failed: { id: number; message: string }[] = [];

    unlinkResults.forEach((result, index) => {
        const group = groupList[index];

        if (result.status === "fulfilled") {
            deleted.push(...group.testCaseIds);
        } else {
            const message =
                result.reason?.message ?? "Unknown error";

            for (const testCaseId of group.testCaseIds) {
                failed.push({ id: testCaseId, message });
            }
        }
    });

    // Best-effort permanent delete of the underlying work item now that it's
    // unlinked from the suite. A failure here doesn't change the outcome
    // reported to the caller - the test case already no longer appears in
    // the suite, which is what the UI promised.
    await Promise.allSettled(
        deleted.map((id) => deleteTestCase(id))
    );

    if (deleted.length > 0) {
        clearDashboardCache();
    }

    return { deleted, failed };
}
