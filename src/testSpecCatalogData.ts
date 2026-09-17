import { execFileSync } from "node:child_process";
import path from "node:path";
import { buildAutomationTestCaseRows } from "./automationKpiData.js";
import { getTestSuiteRuns } from "./firebaseTestSuitesData.js";
import { FirebaseConfigError } from "./firebaseE2eData.js";
import { dedupe } from "./inflight.js";
import type { TestCatalogErrorGroup, TestCatalogRow, TestSpecCatalogResponse } from "./types.js";

// "As they are" per NuovaFrontiera's own steer: this catalog is keyed off
// the real Playwright spec files in the tst-e2e checkout (git ls-files),
// not just whatever happens to already be linked to an Azure DevOps Test
// Case or published to Firestore - a spec with no history yet still shows
// up, since the point is a complete inventory to track against, the same
// idea as a Metabase-style "spec file x last 5 runs" table.
const RUN_HISTORY_N = 5;
const TOP_ERRORS_N = 3;

type SpecKind = "nrt" | "a11y" | "security";

// Mirrors tst-e2e's own src/tests/<kind> layout - "ui" is where every
// domain-tagged NRT spec lives (see src/scripts/tmp-mark-automated.ts's
// equivalent listSpecFiles for a11y/security).
const KIND_SUBDIR: Record<SpecKind, string> = {
    nrt: "ui",
    a11y: "a11y",
    security: "security",
};

function specFileName(specPath: string): string {
    return specPath.split(/[\\/]/).pop() ?? specPath;
}

// Same git-ls-files approach as tmp-mark-automated.ts, and for the same
// reason: this OneDrive-synced checkout's fs.readdirSync returns an
// inconsistent partial listing across runs (Files On-Demand placeholder
// quirk), while git ls-files reads the tracked-file list from the index.
function listSpecFiles(repoRoot: string, kind: SpecKind): string[] {
    try {
        const output = execFileSync(
            "git",
            ["-C", repoRoot, "ls-files", "--", `src/tests/${KIND_SUBDIR[kind]}/**/*.spec.ts`],
            { encoding: "utf8" }
        );

        return output
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((rel) => rel.replace(/^src\/tests\//, ""));
    } catch (error) {
        console.error(`Failed to list ${kind} spec files under ${repoRoot}:`, error);
        return [];
    }
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
                lastRuns: occurrences
                    .slice(0, RUN_HISTORY_N)
                    .map(({ outcome, completedDate, browser }) => ({ outcome, completedDate, browser })),
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
    const reportsDir = process.env.TEST_SUITES_REPORTS_DIR;

    if (!reportsDir) {
        return { configured: false, nrt: [], a11y: [], security: [] };
    }

    // Same derivation as scripts/publish-local-test-runs.js: reportsDir is
    // <tst-e2e checkout>/reports, so its parent is the checkout root.
    const repoRoot = path.dirname(reportsDir);

    // Best-effort title enrichment only - the real per-spec history and
    // testCaseId both come from the published run data above regardless of
    // whether Azure DevOps has anything useful linked for a given id.
    const rows = await buildAutomationTestCaseRows(project);
    const titleByTestCaseId = new Map(rows.map((r) => [r.testCaseId, r.testCaseTitle]));

    const [nrt, a11y, security] = await Promise.all([
        buildCatalog(listSpecFiles(repoRoot, "nrt"), "nrt", titleByTestCaseId),
        buildCatalog(listSpecFiles(repoRoot, "a11y"), "a11y", titleByTestCaseId),
        buildCatalog(listSpecFiles(repoRoot, "security"), "security", titleByTestCaseId),
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
