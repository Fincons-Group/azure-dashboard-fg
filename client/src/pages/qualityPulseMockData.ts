// Illustrative sample data for the Quality Pulse page's Operations,
// Governance and Executive tabs (behind AppSettings.showExperimentalPages).
// The Engineering tab has since moved to real data - see qualityPulseData.ts,
// which reshapes the same /api/automation-kpis and /api/test-suites
// responses AutomationKpiPage.tsx/TestSuitesPage.tsx already fetch - so
// Suite Analytics and Flaky Test Monitor no longer live here.
//
// What's left is still mocked because the real source doesn't exist yet:
// Defect Escapes needs a "Found In" environment field on bug work items
// (see docs/kpi-improvement-plan.md #2.2/#2.3), and Pipeline Overview needs
// a CI/CD data source this project doesn't have - a prior AutomationKpiResponse
// iteration hardcoded mock pipeline numbers, deliberately not resurrected
// there, so this file is the one place that's explicitly marked as a preview
// instead of pretending to be live.

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
    // Quote & Bind / Claims Intake read as consistently high-risk here.
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

// Standalone illustrative figures for the Executive tab's summary tiles -
// deliberately NOT derived from Suite Analytics/Flaky Test Monitor (those
// are real now, see qualityPulseData.ts). Only the Engineering tab went
// live; Operations/Governance/Executive stay self-contained mock data.
export const SAMPLE_SUITE_HEALTH_PCT: number = 93.4;
export const SAMPLE_QUARANTINED_COUNT: number = 2;
