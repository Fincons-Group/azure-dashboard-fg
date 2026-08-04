import {
    getTestPlans,
    getSuites,
    getTestCases,
    getTestPoints,
    getBugWorkItemTypeStates,
} from "./azdo.js";
import { buildTestCaseRow, resolveTestPointStatus } from "./dashboardData.js";
import type {
    BugInfo,
    Outcome,
    PlanOverviewResponse,
    PlanOverviewSuiteDetail,
    TestCaseRow,
} from "./types.js";

function zeroOutcomeCounts(): Record<Outcome, number> {
    return {
        Passed: 0,
        Failed: 0,
        Blocked: 0,
        NotApplicable: 0,
        Paused: 0,
        InProgress: 0,
        NotRun: 0,
    };
}

// Azure DevOps doesn't guarantee `_apis/wit/workitemtypes/Bug/states` returns
// states in workflow order (e.g. a custom "Reopened"-style state can appear
// before "Resolved" in the raw array). Categories are consistent across
// processes though, so rank by category first and only fall back to the
// raw array position to order states within the same category.
const BUG_STATE_CATEGORY_ORDER: Record<string, number> = {
    Proposed: 0,
    InProgress: 1,
    Resolved: 2,
    Completed: 3,
    Removed: 4,
};

const UNKNOWN_CATEGORY_RANK = Object.keys(
    BUG_STATE_CATEGORY_ORDER
).length;

const cache = new Map<
    number,
    { data: PlanOverviewResponse; timestamp: number }
>();

const CACHE_DURATION_MS = 5 * 60 * 1000;

export function clearPlanOverviewCache(): void {
    cache.clear();
}

async function buildPlanRows(
    planId: number,
    planName: string
): Promise<TestCaseRow[]> {
    const suites = await getSuites(planId);

    const rowsBySuite = await Promise.all(
        suites.map(async (suite: any) => {
            const testCases = await getTestCases(
                planId,
                suite.id
            );

            const testPoints = await getTestPoints(
                planId,
                suite.id
            );

            const outcomesByTestCase: Record<
                number,
                string[]
            > = {};

            const lastRunByTestCase: Record<
                number,
                number
            > = {};

            const lastRunDateByTestCase: Record<
                number,
                number
            > = {};

            for (const point of testPoints) {
                const tcId =
                    point.testCaseReference?.id;

                if (tcId == null) {
                    continue;
                }

                if (!outcomesByTestCase[tcId]) {
                    outcomesByTestCase[tcId] = [];
                }

                outcomesByTestCase[tcId].push(
                    resolveTestPointStatus(point)
                );

                const runId =
                    point.results?.lastTestRunId;

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
                    lastRunDateByTestCase[tcId] =
                        completedDate;
                    lastRunByTestCase[tcId] = runId;
                }
            }

            return Promise.all(
                testCases.map((tc: any) =>
                    buildTestCaseRow(
                        tc,
                        planName,
                        suite.name,
                        suite.id,
                        outcomesByTestCase,
                        lastRunByTestCase
                    )
                )
            );
        })
    );

    return rowsBySuite.flat();
}

export async function computePlanOverview(
    planId: number
): Promise<PlanOverviewResponse> {
    const cached = cache.get(planId);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    const plans = await getTestPlans();
    const plan = plans.find((p: any) => p.id === planId);
    const planName = plan?.name ?? String(planId);

    const rows = await buildPlanRows(planId, planName);

    const testsBySuiteMap = new Map<string, number>();
    const outcomeCounts: Record<Outcome, number> = {
        Passed: 0,
        Failed: 0,
        Blocked: 0,
        NotApplicable: 0,
        Paused: 0,
        InProgress: 0,
        NotRun: 0,
    };
    const bugsById = new Map<number, BugInfo>();

    // Keyed by suiteId, not suiteName - two suites in the same plan can
    // share a display name (that's exactly the "Test Agenti" mismatch this
    // was added for), and merging them under a shared name key would
    // silently combine their counts/bugs instead of keeping them apart.
    const suiteNameById = new Map<number, string>();
    const suiteTestCountById = new Map<number, number>();
    const suiteOutcomeCounts = new Map<
        number,
        Record<Outcome, number>
    >();
    const suiteBugsById = new Map<
        number,
        Map<number, BugInfo>
    >();

    for (const row of rows) {
        testsBySuiteMap.set(
            row.suiteName,
            (testsBySuiteMap.get(row.suiteName) ?? 0) + 1
        );

        outcomeCounts[row.outcome]++;

        for (const bug of row.bugs) {
            bugsById.set(bug.id, bug);
        }

        if (!suiteOutcomeCounts.has(row.suiteId)) {
            suiteNameById.set(row.suiteId, row.suiteName);
            suiteTestCountById.set(row.suiteId, 0);
            suiteOutcomeCounts.set(row.suiteId, zeroOutcomeCounts());
            suiteBugsById.set(row.suiteId, new Map());
        }

        suiteTestCountById.set(
            row.suiteId,
            suiteTestCountById.get(row.suiteId)! + 1
        );
        suiteOutcomeCounts.get(row.suiteId)![row.outcome]++;

        const suiteBugs = suiteBugsById.get(row.suiteId)!;

        for (const bug of row.bugs) {
            suiteBugs.set(bug.id, bug);
        }
    }

    const bugStates = await getBugWorkItemTypeStates();
    const stateIndex = new Map<string, number>(
        bugStates.map((s, index) => [s.name, index])
    );
    const stateMeta = new Map(
        bugStates.map((s) => [s.name, s])
    );

    const orderOf = (state: string) => {
        const meta = stateMeta.get(state);
        const categoryRank =
            meta?.category != null &&
            meta.category in BUG_STATE_CATEGORY_ORDER
                ? BUG_STATE_CATEGORY_ORDER[meta.category]
                : UNKNOWN_CATEGORY_RANK;
        const index =
            stateIndex.get(state) ?? bugStates.length;

        return categoryRank * 1000 + index;
    };

    const bugs = [...bugsById.values()].sort(
        (a, b) => orderOf(a.state) - orderOf(b.state)
    );

    const bugsByStateMap = new Map<string, number>();

    for (const bug of bugs) {
        bugsByStateMap.set(
            bug.state,
            (bugsByStateMap.get(bug.state) ?? 0) + 1
        );
    }

    const bugsByState = [...bugsByStateMap.entries()]
        .map(([state, count]) => ({
            state,
            count,
            color: stateMeta.get(state)?.color,
            category: stateMeta.get(state)?.category,
        }))
        .sort((a, b) => orderOf(a.state) - orderOf(b.state));

    const suites: PlanOverviewSuiteDetail[] = [
        ...suiteTestCountById.entries(),
    ].map(([suiteId, totalTestCases]) => ({
        suiteId,
        suiteName: suiteNameById.get(suiteId)!,
        totalTestCases,
        outcomeCounts:
            suiteOutcomeCounts.get(suiteId) ?? zeroOutcomeCounts(),
        bugs: [...(suiteBugsById.get(suiteId)?.values() ?? [])].sort(
            (a, b) => orderOf(a.state) - orderOf(b.state)
        ),
    }));

    const data: PlanOverviewResponse = {
        planId,
        planName,
        totalTestCases: rows.length,
        totalBugs: bugs.length,
        testsBySuite: [...testsBySuiteMap.entries()].map(
            ([suiteName, count]) => ({ suiteName, count })
        ),
        outcomeCounts,
        bugStates,
        bugsByState,
        bugs,
        suites,
    };

    cache.set(planId, { data, timestamp: now });

    return data;
}
