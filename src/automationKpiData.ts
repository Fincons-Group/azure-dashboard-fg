import {
    getTestPlans,
    getSuites,
    getTestCases,
    getWorkItems,
} from "./azdo.js";
import { getAllOutcomesByTestCase } from "./testRunHistoryData.js";
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";
import type {
    AutomationTestCaseRow,
    AutomationKpiResponse,
    CoverageByModule,
    FlakyTestRankItem,
} from "./types.js";

// The real Azure DevOps field for "is this test case automated" - distinct
// from coverageData.ts/cycleTimeData.ts's Epic->child-task completion
// tracking, which has nothing to do with test-case automation status.
const AUTOMATION_STATUS_FIELD = "Microsoft.VSTS.TCM.AutomationStatus";
const AREA_PATH_FIELD = "System.AreaPath";
const WORK_ITEM_FIELDS = [AUTOMATION_STATUS_FIELD, AREA_PATH_FIELD];

const FLAKY_TOP_N = 10;

// Bounds how many (plan, suite) fetches run at once across the whole
// project - mirrors planOverviewData.ts's SUITE_FETCH_CONCURRENCY, but this
// walks every plan/suite in the project rather than one plan at a time.
const SUITE_TASK_CONCURRENCY = 8;

const cache = new Map<
    string,
    { data: AutomationKpiResponse; timestamp: number }
>();

const CACHE_DURATION_MS = 5 * 60 * 1000;

function resolveProjectKey(project?: string): string {
    return project ?? process.env.AZDO_PROJECT!;
}

function areaPathLeaf(areaPath: string): string {
    const segments = areaPath.split("\\").filter(Boolean);

    return segments[segments.length - 1] ?? areaPath;
}

async function buildAutomationTestCaseRows(
    project?: string
): Promise<AutomationTestCaseRow[]> {
    const plans = await getTestPlans(project);

    const suitesByPlan = await mapWithConcurrency(
        plans,
        SUITE_TASK_CONCURRENCY,
        async (plan: any) => ({
            plan,
            suites: await getSuites(plan.id, project),
        })
    );

    const suiteTasks = suitesByPlan.flatMap(({ plan, suites }) =>
        suites.map((suite: any) => ({ plan, suite }))
    );

    const rowsPerSuite = await mapWithConcurrency(
        suiteTasks,
        SUITE_TASK_CONCURRENCY,
        async ({ plan, suite }): Promise<AutomationTestCaseRow[]> => {
            const testCases = await getTestCases(plan.id, suite.id, project);

            if (testCases.length === 0) {
                return [];
            }

            const ids = testCases.map((tc: any) => tc.workItem.id);
            const workItems = await getWorkItems(
                ids,
                WORK_ITEM_FIELDS,
                project
            );
            const fieldsById = new Map<number, any>(
                workItems.map((wi: any) => [wi.id, wi.fields])
            );

            return testCases.map((tc: any): AutomationTestCaseRow => {
                const fields = fieldsById.get(tc.workItem.id) ?? {};

                return {
                    testCaseId: tc.workItem.id,
                    testCaseTitle: tc.workItem.name,
                    planId: plan.id,
                    planName: plan.name,
                    areaPath: fields[AREA_PATH_FIELD] ?? "",
                    iteration: plan.iteration,
                    suiteName: suite.name,
                    isAutomated:
                        fields[AUTOMATION_STATUS_FIELD] === "Automated",
                };
            });
        }
    );

    return rowsPerSuite.flat();
}

function computeCoverageByModule(
    rows: AutomationTestCaseRow[]
): CoverageByModule[] {
    const moduleStats = new Map<
        string,
        { automated: number; manual: number }
    >();

    for (const row of rows) {
        const module = areaPathLeaf(row.areaPath);
        const stat = moduleStats.get(module) ?? {
            automated: 0,
            manual: 0,
        };

        if (row.isAutomated) {
            stat.automated++;
        } else {
            stat.manual++;
        }

        moduleStats.set(module, stat);
    }

    return [...moduleStats.entries()]
        .map(([module, stat]): CoverageByModule => {
            const total = stat.automated + stat.manual;

            return {
                module,
                automated: stat.automated,
                manual: stat.manual,
                coveragePct: total
                    ? Math.round((stat.automated / total) * 1000) / 10
                    : 0,
            };
        })
        .sort((a, b) => b.coveragePct - a.coveragePct);
}

// Success rate and flaky-test detection both need every historical
// pass/fail occurrence for automated test cases, not just their latest
// result - getAllOutcomesByTestCase (testRunHistoryData.ts) walks every
// test run project-wide to reconstruct that.
async function computeSuccessRateAndFlaky(
    rows: AutomationTestCaseRow[],
    project?: string
): Promise<{
    automationSuccessRatePct: number;
    flakyTestsCount: number;
    flakyTests: FlakyTestRankItem[];
}> {
    const automatedIds = new Set(
        rows.filter((r) => r.isAutomated).map((r) => r.testCaseId)
    );

    if (automatedIds.size === 0) {
        return { automationSuccessRatePct: 0, flakyTestsCount: 0, flakyTests: [] };
    }

    const titleById = new Map(
        rows.map((r) => [r.testCaseId, r.testCaseTitle])
    );
    const outcomesByTestCase = await getAllOutcomesByTestCase(project);

    let totalPassed = 0;
    let totalFailed = 0;

    const flakyTests: FlakyTestRankItem[] = [];

    for (const testCaseId of automatedIds) {
        const occurrences = outcomesByTestCase.get(testCaseId) ?? [];
        const passed = occurrences.filter((o) => o.outcome === "Passed").length;
        const failed = occurrences.filter((o) => o.outcome === "Failed").length;

        totalPassed += passed;
        totalFailed += failed;

        if (passed > 0 && failed > 0) {
            const lastFailedDate = occurrences
                .filter((o) => o.outcome === "Failed")
                .map((o) => o.completedDate)
                .sort((a, b) => a.localeCompare(b))
                .pop();

            flakyTests.push({
                testCaseId,
                testName: titleById.get(testCaseId) ?? `Test #${testCaseId}`,
                flakeCount: failed,
                lastFailedDate,
            });
        }
    }

    flakyTests.sort((a, b) => b.flakeCount - a.flakeCount);

    const automationSuccessRatePct =
        totalPassed + totalFailed > 0
            ? Math.round((totalPassed / (totalPassed + totalFailed)) * 1000) / 10
            : 0;

    return {
        automationSuccessRatePct,
        flakyTestsCount: flakyTests.length,
        flakyTests: flakyTests.slice(0, FLAKY_TOP_N),
    };
}

async function buildAutomationKpis(
    project?: string
): Promise<AutomationKpiResponse> {
    const rows = await buildAutomationTestCaseRows(project);

    const automatedTests = rows.filter((r) => r.isAutomated).length;
    const manualTests = rows.length - automatedTests;
    const automationCoveragePct = rows.length
        ? Math.round((automatedTests / rows.length) * 1000) / 10
        : 0;

    const coverageByModule = computeCoverageByModule(rows);
    const { automationSuccessRatePct, flakyTestsCount, flakyTests } =
        await computeSuccessRateAndFlaky(rows, project);

    return {
        kpis: {
            automatedTests,
            manualTests,
            automationCoveragePct,
            flakyTestsCount,
            automationSuccessRatePct,
        },
        coverageByModule,
        flakyTests,
    };
}

export async function getAutomationKpis(
    project?: string
): Promise<AutomationKpiResponse> {
    const projectKey = resolveProjectKey(project);
    const cached = cache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`automationKpis:${projectKey}`, async () => {
        const fresh = cache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const data = await buildAutomationKpis(project);
        cache.set(projectKey, { data, timestamp: Date.now() });
        return data;
    });
}

export function clearAutomationKpiCache(): void {
    cache.clear();
}
