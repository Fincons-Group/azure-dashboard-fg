import { buildAutomationTestCaseRows } from "./automationKpiData.js";
import { getTestSuiteRuns } from "./firebaseTestSuitesData.js";
import { FirebaseConfigError } from "./firebaseE2eData.js";
import { getSpecFilePaths, type SpecKind } from "./firebaseSpecCatalogData.js";
import { dedupe } from "./inflight.js";
import type { TestCatalogErrorGroup, TestCatalogRow, TestSpecCatalogResponse } from "./types.js";

// "As they are" per NuovaFrontiera's own steer: this catalog is keyed off
// the real Playwright spec files in the tst-e2e checkout, not just whatever
// happens to already be linked to an Azure DevOps Test Case - a spec with no
// history yet still shows up, since the point is a complete inventory to
// track against, the same idea as a Metabase-style "spec file x every run"
// table. The spec-path list itself comes from Firestore (published by
// scripts/publish-spec-catalog.js from a real tst-e2e checkout) rather than
// a live git-ls-files scan on this server - there's no tst-e2e checkout on
// the hosted (Render) deployment to scan.
const TOP_ERRORS_N = 3;

function specFileName(specPath: string): string {
    return specPath.split(/[\\/]/).pop() ?? specPath;
}

interface Occurrence {
    outcome: string;
    completedDate: string;
    errorMessage?: string;
    browser?: string;
    testCaseId?: number;
    testTitle: string;
}

function topErrorsFrom(occurrences: Occurrence[], failedOutcome: string): TestCatalogErrorGroup[] {
    const counts = new Map<string, number>();

    for (const o of occurrences) {
        if (o.outcome !== failedOutcome || !o.errorMessage) continue;
        counts.set(o.errorMessage, (counts.get(o.errorMessage) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_ERRORS_N);
}

// Every kind's history comes from the same testSuiteRuns/testSuiteRunsLocal
// Firestore docs (see scripts/publish-local-test-runs.js) - a11y/security
// specs ride along in the same "nrt" run doc's tests[] (they execute in the
// same Playwright invocation), tagged by NrtTestResult.kind, so this reads
// all three the same way instead of needing separate Azure DevOps test run
// data (which turned out to not carry real spec linkage yet - AutomatedTest
// Storage on Test Factory's cases is still a generic placeholder, not a
// real path).
async function buildCatalog(
    specPaths: string[],
    kind: SpecKind,
    titleByTestCaseId: Map<number, string>
): Promise<TestCatalogRow[]> {
    let runs: Awaited<ReturnType<typeof getTestSuiteRuns>> = [];

    try {
        runs = await getTestSuiteRuns();
    } catch (error) {
        if (!(error instanceof FirebaseConfigError)) throw error;
        // Not configured - every spec still lists, just with no history.
    }

    const occurrencesByFile = new Map<string, Occurrence[]>();

    for (const run of runs) {
        if (!run.nrt) continue;

        for (const test of run.nrt.tests ?? []) {
            if ((test.kind ?? "nrt") !== kind) continue;

            const bucket = occurrencesByFile.get(test.file) ?? [];
            bucket.push({
                outcome: test.status,
                completedDate: run.startedAt,
                errorMessage: test.errorMessage,
                browser: test.browser,
                testCaseId: test.testCaseId,
                testTitle: test.title,
            });
            occurrencesByFile.set(test.file, bucket);
        }
    }

    return specPaths
        .map((specPath): TestCatalogRow => {
            // Runs already come back newest-first from getTestSuiteRuns, so
            // occurrences collected in that order need no re-sort.
            const occurrences = occurrencesByFile.get(specPath) ?? [];
            const testCaseId = occurrences.find((o) => o.testCaseId)?.testCaseId;
            const browsers = [...new Set(occurrences.map((o) => o.browser).filter((b): b is string => !!b))];

            return {
                specPath,
                specFile: specFileName(specPath),
                testCaseId,
                testCaseTitle:
                    (testCaseId && titleByTestCaseId.get(testCaseId)) || occurrences[0]?.testTitle,
                browsers,
                // Every occurrence found, not just a handful - getTestSuiteRuns
                // itself already caps at MAX_RUNS_PER_KIND (200) runs per kind,
                // so this is naturally bounded without an extra slice here.
                lastRuns: occurrences.map(({ outcome, completedDate, browser }) => ({
                    outcome,
                    completedDate,
                    browser,
                })),
                topErrors: topErrorsFrom(occurrences, kind === "nrt" ? "failed" : "Failed"),
            };
        })
        .sort((a, b) => a.specFile.localeCompare(b.specFile));
}

const cache = new Map<string, { data: TestSpecCatalogResponse; timestamp: number }>();
const CACHE_DURATION_MS = 5 * 60 * 1000;

function resolveProjectKey(project?: string): string {
    return project ?? process.env.AZDO_PROJECT!;
}

async function buildSpecCatalog(project?: string): Promise<TestSpecCatalogResponse> {
    let specPathsByKind: Record<SpecKind, string[]> | null;

    try {
        specPathsByKind = await getSpecFilePaths();
    } catch (error) {
        if (!(error instanceof FirebaseConfigError)) throw error;
        specPathsByKind = null;
    }

    if (!specPathsByKind) {
        return { configured: false, nrt: [], a11y: [], security: [] };
    }

    // Best-effort title enrichment only - the real per-spec history and
    // testCaseId both come from the published run data above regardless of
    // whether Azure DevOps has anything useful linked for a given id.
    const rows = await buildAutomationTestCaseRows(project);
    const titleByTestCaseId = new Map(rows.map((r) => [r.testCaseId, r.testCaseTitle]));

    const [nrt, a11y, security] = await Promise.all([
        buildCatalog(specPathsByKind.nrt, "nrt", titleByTestCaseId),
        buildCatalog(specPathsByKind.a11y, "a11y", titleByTestCaseId),
        buildCatalog(specPathsByKind.security, "security", titleByTestCaseId),
    ]);

    return { configured: true, nrt, a11y, security };
}

export async function getSpecCatalog(project?: string): Promise<TestSpecCatalogResponse> {
    const projectKey = resolveProjectKey(project);
    const cached = cache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`specCatalog:${projectKey}`, async () => {
        const fresh = cache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const data = await buildSpecCatalog(project);
        cache.set(projectKey, { data, timestamp: Date.now() });
        return data;
    });
}

export function clearSpecCatalogCache(): void {
    cache.clear();
}
