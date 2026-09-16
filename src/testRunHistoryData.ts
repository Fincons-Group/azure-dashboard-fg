import { getTestRuns, getTestRunResults } from "./azdo.js";
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";

// Azure DevOps' Test Points API (used everywhere else in this app) only ever
// exposes the LATEST outcome per test point - there is no "first attempt"
// field on it, and no per-test-case execution history either. Getting either
// requires walking every test run's results instead. This is the heaviest
// fetch in the app (enumerates every run + every run's results, project-
// wide), so raw per-result tuples are cached per project and optional plan
// selection. Calls with the same scope share both in-flight work and the
// completed cache; expired selection entries are evicted below.
const CACHE_DURATION_MS = 5 * 60 * 1000;

export interface FirstExecutionOutcome {
    outcome: string;
    completedDate: string;
}

interface ResultTuple {
    testCaseId: number;
    outcome: string;
    completedDate: string;
    steps: Array<{
        id: string;
        outcome: string;
        completedDate: string;
    }>;
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

async function getResultTuples(
    project?: string,
    planIds: number[] = []
): Promise<ResultTuple[]> {
    const now = Date.now();
    for (const [key, entry] of resultTuplesCache) {
        if (now - entry.timestamp >= CACHE_DURATION_MS) {
            resultTuplesCache.delete(key);
        }
    }

    const normalizedPlanIds = [...new Set(planIds)].sort((a, b) => a - b);
    const projectKey = `${resolveProjectKey(project)}:${normalizedPlanIds.join(",") || "all"}`;
    const cached = resultTuplesCache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`resultTuples:${projectKey}`, async () => {
        const fresh = resultTuplesCache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const allRuns = await getTestRuns(project);
        const selectedPlanIds = new Set(normalizedPlanIds);
        const runs = selectedPlanIds.size
            ? allRuns.filter((run: any) =>
                  selectedPlanIds.has(Number(run.plan?.id))
              )
            : allRuns;

        const resultsByRun = await mapWithConcurrency(
            runs,
            RUN_RESULT_CONCURRENCY,
            (run: any) =>
                getTestRunResults(run.id, project, { includeIterations: true })
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

                const steps = (result.iterationDetails ?? []).flatMap(
                    (iteration: any) =>
                        (iteration.actionResults ?? [])
                            .map((action: any) => ({
                                id: String(
                                    action.stepIdentifier ??
                                        action.actionPath ??
                                        ""
                                ),
                                outcome: String(action.outcome ?? ""),
                                completedDate:
                                    action.completedDate ??
                                    action.startedDate ??
                                    completedDate,
                            }))
                            .filter((step: any) => step.id && step.outcome)
                );

                tuples.push({ testCaseId, outcome, completedDate, steps });
            }
        }

        resultTuplesCache.set(projectKey, { data: tuples, timestamp: Date.now() });

        return tuples;
    });
}

export const FINISHED_OUTCOMES = new Set([
    "passed",
    "failed",
    "blocked",
    "notapplicable",
    "inconclusive",
    "timeout",
    "aborted",
    "warning",
    "error",
]);

export interface FirstExecutionStepSummary {
    passed: number;
    executed: number;
}

// Returns the first completed result of every distinct step, grouped by test
// case. A step key is scoped to its parent case so equal step identifiers in
// two different cases never collide.
export async function getFirstExecutionStepSummaries(
    project?: string,
    planIds: number[] = []
): Promise<Map<number, FirstExecutionStepSummary>> {
    const tuples = await getResultTuples(project, planIds);
    const earliest = new Map<
        string,
        { testCaseId: number; outcome: string; completedDate: string }
    >();

    for (const tuple of tuples) {
        for (const step of tuple.steps) {
            const outcome = step.outcome.toLowerCase();
            if (!FINISHED_OUTCOMES.has(outcome)) continue;

            const key = `${tuple.testCaseId}:${step.id}`;
            const existing = earliest.get(key);
            if (
                !existing ||
                new Date(step.completedDate).getTime() <
                    new Date(existing.completedDate).getTime()
            ) {
                earliest.set(key, {
                    testCaseId: tuple.testCaseId,
                    outcome,
                    completedDate: step.completedDate,
                });
            }
        }
    }

    const summaries = new Map<number, FirstExecutionStepSummary>();
    for (const step of earliest.values()) {
        const summary = summaries.get(step.testCaseId) ?? {
            passed: 0,
            executed: 0,
        };
        summary.executed++;
        if (step.outcome === "passed") summary.passed++;
        summaries.set(step.testCaseId, summary);
    }
    return summaries;
}

// Returns the first-execution outcome per test case ID, project-wide -
// independent of which plans/suites are currently selected, so it caches
// once per project rather than once per plan selection.
export async function getFirstExecutionOutcomes(
    project?: string,
    planIds: number[] = []
): Promise<Map<number, FirstExecutionOutcome>> {
    const tuples = await getResultTuples(project, planIds);
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
