import {
    getTestPlan,
    getSuites,
    getTestCases,
    getTestPoints,
    getBugWorkItemTypeStates,
    getWorkItems,
    extractWorkItemIds,
} from "./azdo.js";
import {
    buildTestCaseRow,
    assembleTestCaseRow,
    indexSuiteTestPoints,
    extractReportUrlFromDescription,
    resolveTestPointStatus,
} from "./dashboardData.js";
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";
import type {
    BugInfo,
    Outcome,
    PlanOverviewResponse,
    PlanOverviewSuiteDetail,
    PlanOverviewTestCase,
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
    string,
    { data: PlanOverviewResponse; timestamp: number }
>();

const CACHE_DURATION_MS = 5 * 60 * 1000;

export function clearPlanOverviewCache(): void {
    cache.clear();
}

async function buildPlanRows(
    planId: number,
    planName: string,
    project?: string
): Promise<TestCaseRow[]> {
    const suites = await getSuites(planId, project);

    const rowsBySuite = await Promise.all(
        suites.map(async (suite: any) => {
            const testCases = await getTestCases(
                planId,
                suite.id,
                project
            );

            const testPoints = await getTestPoints(
                planId,
                suite.id,
                project
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
                        lastRunByTestCase,
                        undefined,
                        project
                    )
                )
            );
        })
    );

    return rowsBySuite.flat();
}

export async function computePlanOverview(
    planId: number,
    project?: string
): Promise<PlanOverviewResponse> {
    // Plan IDs are only unique within a project, so two different projects
    // could otherwise collide on the same cache entry - key by both.
    const cacheKey = `${project ?? ""}:${planId}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    // dedupe: the Sprint Report page and the Excel Export page can each ask
    // for the same plan's overview at the same moment.
    return dedupe(`planOverview:${cacheKey}`, async () => {
        const fresh = cache.get(cacheKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const plan = await getTestPlan(planId, project);
        const planName = plan?.name ?? String(planId);
        const reportUrl = extractReportUrlFromDescription(plan?.description);

        const { rows, testCases } = await buildPlanRowsOptimized(
            planId,
            planName,
            project
        );

        const data = await assemblePlanOverview(
            planId,
            planName,
            reportUrl,
            rows,
            testCases,
            project
        );

        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    });
}

// Reference (unbatched) build - kept only for compare-optimized.ts. Does not
// populate `testCases` (that's an Excel-export-only addition with no legacy
// behaviour to diff against).
export async function computePlanOverviewReference(
    planId: number,
    project?: string
): Promise<PlanOverviewResponse> {
    const plan = await getTestPlan(planId, project);
    const planName = plan?.name ?? String(planId);
    const reportUrl = extractReportUrlFromDescription(plan?.description);
    const rows = await buildPlanRows(planId, planName, project);
    return assemblePlanOverview(planId, planName, reportUrl, rows, [], project);
}

// Pure aggregation of buildPlanRows() output into a PlanOverviewResponse.
async function assemblePlanOverview(
    planId: number,
    planName: string,
    reportUrl: string | undefined,
    rows: TestCaseRow[],
    testCases: PlanOverviewTestCase[],
    project?: string
): Promise<PlanOverviewResponse> {
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

    const bugStates = await getBugWorkItemTypeStates(project);
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
        reportUrl,
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
        testCases,
    };

    return data;
}

/* ================================================================== */
/* Optimized (batched) plan-row build - the live path. One batched     */
/* getWorkItems($expand=all) for every test case + one for every       */
/* linked item, instead of 2 HTTP calls per test case.                 */
/* ================================================================== */

const SUITE_FETCH_CONCURRENCY = 12;

const VERDICT_OUTCOMES = new Set<Outcome>(["Passed", "Failed", "Blocked"]);

interface PointDetail {
    tester?: string;
    configuration?: string;
    lastRunBy?: string;
    lastRunAt?: string;
    lastRunId?: number;
}

// Per test case, the metadata of its most-recently-completed point (ties: the
// later point in the list wins, matching indexSuiteTestPoints' lastRun rule).
function indexSuitePointDetails(testPoints: any[]): Map<number, PointDetail> {
    const byTc = new Map<number, PointDetail>();
    const bestDate = new Map<number, number>();

    for (const point of testPoints) {
        const tcId = point.testCaseReference?.id;
        if (tcId == null) continue;

        const completed = new Date(
            point.results?.lastResultDetails?.dateCompleted ?? 0
        ).getTime();

        if (!byTc.has(tcId) || completed >= (bestDate.get(tcId) ?? -1)) {
            bestDate.set(tcId, completed);
            byTc.set(tcId, {
                tester:
                    point.tester?.displayName ??
                    point.assignedTo?.displayName,
                configuration: point.configuration?.name,
                lastRunBy:
                    point.results?.lastResultDetails?.runBy?.displayName,
                lastRunAt:
                    point.results?.lastResultDetails?.dateCompleted ||
                    undefined,
                lastRunId: point.results?.lastTestRunId ?? undefined,
            });
        }
    }

    return byTc;
}

function parseTagList(raw: unknown): string[] {
    return typeof raw === "string"
        ? raw
              .split(";")
              .map((t) => t.trim())
              .filter(Boolean)
        : [];
}

function buildPlanTestCase(
    row: TestCaseRow,
    workItem: any,
    detail: PointDetail | undefined
): PlanOverviewTestCase {
    const f = workItem.fields ?? {};
    const executed = VERDICT_OUTCOMES.has(row.outcome);
    const bugIds = row.bugs.map((b) => b.id);
    const lastRunAt = detail?.lastRunAt;

    return {
        suiteId: row.suiteId,
        suiteName: row.suiteName,
        testCaseId: row.testCaseId,
        title: row.testCaseTitle,
        url: row.testCaseUrl,
        state: f["System.State"],
        priority: row.priority,
        outcome: row.outcome,
        executed,
        notRun: row.outcome === "NotRun",
        needsRetest: executed && row.hasOpenBugs,
        automationStatus: f["Microsoft.VSTS.TCM.AutomationStatus"],
        assignedTo: f["System.AssignedTo"]?.displayName,
        tester: detail?.tester,
        lastRunBy: detail?.lastRunBy,
        lastRunAt,
        daysSinceLastRun: lastRunAt
            ? Math.floor(
                  (Date.now() - new Date(lastRunAt).getTime()) / 86_400_000
              )
            : undefined,
        configuration: detail?.configuration,
        tags: parseTagList(f["System.Tags"]),
        bugCount: bugIds.length,
        hasOpenBugs: row.hasOpenBugs,
        bugIds,
        areaPath: row.areaPath,
        lastRunId: row.lastRunId ?? detail?.lastRunId,
        lastRunUrl: row.lastRunUrl,
    };
}

async function buildPlanRowsOptimized(
    planId: number,
    planName: string,
    project?: string
): Promise<{ rows: TestCaseRow[]; testCases: PlanOverviewTestCase[] }> {
    const suites = await getSuites(planId, project);

    const perSuite = await mapWithConcurrency(
        suites,
        SUITE_FETCH_CONCURRENCY,
        async (suite: any) => {
            const [testCases, testPoints] = await Promise.all([
                getTestCases(planId, suite.id, project),
                getTestPoints(planId, suite.id, project),
            ]);
            return {
                suite,
                testCases,
                index: indexSuiteTestPoints(testPoints),
                pointDetails: indexSuitePointDetails(testPoints),
            };
        }
    );

    const allTcIds = [
        ...new Set(
            perSuite.flatMap((s) =>
                s.testCases.map((tc: any) => tc.workItem.id)
            )
        ),
    ];
    // `all` so `_links` is present (batch omits it under `$expand=relations`).
    const tcItems = await getWorkItems(allTcIds, undefined, project, {
        expand: "all",
    });
    const tcById = new Map<number, any>(
        tcItems.map((i: any) => [i.id, i])
    );

    const allLinkedIds = [
        ...new Set(
            tcItems.flatMap((i: any) => extractWorkItemIds(i.relations))
        ),
    ];
    const linkedItems = await getWorkItems(allLinkedIds, undefined, project);
    const linkedById = new Map<number, any>(
        linkedItems.map((i: any) => [i.id, i])
    );

    const rows: TestCaseRow[] = [];
    const testCases: PlanOverviewTestCase[] = [];
    for (const { suite, testCases: tcs, index, pointDetails } of perSuite) {
        for (const tc of tcs) {
            const workItem = tcById.get(tc.workItem.id);
            if (!workItem) {
                continue;
            }
            // dedupe: Azure's ?ids= batch collapses duplicates (a test case
            // can link the same bug via two relation types).
            const linked = [
                ...new Set(extractWorkItemIds(workItem.relations)),
            ]
                .map((id) => linkedById.get(id))
                .filter((x): x is any => x != null);
            const row = assembleTestCaseRow(
                tc,
                planName,
                suite.name,
                suite.id,
                workItem,
                linked,
                index.outcomesByTestCase,
                index.lastRunByTestCase,
                undefined,
                project
            );
            rows.push(row);
            testCases.push(
                buildPlanTestCase(
                    row,
                    workItem,
                    pointDetails.get(tc.workItem.id)
                )
            );
        }
    }

    return { rows, testCases };
}
