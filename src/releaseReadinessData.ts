import {
    getDashboardData,
    computeDashboardStats,
    computeExecutionTrend,
} from "./dashboardData.js";
import { getDefectData } from "./defectData.js";
import { getCurrentSprint, getPreviousSprint } from "./sprints.js";
import { getIterations, type IterationNode } from "./azdo.js";
import type {
    TrendPoint,
    DefectRecord,
    TestCaseRow,
    ReleaseReadinessResponse,
    ReleaseGateSummary,
    ReleaseGateCriterion,
    SprintCompletion,
    PassRateDelta,
    BlockingDefectsSummary,
    SprintInfo,
} from "./types.js";

const CACHE_DURATION_MS = 5 * 60 * 1000;

// Keyed by the selected iteration path ("" for the no-selection default
// view), since each selection scopes to different data.
const cache = new Map<
    string,
    { data: ReleaseReadinessResponse; timestamp: number }
>();

export function clearReleaseReadinessCache(): void {
    cache.clear();
}

// Which test plans feed the release gate's completion/pass-rate criteria -
// matches "Test Funzionali" and "UAT" plans (e.g. "Front Office Auto -
// Sprint 1 - Test Funzionali" / "... - UAT"). Excludes other plans such as
// "Test DSI", which is owned by a different team and out of scope for this
// gate (code_coverage.md: "Owner esecuzione: Test Factory Esterna"). Defect
// counts are intentionally left unscoped - bugs aren't reliably linked to a
// single test plan the way test cases are.
const FUNCTIONAL_PLAN_NAME_PATTERN = /\b(test funzionali|uat)\b/i;

function isFunctionalTestPlan(planName: string): boolean {
    return FUNCTIONAL_PLAN_NAME_PATTERN.test(planName);
}

function envNumber(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);

    return Number.isFinite(parsed) ? parsed : fallback;
}

// Reproduces the org's formal exit-criteria checklist (code_coverage.md,
// "Criteri di Accettazione - Test Funzionali Manuali"). The doc gates
// defects by Priority (P1-P4), but this project's Azure DevOps data barely
// populates Priority (almost every bug is "Priority 2") while Severity
// ("1 - Critical" .. "4 - Low") is the field the team actually maintains -
// so the P1/P2 BLOCK / P3/P4 WARN rows are mapped onto Severity instead.
function buildGateCriteria(
    completion: SprintCompletion,
    testsPassedPct: number | null,
    testCaseRelevancePct: number | null,
    severityOpenCounts: Record<"1 - Critical" | "2 - High" | "3 - Medium" | "4 - Low", number>
): ReleaseGateCriterion[] {
    const testsExecutedTarget = envNumber(
        "RELEASE_GATE_TESTS_EXECUTED_TARGET_PCT",
        100
    );
    const testsPassedTarget = envNumber(
        "RELEASE_GATE_TESTS_PASSED_TARGET_PCT",
        95
    );
    const requirementsCoverageTarget = envNumber(
        "RELEASE_GATE_REQUIREMENTS_COVERAGE_TARGET_PCT",
        95
    );
    const testCaseRelevanceTarget = envNumber(
        "RELEASE_GATE_TEST_CASE_RELEVANCE_TARGET_PCT",
        0
    );

    return [
        {
            id: "testsExecuted",
            action: "block",
            target: `${testsExecutedTarget}%`,
            actual: `${completion.completionRatePct}%`,
            tracked: true,
            passed: completion.completionRatePct >= testsExecutedTarget,
        },
        {
            id: "testsPassed",
            action: "block",
            target: `${testsPassedTarget}%`,
            actual: testsPassedPct != null ? `${testsPassedPct}%` : null,
            tracked: testsPassedPct != null,
            passed: testsPassedPct != null && testsPassedPct >= testsPassedTarget,
        },
        {
            id: "requirementsCoverage",
            action: "block",
            target: `${requirementsCoverageTarget}%`,
            actual: null,
            tracked: false,
            passed: false,
        },
        {
            id: "testCaseRelevance",
            action: "block",
            target: `${testCaseRelevanceTarget}%`,
            actual: testCaseRelevancePct != null ? `${testCaseRelevancePct}%` : null,
            tracked: testCaseRelevancePct != null,
            passed:
                testCaseRelevancePct != null &&
                testCaseRelevancePct <= testCaseRelevanceTarget,
        },
        {
            id: "criticalDefectsOpen",
            action: "block",
            target: "0",
            actual: String(severityOpenCounts["1 - Critical"]),
            tracked: true,
            passed: severityOpenCounts["1 - Critical"] === 0,
        },
        {
            id: "highDefectsOpen",
            action: "block",
            target: "0",
            actual: String(severityOpenCounts["2 - High"]),
            tracked: true,
            passed: severityOpenCounts["2 - High"] === 0,
        },
        {
            id: "mediumDefectsOpen",
            action: "warn",
            target: "tracked",
            actual: String(severityOpenCounts["3 - Medium"]),
            tracked: true,
            passed: severityOpenCounts["3 - Medium"] === 0,
        },
        {
            id: "lowDefectsOpen",
            action: "warn",
            target: "tracked",
            actual: String(severityOpenCounts["4 - Low"]),
            tracked: true,
            passed: severityOpenCounts["4 - Low"] === 0,
        },
    ];
}

function computeReleaseGate(criteria: ReleaseGateCriterion[]): ReleaseGateSummary {
    const trackedCriteria = criteria.filter((c) => c.tracked);

    const hasBlockFailure = trackedCriteria.some(
        (c) => c.action === "block" && !c.passed
    );
    const hasWarnFailure = trackedCriteria.some(
        (c) => c.action === "warn" && !c.passed
    );

    return {
        ragStatus: hasBlockFailure ? "red" : hasWarnFailure ? "amber" : "green",
        criteria,
        trackedCount: trackedCriteria.length,
        passingCount: trackedCriteria.filter((c) => c.passed).length,
    };
}

// Aggregates the daily execution trend into a single pass rate for the given
// [startDate, endDate] window, used as the per-sprint pass rate since there's
// no separate sprint-scoped execution dataset.
function sprintPassRateFromTrend(
    trend: TrendPoint[],
    startDate: string,
    endDate: string
): number | null {
    const inRange = trend.filter(
        (p) => p.date >= startDate && p.date <= endDate
    );

    const totalExecuted = inRange.reduce(
        (sum, p) => sum + p.passed + p.failed + p.blocked,
        0
    );
    const totalPassed = inRange.reduce((sum, p) => sum + p.passed, 0);

    if (totalExecuted === 0) {
        return null;
    }

    return Math.round((totalPassed / totalExecuted) * 1000) / 10;
}

function computePassRateDelta(
    trend: TrendPoint[],
    sprint: SprintInfo,
    previousSprint: SprintInfo | null
): PassRateDelta {
    const currentSprintPassRate = sprintPassRateFromTrend(
        trend,
        sprint.startDate,
        sprint.endDate
    );
    const previousSprintPassRate = previousSprint
        ? sprintPassRateFromTrend(
              trend,
              previousSprint.startDate,
              previousSprint.endDate
          )
        : null;

    return {
        currentSprintPassRate,
        previousSprintPassRate,
        deltaPct:
            currentSprintPassRate != null && previousSprintPassRate != null
                ? Math.round(
                      (currentSprintPassRate - previousSprintPassRate) * 10
                  ) / 10
                : null,
        previousSprintName: previousSprint?.name ?? null,
    };
}

// Pass rate for a specific sprint's own test cases (NA excluded from both
// sides, same as testsPassedPct above) - used instead of
// sprintPassRateFromTrend's date-range approximation whenever a real
// iteration is selected, since sprint date windows commonly overlap (see
// computeReleaseReadiness) and would otherwise mix in another sprint's
// executions that just happened to complete in the same window.
function scopedPassRatePct(testCases: TestCaseRow[]): number | null {
    const stats = computeDashboardStats(testCases);

    return stats.executedCount
        ? Math.round((stats.passedCount / stats.executedCount) * 1000) / 10
        : null;
}

// previousSprint.id is only a real iteration path (string) when it was
// resolved from the live iteration tree (see resolveSprint) - which is
// always true here, since this only runs when `iteration` was provided.
function buildScopedPassRateDelta(
    currentSprintPassRate: number | null,
    previousSprint: SprintInfo | null,
    functionalTestCases: TestCaseRow[]
): PassRateDelta {
    const previousSprintPassRate =
        previousSprint && typeof previousSprint.id === "string"
            ? scopedPassRatePct(
                  functionalTestCases.filter(
                      (tc) => tc.iteration === previousSprint.id
                  )
              )
            : null;

    return {
        currentSprintPassRate,
        previousSprintPassRate,
        deltaPct:
            currentSprintPassRate != null && previousSprintPassRate != null
                ? Math.round(
                      (currentSprintPassRate - previousSprintPassRate) * 10
                  ) / 10
                : null,
        previousSprintName: previousSprint?.name ?? null,
    };
}

function todayDateString(): string {
    return new Date().toISOString().slice(0, 10);
}

function toDateOnly(iso: string | null): string {
    return iso ? iso.slice(0, 10) : "";
}

const SPRINT_NODE_NAME_PATTERN = /^Sprint\s+\d+$/i;

// Builds the SprintInfo shown for a specific, real Azure DevOps iteration
// the user picked from the dropdown - distinct from the hand-maintained
// SPRINTS calendar in sprints.ts, which only backs the no-selection default
// view below.
function sprintInfoFromIterationNode(node: IterationNode): SprintInfo {
    const endDate = toDateOnly(node.finishDate);

    return {
        id: node.path,
        name: node.name,
        startDate: toDateOnly(node.startDate),
        endDate,
        hasEnded: endDate ? todayDateString() > endDate : false,
    };
}

// Finds the sprint-named iteration immediately preceding `node` by start
// date, for the pass-rate delta - mirrors getPreviousSprint()'s array-order
// logic in sprints.ts, but over real iteration nodes (which can span
// multiple unrelated projects/areas, hence restricting to "Sprint N" names
// with a start date rather than every node in the tree).
function findPreviousIterationNode(
    nodes: IterationNode[],
    node: IterationNode
): IterationNode | null {
    const dated = nodes
        .filter((n) => SPRINT_NODE_NAME_PATTERN.test(n.name) && n.startDate)
        .sort((a, b) => {
            if (a.startDate === b.startDate) return 0;
            return a.startDate! < b.startDate! ? -1 : 1;
        });

    const index = dated.findIndex((n) => n.path === node.path);

    if (index <= 0) {
        return null;
    }

    return dated[index - 1];
}

// Resolves the sprint (and its predecessor, for the pass-rate delta) to
// scope the release readiness snapshot to. With no iteration selected, this
// is today's default: the hand-maintained calendar's "current" sprint,
// covering all functional test cases regardless of iteration. With an
// iteration selected, it's that real Azure DevOps sprint specifically.
function resolveSprint(
    iteration: string | undefined,
    iterationNodes: IterationNode[]
): { sprint: SprintInfo; previousSprint: SprintInfo | null } {
    if (!iteration) {
        const sprint = getCurrentSprint();

        return { sprint, previousSprint: getPreviousSprint(sprint) };
    }

    const node = iterationNodes.find((n) => n.path === iteration);

    if (!node) {
        return {
            sprint: {
                id: iteration,
                name: iteration,
                startDate: "",
                endDate: "",
                hasEnded: false,
            },
            previousSprint: null,
        };
    }

    const previousNode = findPreviousIterationNode(iterationNodes, node);

    return {
        sprint: sprintInfoFromIterationNode(node),
        previousSprint: previousNode
            ? sprintInfoFromIterationNode(previousNode)
            : null,
    };
}

export function countOpenBySeverity(
    defects: DefectRecord[]
): Record<"1 - Critical" | "2 - High" | "3 - Medium" | "4 - Low", number> {
    const open = defects.filter((d) => d.state !== "Closed");

    return {
        "1 - Critical": open.filter((d) => d.severity === "1 - Critical").length,
        "2 - High": open.filter((d) => d.severity === "2 - High").length,
        "3 - Medium": open.filter((d) => d.severity === "3 - Medium").length,
        "4 - Low": open.filter((d) => d.severity === "4 - Low").length,
    };
}

// `iteration` scopes the whole snapshot (gate, completion, blocking
// defects) to a single real Azure DevOps sprint, matched against
// TestCaseRow.iteration / DefectRecord.iterationPath (both the full
// project-rooted path, e.g. "Nuova Frontiera\Front Office Auto\Sprint 2" -
// see getIterations() in azdo.ts). Omitting it keeps the original
// behaviour: every functional test case/defect regardless of sprint,
// labelled with the hand-maintained "current" sprint from sprints.ts.
export async function computeReleaseReadiness(
    iteration?: string
): Promise<ReleaseReadinessResponse> {
    const now = Date.now();
    const cacheKey = iteration ?? "";
    const cached = cache.get(cacheKey);

    if (cached && now - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    const [allTestCases, defects, trend, iterationNodes] = await Promise.all([
        getDashboardData(),
        getDefectData(),
        computeExecutionTrend(),
        getIterations(),
    ]);

    const functionalTestCases = allTestCases.filter((tc) =>
        isFunctionalTestPlan(tc.planName)
    );
    const scopedTestCases = iteration
        ? functionalTestCases.filter((tc) => tc.iteration === iteration)
        : functionalTestCases;
    const scopedDefects = iteration
        ? defects.filter((d) => d.iterationPath === iteration)
        : defects;

    const dashboardStats = computeDashboardStats(scopedTestCases);

    const { sprint, previousSprint } = resolveSprint(iteration, iterationNodes);

    // A Not Applicable test case was still assessed by a tester (they looked
    // at it and decided it doesn't apply here) - unlike a NotRun one, which
    // nobody ever touched - so it counts as "executed" for completion
    // purposes here, even though it's excluded from the pass-rate
    // calculations below (a NA case has no pass/fail verdict to score).
    const executedCount =
        dashboardStats.executedCount + dashboardStats.notApplicableCount;

    // "Not Applicable" test cases are ones marked out-of-scope for the
    // current release (code_coverage.md's "Pertinenza casi test") - the
    // target is 0%, i.e. the plan shouldn't contain out-of-scope test cases
    // without documented justification.
    const testCaseRelevancePct = dashboardStats.totalTestCases
        ? Math.round(
              (dashboardStats.notApplicableCount /
                  dashboardStats.totalTestCases) *
                  1000
          ) / 10
        : 0;

    const completion: SprintCompletion = {
        plannedCount: dashboardStats.totalTestCases,
        executedCount,
        notExecutedCount: dashboardStats.notRunCount,
        notApplicableCount: dashboardStats.notApplicableCount,
        testCaseRelevancePct,
        completionRatePct: dashboardStats.totalTestCases
            ? Math.round(
                  (executedCount / dashboardStats.totalTestCases) * 1000
              ) / 10
            : 0,
        // Only counts as "carried over" once the sprint window has actually
        // closed - before that it's just work still in flight.
        carryOverCount: sprint.hasEnded ? dashboardStats.notRunCount : 0,
    };

    // "Test superati" is the pass rate among *executed* test cases, not
    // among all planned ones - distinct from completion.completionRatePct.
    const testsPassedPct = dashboardStats.executedCount
        ? Math.round(
              (dashboardStats.passedCount / dashboardStats.executedCount) *
                  1000
          ) / 10
        : null;

    const severityOpenCounts = countOpenBySeverity(scopedDefects);

    const criteria = buildGateCriteria(
        completion,
        testsPassedPct,
        testCaseRelevancePct,
        severityOpenCounts
    );
    const releaseGate = computeReleaseGate(criteria);

    // With a specific iteration selected, both sprints' pass rates come from
    // their own scoped test cases (exact, NA excluded, matches
    // testsPassedPct above). Without one, there's no real per-sprint test
    // case scope to draw on (the hand-maintained calendar sprint isn't tied
    // to an iteration path), so this falls back to the original date-range
    // approximation over the execution trend.
    const passRateDelta: PassRateDelta = iteration
        ? buildScopedPassRateDelta(
              testsPassedPct,
              previousSprint,
              functionalTestCases
          )
        : computePassRateDelta(trend, sprint, previousSprint);

    const blockingRecords = scopedDefects.filter(
        (d) =>
            d.state !== "Closed" &&
            (d.severity === "1 - Critical" || d.severity === "2 - High")
    );

    const blockingDefects: BlockingDefectsSummary = {
        criticalCount: severityOpenCounts["1 - Critical"],
        highCount: severityOpenCounts["2 - High"],
        totalCount: blockingRecords.length,
        items: blockingRecords
            .sort((a, b) => (a.severity ?? "").localeCompare(b.severity ?? ""))
            .map((d) => ({
                id: d.id,
                title: d.title,
                severity: d.severity,
                priority: d.priority,
                state: d.state,
                url: d.url,
                creator: d.creator,
                assignee: d.assignedTo,
            })),
    };

    const data: ReleaseReadinessResponse = {
        sprint,
        releaseGate,
        completion,
        passRateDelta,
        blockingDefects,
        cacheTimestamp: now,
    };

    cache.set(cacheKey, { data, timestamp: now });

    return data;
}
