import {
    getTestPlans,
    getSuites,
    getTestCases,
    getTestRuns,
    getTestRunResults,
    getWorkItems,
} from "./azdo.js";
import { resolveOutcome } from "./dashboardData.js";
import type {
    AutomationTestCaseRow,
    AutomationResultOccurrence,
    AutomationKpis,
    CiCdMetrics,
    CoverageByModule,
    FlakyTestRankItem,
    AutomationCharts,
    AutomationDashboardResponse,
} from "./types.js";

const AUTOMATION_STATUS_FIELD = "Microsoft.VSTS.TCM.AutomationStatus";
const AREA_PATH_FIELD = "System.AreaPath";
const FLAKY_TOP_N = 10;

let rowsCache: AutomationTestCaseRow[] | null = null;
let occurrencesCache: AutomationResultOccurrence[] | null = null;
let cacheTimestamp = 0;

const CACHE_DURATION_MS = 5 * 60 * 1000;

export function getAutomationCacheTimestamp(): number {
    return cacheTimestamp;
}

async function buildAutomationRows(): Promise<
    AutomationTestCaseRow[]
> {
    const plans = await getTestPlans();

    const rows: AutomationTestCaseRow[] = [];

    for (const plan of plans) {
        const suites = await getSuites(plan.id);

        for (const suite of suites) {
            const testCases = await getTestCases(
                plan.id,
                suite.id
            );

            const ids = testCases.map(
                (tc: any) => tc.workItem.id
            );

            const workItems = await getWorkItems(ids, [
                AUTOMATION_STATUS_FIELD,
                AREA_PATH_FIELD,
            ]);

            const fieldsById = new Map<number, any>(
                workItems.map((wi: any) => [
                    wi.id,
                    wi.fields,
                ])
            );

            for (const tc of testCases) {
                const fields =
                    fieldsById.get(tc.workItem.id) ?? {};

                rows.push({
                    testCaseId: tc.workItem.id,
                    testCaseTitle: tc.workItem.name,
                    planId: plan.id,
                    planName: plan.name,
                    areaPath:
                        fields[AREA_PATH_FIELD] ?? "",
                    iteration: plan.iteration,
                    suiteName: suite.name,
                    isAutomated:
                        fields[AUTOMATION_STATUS_FIELD] ===
                        "Automated",
                });
            }
        }
    }

    return rows;
}

async function buildOccurrences(): Promise<
    AutomationResultOccurrence[]
> {
    const runs = await getTestRuns();

    const resultsByRun = await Promise.all(
        runs.map((run: any) =>
            getTestRunResults(run.id)
        )
    );

    const occurrences: AutomationResultOccurrence[] = [];

    for (const result of resultsByRun.flat()) {
        const testCaseId = result.testCase?.id;

        if (testCaseId == null) {
            continue;
        }

        occurrences.push({
            testCaseId,
            outcome: resolveOutcome([
                result.outcome ?? "none",
            ]),
            completedDate: result.completedDate,
        });
    }

    return occurrences;
}

async function buildAutomationData(): Promise<{
    rows: AutomationTestCaseRow[];
    occurrences: AutomationResultOccurrence[];
}> {
    const [rows, occurrences] = await Promise.all([
        buildAutomationRows(),
        buildOccurrences(),
    ]);

    return { rows, occurrences };
}

async function getAutomationData(): Promise<{
    rows: AutomationTestCaseRow[];
    occurrences: AutomationResultOccurrence[];
}> {
    const now = Date.now();

    if (
        rowsCache &&
        occurrencesCache &&
        now - cacheTimestamp < CACHE_DURATION_MS
    ) {
        console.log("CACHE HIT");

        return {
            rows: rowsCache,
            occurrences: occurrencesCache,
        };
    }

    console.log("CACHE MISS");

    const { rows, occurrences } =
        await buildAutomationData();

    rowsCache = rows;
    occurrencesCache = occurrences;
    cacheTimestamp = now;

    return { rows, occurrences };
}

export function clearAutomationCache(): void {
    rowsCache = null;
    occurrencesCache = null;
    cacheTimestamp = 0;
}

function areaPathLeaf(areaPath: string): string {
    const segments = areaPath.split("\\").filter(Boolean);

    return segments[segments.length - 1] ?? areaPath;
}

export function getCiCdMetrics(): CiCdMetrics {
    return {
        pipelineSuccessRatePct: 91.3,
        pipelineFailureRatePct: 8.7,
        avgPipelineDurationMinutes: 17.4,
        testExecutionTimeMinutes: 9.8,
    };
}

function getPipelineSuccessTrend() {
    return [
        { date: "2026-06-05", successRatePct: 88 },
        { date: "2026-06-06", successRatePct: 90 },
        { date: "2026-06-07", successRatePct: 86 },
        { date: "2026-06-08", successRatePct: 92 },
        { date: "2026-06-09", successRatePct: 89 },
        { date: "2026-06-10", successRatePct: 93 },
        { date: "2026-06-11", successRatePct: 91 },
        { date: "2026-06-12", successRatePct: 95 },
        { date: "2026-06-13", successRatePct: 90 },
        { date: "2026-06-14", successRatePct: 94 },
        { date: "2026-06-15", successRatePct: 87 },
        { date: "2026-06-16", successRatePct: 92 },
        { date: "2026-06-17", successRatePct: 96 },
        { date: "2026-06-18", successRatePct: 91 },
    ];
}

export function computeAutomationDashboard(
    rows: AutomationTestCaseRow[],
    occurrences: AutomationResultOccurrence[],
    planId?: number,
    iteration?: string
): Omit<AutomationDashboardResponse, "cacheTimestamp"> {
    // `iteration` narrows which plans are even eligible (so the plan
    // dropdown itself shrinks to the selected sprint); `planId` then picks
    // one of those, so it's applied on top rather than combined into the
    // same predicate.
    const rowsInIteration = iteration
        ? rows.filter((r) => r.iteration === iteration)
        : rows;

    const filteredRows =
        planId == null
            ? rowsInIteration
            : rowsInIteration.filter((r) => r.planId === planId);

    const automatedPlanIds = [
        ...new Set(
            rowsInIteration
                .filter((r) => r.isAutomated)
                .map((r) => r.planId)
        ),
    ].sort((a, b) => a - b);

    const automatedRows = filteredRows.filter(
        (r) => r.isAutomated
    );

    const automatedIds = new Set(
        automatedRows.map((r) => r.testCaseId)
    );

    const automatedOccurrences = occurrences.filter(
        (o) => automatedIds.has(o.testCaseId)
    );

    const automatedTests = automatedRows.length;
    const manualTests =
        filteredRows.length - automatedTests;

    const automationCoveragePct = filteredRows.length
        ? Math.round(
            (automatedTests / filteredRows.length) *
                1000
        ) / 10
        : 0;

    const occurrencesByTestCase = new Map<
        number,
        AutomationResultOccurrence[]
    >();

    for (const occurrence of automatedOccurrences) {
        const bucket =
            occurrencesByTestCase.get(
                occurrence.testCaseId
            ) ?? [];

        bucket.push(occurrence);
        occurrencesByTestCase.set(
            occurrence.testCaseId,
            bucket
        );
    }

    const testCaseTitleById = new Map(
        automatedRows.map((r) => [
            r.testCaseId,
            r.testCaseTitle,
        ])
    );

    let totalPassed = 0;
    let totalFailed = 0;

    const flakyTestRanking: FlakyTestRankItem[] = [];

    for (const [
        testCaseId,
        testOccurrences,
    ] of occurrencesByTestCase) {
        const passed = testOccurrences.filter(
            (o) => o.outcome === "Passed"
        ).length;

        const failed = testOccurrences.filter(
            (o) => o.outcome === "Failed"
        ).length;

        totalPassed += passed;
        totalFailed += failed;

        if (passed > 0 && failed > 0) {
            const lastFailedDate = testOccurrences
                .filter((o) => o.outcome === "Failed")
                .map((o) => o.completedDate)
                .filter(
                    (d): d is string => Boolean(d)
                )
                .sort((a, b) => a.localeCompare(b))
                .pop();

            flakyTestRanking.push({
                testCaseId,
                testName:
                    testCaseTitleById.get(testCaseId) ??
                    `Test #${testCaseId}`,
                flakeCount: failed,
                lastFailedDate,
            });
        }
    }

    flakyTestRanking.sort(
        (a, b) => b.flakeCount - a.flakeCount
    );

    const automationSuccessRatePct =
        totalPassed + totalFailed > 0
            ? Math.round(
                (totalPassed /
                    (totalPassed + totalFailed)) *
                    1000
            ) / 10
            : 0;

    const moduleStats = new Map<
        string,
        { automated: number; manual: number }
    >();

    for (const row of filteredRows) {
        const module = areaPathLeaf(row.areaPath);

        const stat =
            moduleStats.get(module) ?? {
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

    const coverageByModule: CoverageByModule[] = [
        ...moduleStats.entries(),
    ].map(([module, stat]) => {
        const total = stat.automated + stat.manual;

        return {
            module,
            automated: stat.automated,
            manual: stat.manual,
            coveragePct: total
                ? Math.round(
                    (stat.automated / total) * 1000
                ) / 10
                : 0,
        };
    });

    const kpis: AutomationKpis = {
        automatedTests,
        manualTests,
        automationCoveragePct,
        flakyTestsCount: flakyTestRanking.length,
        automationSuccessRatePct,
    };

    const charts: AutomationCharts = {
        coverageByModule,
        flakyTestRanking: flakyTestRanking.slice(
            0,
            FLAKY_TOP_N
        ),
        pipelineSuccessTrend: getPipelineSuccessTrend(),
    };

    return {
        kpis,
        ciCd: getCiCdMetrics(),
        charts,
        planId: planId ?? null,
        automatedPlanIds,
    };
}

export async function getAutomationDashboard(
    planId?: number,
    iteration?: string
): Promise<AutomationDashboardResponse> {
    const { rows, occurrences } =
        await getAutomationData();

    return {
        ...computeAutomationDashboard(
            rows,
            occurrences,
            planId,
            iteration
        ),
        cacheTimestamp: getAutomationCacheTimestamp(),
    };
}
