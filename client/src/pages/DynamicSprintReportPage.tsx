import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { ReportSidebar } from "../components/ReportSidebar";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { DefectFilterBar } from "../components/DefectFilterBar";
import { SprintDefectReportTab } from "../components/SprintDefectReportTab";
import type { SuiteGroupDef } from "../components/SprintDefectReportTab";
import {
    fetchPlans,
    fetchPlanOverview,
    fetchDefects,
} from "../api/client";
import { useScope } from "../hooks/useScope";
import { useCheckedTestPlans } from "../hooks/useCheckedTestPlans";
import type { DefectFilterOptions, DefectFilters } from "../types";

const useStyles = makeStyles({
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    layout: {
        display: "flex",
        gap: tokens.spacingHorizontalXL,
        alignItems: "flex-start",
    },
    main: {
        flex: "1 1 auto",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
    },
});

export function DynamicSprintReportPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const scope = useScope();

    const [localFilters, setLocalFilters] = useState<DefectFilters>({
        iteration: "",
        area: "",
        environment: "",
        targetVersion: "",
        suites: [],
    });

    const filters: DefectFilters = {
        ...localFilters,
        iteration: scope.sprint,
        area: scope.areaPath,
    };

    // Hard-filtered server-side to the selected area path + sprint (see
    // ReportSidebar) - this is the whole point of the sidebar, so unlike
    // the old project-wide dropdown there's no soft-match fallback: a plan
    // whose own areaPath/iteration metadata is missing or wrong in Azure
    // DevOps simply won't appear under any area+sprint combo here.
    const { data: plans, isLoading: plansLoading } = useQuery({
        queryKey: ["plans", scope.project, scope.areaPath, scope.sprint],
        queryFn: () => fetchPlans(scope.project, scope.areaPath, scope.sprint),
        enabled: scope.isComplete && !!scope.areaPath && !!scope.sprint,
    });

    const sortedPlans = useMemo(() => {
        return [...(plans ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    }, [plans]);

    // Stable across refetches when content is unchanged (React Query's
    // structural sharing), so this is safe as a useCheckedTestPlans dep.
    const planIds = useMemo(
        () => (plans ? plans.map((plan) => plan.id) : undefined),
        [plans]
    );

    const {
        checkedPlanIds: selectedPlanIds,
        setCheckedPlanIds: setSelectedPlanIds,
        newPlanIds,
    } = useCheckedTestPlans(
        { project: scope.project, areaPath: scope.areaPath, sprint: scope.sprint },
        planIds
    );

    // Fetched to enumerate each selected plan's *real* suites, so the Suite
    // Progress table/PDF export and the "Includi Bug per Suite" toggle
    // reflect the actual suites inside the selected test plan(s) instead of
    // a single whole-plan row - reuses the same ["plan-overview", planId,
    // project] query SprintDefectReportTab fetches internally, so React
    // Query dedupes the two into one request per plan.
    const planOverviewQueries = useQueries({
        queries: selectedPlanIds.map((planId) => ({
            queryKey: ["plan-overview", planId, scope.project],
            queryFn: () => fetchPlanOverview(planId, scope.project),
            enabled: scope.isComplete,
        })),
    });

    const suiteGroupDefs: SuiteGroupDef[] = useMemo(() => {
        const rows: { label: string; planId: number; suiteIds: number[] }[] = [];

        selectedPlanIds.forEach((planId, index) => {
            const overview = planOverviewQueries[index]?.data;

            if (!overview) {
                return;
            }

            for (const suite of overview.suites) {
                rows.push({
                    label: suite.suiteName,
                    planId,
                    suiteIds: [suite.suiteId],
                });
            }
        });

        // Azure DevOps allows two suites with the same name within (or
        // across) selected plans - StatusReportCard keys its rows by label,
        // so a name reused as-is would collide into one row instead of two
        // (see the "Test Agenti" suiteId-matching comment on AUTO_SUITE_GROUP_DEFS
        // in SprintDefectReportTab.tsx for the same underlying ambiguity).
        // Disambiguate every row sharing a name with its suite ID.
        const nameCounts = new Map<string, number>();
        for (const row of rows) {
            nameCounts.set(row.label, (nameCounts.get(row.label) ?? 0) + 1);
        }

        return rows.map((row) => ({
            ...row,
            label:
                (nameCounts.get(row.label) ?? 0) > 1
                    ? `${row.label} (${row.suiteIds[0]})`
                    : row.label,
        }));
    }, [selectedPlanIds, planOverviewQueries]);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["defects", filters, scope.project],
        queryFn: () => fetchDefects(filters, scope.project),
        enabled: scope.isComplete && !!scope.sprint,
    });

    // The suite dropdown normally lists every suite name that appears on a
    // bug across the whole iteration/area (see computeAvailableFilters),
    // which both hides suites that have zero bugs and includes suites from
    // plans that aren't even selected here. Once test plans are picked,
    // scope it down to the real suite hierarchy of those plans instead, so
    // a suite always shows up (regardless of bug count) and nothing outside
    // the selected plans does.
    const planSuiteNames = useMemo(() => {
        const names = new Set<string>();

        selectedPlanIds.forEach((_, index) => {
            const overview = planOverviewQueries[index]?.data;

            overview?.suites.forEach((suite) => names.add(suite.suiteName));
        });

        return [...names].sort((a, b) => a.localeCompare(b));
    }, [selectedPlanIds, planOverviewQueries]);

    function scopeAvailableFilters(
        availableFilters: DefectFilterOptions
    ): DefectFilterOptions {
        return {
            ...availableFilters,
            suites:
                selectedPlanIds.length > 0
                    ? planSuiteNames
                    : availableFilters.suites,
        };
    }

    // Pre-fills the report card's title with the selected Test Plan name(s)
    // - falls back to the generic default until at least one is picked.
    // Selection order (the order checked in the sidebar) so it matches
    // what the user actually clicked.
    const selectedPlanNames = selectedPlanIds
        .map((planId) => plans?.find((plan) => plan.id === planId)?.name)
        .filter((name): name is string => Boolean(name));

    const defaultHeaderTitle =
        selectedPlanNames.length > 0
            ? selectedPlanNames.join(", ")
            : t("dynamicSprintReportPage.defaultHeaderTitle");

    return (
        <PageLayout
            title={t("dynamicSprintReportPage.title")}
            hideAreaSprintScope
            wide
        >
            {!scope.isComplete && (
                <Text className={styles.hint}>
                    {t("dynamicSprintReportPage.selectProjectPrompt")}
                </Text>
            )}

            {scope.isComplete && (
                <div className={styles.layout}>
                    <ReportSidebar
                        project={scope.project}
                        areaPath={scope.areaPath}
                        sprint={scope.sprint}
                        onAreaPathChange={scope.setAreaPath}
                        onSprintChange={scope.setSprint}
                        plans={sortedPlans}
                        plansLoading={plansLoading}
                        checkedPlanIds={selectedPlanIds}
                        onCheckedPlanIdsChange={setSelectedPlanIds}
                        newPlanIds={newPlanIds}
                    />

                    <div className={styles.main}>
                        {!scope.areaPath && (
                            <Text className={styles.hint}>
                                {t("dynamicSprintReportPage.selectAreaPathPrompt")}
                            </Text>
                        )}

                        {scope.areaPath && !scope.sprint && (
                            <Text className={styles.hint}>
                                {t("dynamicSprintReportPage.selectSprintPrompt")}
                            </Text>
                        )}

                        {isLoading && <LoadingCardGrid />}

                        {isError && (
                            <ErrorState message={error.message} onRetry={refetch} />
                        )}

                        {data && scope.sprint && (
                            <>
                                <DefectFilterBar
                                    availableFilters={scopeAvailableFilters(
                                        data.stats.availableFilters
                                    )}
                                    filters={filters}
                                    onChange={setLocalFilters}
                                    fields={["suites", "environment", "targetVersion"]}
                                />

                                <SprintDefectReportTab
                                    stats={data.stats}
                                    project={scope.project}
                                    suiteGroupDefs={suiteGroupDefs}
                                    defaultHeaderTitle={defaultHeaderTitle}
                                    defaultHeaderSubtitle={t(
                                        "dynamicSprintReportPage.defaultHeaderSubtitle"
                                    )}
                                    includeDsiSource={(data.stats.sprintDefectReport.byOriginDetected["DSI"] ?? 0) > 0}
                                    includeDeadline={false}
                                    enableEmailPreface
                                    enableEmailClosing
                                />
                            </>
                        )}
                    </div>
                </div>
            )}
        </PageLayout>
    );
}
