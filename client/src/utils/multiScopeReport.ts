import type { QueryClient } from "@tanstack/react-query";
import { fetchDefects, fetchPlanOverview, fetchPlans } from "../api/client";
import type {
    DefectDashboardResponse,
    DefectFilters,
    PlanOverviewResponse,
    TestPlanSummary,
} from "../types";
import type {
    DynamicSprintReportExcelData,
    DynamicSprintReportPlan,
    MultiScopeReportEntry,
} from "./excelReport";
import type { ExcelExportPreset } from "../hooks/useExcelExportPresets";

// One resolved scope: the preset name plus the report data assembled for it,
// in the exact shape the single-scope Excel builder already consumes.
export type MultiScopeEntry = MultiScopeReportEntry;

// Re-fetches defects + every selected plan's overview for one preset. Uses
// the same query keys as DynamicSprintReportPage so React Query's cache is
// shared; staleTime 0 forces a live read at click time (mirrors that page's
// refetch()).
async function assembleEntry(
    preset: ExcelExportPreset,
    queryClient: QueryClient
): Promise<MultiScopeEntry> {
    const filters: DefectFilters = {
        iteration: preset.sprint,
        area: preset.areaPath,
        environment: "",
        targetVersion: "",
        suites: [],
    };

    // The defect report is the essential payload - let it throw so the page
    // can surface the real error. Plan list + per-plan overviews are
    // best-effort: a missing/forbidden plan shouldn't sink the whole export.
    const defects = await queryClient.fetchQuery<DefectDashboardResponse>({
        queryKey: ["defects", filters, preset.project],
        queryFn: () => fetchDefects(filters, preset.project),
        staleTime: 0,
    });

    const [plans, ...overviews] = await Promise.all([
        queryClient
            .fetchQuery<TestPlanSummary[]>({
                queryKey: [
                    "plans",
                    preset.project,
                    preset.areaPath,
                    preset.sprint,
                ],
                queryFn: () =>
                    fetchPlans(preset.project, preset.areaPath, preset.sprint),
                staleTime: 0,
            })
            .catch(() => [] as TestPlanSummary[]),
        ...preset.planIds.map((planId) =>
            queryClient
                .fetchQuery<PlanOverviewResponse>({
                    queryKey: ["plan-overview", planId, preset.project],
                    queryFn: () => fetchPlanOverview(planId, preset.project),
                    staleTime: 0,
                })
                .catch(() => undefined)
        ),
    ]);

    const reportPlans: DynamicSprintReportPlan[] = preset.planIds.map(
        (planId, index) => {
            const overview = overviews[index];
            const summary = plans.find((plan) => plan.id === planId);

            return {
                id: planId,
                name: overview?.planName ?? summary?.name ?? String(planId),
                url: summary?.url ?? overview?.reportUrl,
                overview,
            };
        }
    );

    const data: DynamicSprintReportExcelData = {
        meta: {
            title: preset.name,
            project: preset.project,
            areaPath: preset.areaPath,
            sprint: preset.sprint,
            generatedAt: new Date(),
        },
        stats: defects.stats,
        plans: reportPlans,
    };

    return { scopeName: preset.name, data };
}

export async function assembleMultiScopeData(
    presets: ExcelExportPreset[],
    queryClient: QueryClient
): Promise<MultiScopeEntry[]> {
    return Promise.all(
        presets.map((preset) => assembleEntry(preset, queryClient))
    );
}
