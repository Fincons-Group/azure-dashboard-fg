// Real-data derivations for the Quality Pulse page's Engineering tab only
// (Operations/Governance/Executive still run on qualityPulseMockData.ts -
// see that file's header for why: no CI/CD pipeline data source and no
// "Found In" defect field exist in this project yet). Suite Analytics and
// Flaky Test Monitor DO have real sources already fetched elsewhere in this
// app - /api/test-suites (fetchTestSuites, same as TestSuitesPage.tsx) and
// /api/automation-kpis (fetchAutomationKpis, same as AutomationKpiPage.tsx) -
// so this file just reshapes their existing responses for these two charts
// instead of adding any new backend surface.
import type { FlakyTestRankItem, TestSuiteKey, TestSuiteRun } from "../types";

export const SUITE_ORDER: TestSuiteKey[] = ["nrt", "a11y", "security"];

export interface SuiteModuleStats {
    module: string;
    passed: number;
    failed: number;
    flaky: number;
}

// "Module" here is really an NRT/A11Y/Security test *domain*
// (NrtDomainResult.label) - a different taxonomy from the ADO area-path
// "module" used by CoverageByModule elsewhere in this app. They aren't the
// same axis, so this intentionally doesn't try to reconcile the two.
export function buildSuiteAnalytics(runs: TestSuiteRun[]): SuiteModuleStats[] {
    const latestBySuite = SUITE_ORDER.map(
        (suite) =>
            runs
                .filter((r) => r.suite === suite)
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    ).filter((r): r is TestSuiteRun => r != null);

    const byDomain = new Map<string, SuiteModuleStats>();

    for (const run of latestBySuite) {
        for (const d of run.nrt?.domains ?? []) {
            const current = byDomain.get(d.label) ?? { module: d.label, passed: 0, failed: 0, flaky: 0 };
            current.passed += d.passed;
            current.flaky += d.flaky;
            current.failed += Math.max(0, d.total - d.passed - d.flaky);
            byDomain.set(d.label, current);
        }
    }

    return [...byDomain.values()].sort(
        (a, b) => b.passed + b.failed + b.flaky - (a.passed + a.failed + a.flaky)
    );
}

export type FlakyRowStatus = "monitoring" | "quarantined";

export interface FlakyRow extends FlakyTestRankItem {
    status: FlakyRowStatus;
}

// No quarantine concept exists in Azure DevOps test-case data - this is a
// derived label from the one real signal available (flakeCount), not a
// second fabricated field. Threshold picked to roughly match the top third
// of a typical flaky list; revisit once there's a real "quarantined" tag to
// read instead.
const QUARANTINE_FLAKE_COUNT_THRESHOLD = 8;

export function buildFlakyRows(flakyTests: FlakyTestRankItem[]): FlakyRow[] {
    return flakyTests.map((f) => ({
        ...f,
        status: f.flakeCount >= QUARANTINE_FLAKE_COUNT_THRESHOLD ? "quarantined" : "monitoring",
    }));
}
