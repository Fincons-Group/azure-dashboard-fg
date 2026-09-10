export type PlanKind = "functional" | "uat";

// Heuristic, not a configured field: this project has no formal
// Functional/UAT classification anywhere in Azure DevOps, so plan name is
// the only signal available. Validated against this project's real plan
// names (e.g. "Front Office Auto - Sprint 1 - UAT" -> uat, "Test Factory"
// plan id 4715, no "UAT" substring -> functional) - see AUTO_SUITE_GROUP_DEFS
// in client/src/components/SprintDefectReportTab.tsx. Revisit if a plan is
// ever named in a way this substring match misreads.
export function classifyPlan(planName: string): PlanKind {
    return /uat/i.test(planName) ? "uat" : "functional";
}
