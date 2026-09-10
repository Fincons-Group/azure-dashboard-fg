import { getTestRuns, getTestRunResults } from "./azdo.js";
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";

// Azure DevOps' Test Points API (used everywhere else in this app) only ever
// exposes the LATEST outcome per test point - there is no "first attempt"
// field on it, and no per-test-case execution history either. Getting either
// requires walking every test run's results instead. This is the heaviest
// fetch in the app (enumerates every run + every run's results, project-
// wide), so the raw per-result tuples are fetched/cached once here and
// reused by both getFirstExecutionOutcomes (earliest result per test case,
// for reportExtraKpis.ts) and getAllOutcomesByTestCase (full history per
// test case, for automationKpiData.ts's success-rate/flaky-test rollup) -
// isolated from getDefectData's and computePlanOverview's caches.
const CACHE_DURATION_MS = 5 * 60 * 1000;

export interface FirstExecutionOutcome {
    outcome: string;
    completedDate: string;
}

interface ResultTuple {
    testCaseId: number;
    outcome: string;
    completedDate: string;
}

const resultTuplesCache = new Map<
    string,
    { data: ResultTuple[]; timestamp: number }
>();

function resolveProjectKey(project?: string): string {
    return project ?? process.env.AZDO_PROJECT!;
}

// Field names on a run result object are unverified against a live payload
// (getTestRunResults has zero other call sites in this codebase) - this
// checks the plausible spellings Azure DevOps' Test Results API uses across
// versions rather than assuming one. Adjust here if a real payload turns out
// to use a different shape.
function resultTestCaseId(result: any): number | undefined {
    const id =
        result.testCase?.id ??
        result.testCaseReference?.id ??
        result.automatedTestId;

    return id != null ? Number(id) : undefined;
}

function resultCompletedDate(result: any): string | undefined {
    return (
        result.completedDate ??
        result.dateCompleted ??
        result.lastUpdatedDate
    );
}

const RUN_RESULT_CONCURRENCY = 10;

async function getResultTuples(project?: string): Promise<ResultTuple[]> {
    const projectKey = resolveProjectKey(project);
    const cached = resultTuplesCache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`resultTuples:${projectKey}`, async () => {
        const fresh = resultTuplesCache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const runs = await getTestRuns(project);

        const resultsByRun = await mapWithConcurrency(
            runs,
            RUN_RESULT_CONCURRENCY,
            (run: any) => getTestRunResults(run.id, project)
        );

        const tuples: ResultTuple[] = [];

        for (const results of resultsByRun) {
            for (const result of results ?? []) {
                const testCaseId = resultTestCaseId(result);
                const completedDate = resultCompletedDate(result);
                const outcome = result.outcome;

                if (testCaseId == null || !completedDate || !outcome) {
                    continue;
                }

                tuples.push({ testCaseId, outcome, completedDate });
            }
        }

        resultTuplesCache.set(projectKey, { data: tuples, timestamp: Date.now() });

        return tuples;
    });
}

// Returns the first-execution outcome per test case ID, project-wide -
// independent of which plans/suites are currently selected, so it caches
// once per project rather than once per plan selection.
export async function getFirstExecutionOutcomes(
    project?: string
): Promise<Map<number, FirstExecutionOutcome>> {
    const tuples = await getResultTuples(project);
    const earliestByTestCase = new Map<number, FirstExecutionOutcome>();

    for (const { testCaseId, outcome, completedDate } of tuples) {
        const existing = earliestByTestCase.get(testCaseId);

        if (
            !existing ||
            new Date(completedDate).getTime() <
                new Date(existing.completedDate).getTime()
        ) {
            earliestByTestCase.set(testCaseId, { outcome, completedDate });
        }
    }

    return earliestByTestCase;
}

// Returns every recorded outcome per test case ID, project-wide - unlike
// getFirstExecutionOutcomes above, nothing is collapsed to "earliest", since
// flaky-test detection and automation success rate both need the full
// pass/fail history, not just the first attempt.
export async function getAllOutcomesByTestCase(
    project?: string
): Promise<Map<number, FirstExecutionOutcome[]>> {
    const tuples = await getResultTuples(project);
    const byTestCase = new Map<number, FirstExecutionOutcome[]>();

    for (const { testCaseId, outcome, completedDate } of tuples) {
        const bucket = byTestCase.get(testCaseId) ?? [];
        bucket.push({ outcome, completedDate });
        byTestCase.set(testCaseId, bucket);
    }

    return byTestCase;
}

export function clearFirstExecutionOutcomesCache(): void {
    resultTuplesCache.clear();
}
