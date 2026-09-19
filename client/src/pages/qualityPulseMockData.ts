// Illustrative sample data for the Quality Pulse preview page (behind
// AppSettings.showExperimentalPages) - no server endpoint backs this yet.
// Real wiring, when it lands: Suite Analytics/Flaky Test Monitor can extend
// automationKpiData.ts's per-module rollup (see buildAutomationTestCaseRows),
// Defect Escapes can reuse defectData.ts once a "Found In" environment field
// exists on bug work items (see docs/kpi-improvement-plan.md #2.2/#2.3), and
// Pipeline Overview needs a CI/CD data source this project doesn't have yet -
// a prior AutomationKpiResponse iteration hardcoded mock pipeline numbers,
// deliberately not resurrected there, so this page is the one place that's
// explicitly marked as a preview instead of pretending to be live.

export type PipelineHealth = "good" | "warn" | "bad";

export interface PipelineStage {
    id: string;
    name: string;
    health: PipelineHealth;
    lastRunAt: string;
    durationMinutes: number;
}

export interface PipelineTrendPoint {
    date: string;
    passRatePct: number;
}

export interface SuiteModuleStats {
    module: string;
    passed: number;
    failed: number;
    flaky: number;
}

export interface FlakyMonitorRow {
    testCaseId: number;
    testName: string;
    module: string;
    retries: number;
    flakeRatePct: number;
    status: "monitoring" | "quarantined";
    lastSeen: string;
}

export interface EscapeModuleStats {
    module: string;
    escapes: number;
    coveragePct: number;
}

export interface CoverageModuleStats {
    module: string;
    automated: number;
    manual: number;
    coveragePct: number;
}

interface ModuleSeed {
    module: string;
    automated: number;
    manual: number;
    coveragePct: number;
    // Production-found defects attributed to this module - deliberately
    // correlated with (100 - coveragePct) below rather than random, so
    // Quote & Bind / Claims Intake read as the same high-risk modules across
    // Suite Analytics, Flaky Test Monitor and Defect Escapes instead of each
    // section telling an unrelated story.
    escapes: number;
}

const MODULE_SEEDS: ModuleSeed[] = [
    { module: "Authentication", automated: 129, manual: 11, coveragePct: 92, escapes: 1 },
    { module: "Policy Search", automated: 164, manual: 46, coveragePct: 78, escapes: 3 },
    { module: "Quote & Bind", automated: 159, manual: 101, coveragePct: 61, escapes: 9 },
    { module: "Claims Intake", automated: 103, manual: 87, coveragePct: 54, escapes: 11 },
    { module: "Payments", automated: 125, manual: 25, coveragePct: 83, escapes: 2 },
    { module: "Document Upload", automated: 85, manual: 35, coveragePct: 71, escapes: 4 },
    { module: "Notifications", automated: 79, manual: 11, coveragePct: 88, escapes: 1 },
    { module: "Reporting", automated: 28, manual: 52, coveragePct: 35, escapes: 7 },
];

export const PIPELINE_STAGES: PipelineStage[] = [
    { id: "pr", name: "PR Validation", health: "good", lastRunAt: "2026-09-19T07:42:00", durationMinutes: 11 },
    { id: "tst", name: "TST — Nightly Regression", health: "good", lastRunAt: "2026-09-19T02:10:00", durationMinutes: 38 },
    { id: "pre", name: "PRE — Release Candidate Gate", health: "warn", lastRunAt: "2026-09-18T21:05:00", durationMinutes: 52 },
    { id: "prd", name: "PRD — Smoke Test", health: "good", lastRunAt: "2026-09-18T06:00:00", durationMinutes: 9 },
];

// Worst stage wins - one "bad" stage blocks the deployment gate outright,
// one "warn" (and nothing worse) only asks for caution. Mirrors the
// good/warn/bad -> success/warning/danger Badge mapping already used on
// TestSuitesPage/QaControlCenterPage.
export function pipelineGate(stages: PipelineStage[]): PipelineHealth {
    if (stages.some((s) => s.health === "bad")) return "bad";
    if (stages.some((s) => s.health === "warn")) return "warn";
    return "good";
}

export const BUILD_TREND: PipelineTrendPoint[] = (() => {
    const points: PipelineTrendPoint[] = [];
    const base = new Date("2026-09-19T00:00:00");

    for (let i = 13; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const passRatePct = Math.min(100, Math.round(90 + (13 - i) * 0.6 + Math.sin(i) * 3));
        points.push({ date: d.toISOString().slice(0, 10), passRatePct });
    }

    return points;
})();

export const SUITE_ANALYTICS: SuiteModuleStats[] = MODULE_SEEDS.map((m) => {
    const RUNS_PER_AUTOMATED_TEST = 5.2;
    const totalRuns = Math.round(m.automated * RUNS_PER_AUTOMATED_TEST);
    const riskFactor = (100 - m.coveragePct) / 100;
    const failed = Math.round(totalRuns * (0.02 + riskFactor * 0.09));
    const flaky = Math.round(totalRuns * (0.01 + riskFactor * 0.05));

    return { module: m.module, passed: totalRuns - failed - flaky, failed, flaky };
});

export const FLAKY_MONITOR: FlakyMonitorRow[] = [
    { testCaseId: 89142, testName: "should show correct total after applying discount", module: "Quote & Bind", retries: 14, flakeRatePct: 23.1, status: "quarantined", lastSeen: "2026-09-18" },
    { testCaseId: 88710, testName: "should recover from network interruption", module: "Claims Intake", retries: 11, flakeRatePct: 19.6, status: "quarantined", lastSeen: "2026-09-19" },
    { testCaseId: 89355, testName: "should retry failed API call gracefully", module: "Quote & Bind", retries: 9, flakeRatePct: 15.8, status: "monitoring", lastSeen: "2026-09-17" },
    { testCaseId: 88901, testName: "should render list within timeout", module: "Reporting", retries: 8, flakeRatePct: 14.2, status: "monitoring", lastSeen: "2026-09-16" },
    { testCaseId: 89020, testName: "should handle concurrent session logout", module: "Claims Intake", retries: 7, flakeRatePct: 12.4, status: "monitoring", lastSeen: "2026-09-18" },
    { testCaseId: 88544, testName: "should sync status across browser tabs", module: "Document Upload", retries: 6, flakeRatePct: 10.9, status: "monitoring", lastSeen: "2026-09-15" },
    { testCaseId: 89477, testName: "should paginate large result sets", module: "Policy Search", retries: 5, flakeRatePct: 8.7, status: "monitoring", lastSeen: "2026-09-14" },
    { testCaseId: 88632, testName: "should apply correct currency formatting", module: "Payments", retries: 4, flakeRatePct: 6.3, status: "monitoring", lastSeen: "2026-09-12" },
];

export const DEFECT_ESCAPES: EscapeModuleStats[] = MODULE_SEEDS
    .map((m) => ({ module: m.module, escapes: m.escapes, coveragePct: m.coveragePct }))
    .sort((a, b) => b.escapes - a.escapes);

export const COVERAGE_BY_MODULE: CoverageModuleStats[] = MODULE_SEEDS.map((m) => ({
    module: m.module,
    automated: m.automated,
    manual: m.manual,
    coveragePct: m.coveragePct,
}));

export const HIGHEST_RISK_MODULE = DEFECT_ESCAPES[0];
