import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Checkbox,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { fetchAreaPaths, fetchIterations } from "../api/client";
import type { TestPlanSummary } from "../types";

const useStyles = makeStyles({
    sidebar: {
        width: "280px",
        minWidth: "280px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    sprintList: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        paddingLeft: tokens.spacingHorizontalM,
    },
    sprintRow: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    sprintButton: {
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "none",
        cursor: "pointer",
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusMedium,
        font: "inherit",
        color: tokens.colorNeutralForeground1,
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    sprintButtonSelected: {
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
        fontWeight: tokens.fontWeightSemibold,
    },
    planList: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        paddingLeft: tokens.spacingHorizontalL,
        borderLeftWidth: "2px",
        borderLeftStyle: "solid",
        borderLeftColor: tokens.colorNeutralStroke2,
        marginLeft: tokens.spacingHorizontalS,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        paddingLeft: tokens.spacingHorizontalM,
    },
    newBadge: {
        marginLeft: tokens.spacingHorizontalXS,
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
    },
});

interface ReportSidebarProps {
    project: string;
    areaPath: string;
    sprint: string;
    onAreaPathChange: (areaPath: string) => void;
    onSprintChange: (sprint: string) => void;
    plans: TestPlanSummary[];
    plansLoading: boolean;
    checkedPlanIds: number[];
    onCheckedPlanIdsChange: (ids: number[]) => void;
    newPlanIds: Set<number>;
}

interface Iteration {
    id: string;
    name: string;
    path: string;
}

// The plan checkbox list shown under whichever sprint is currently expanded -
// identical in both the area-grouped and flat (no-area-paths) layouts below,
// so it's factored out rather than duplicated.
function PlanChecklist({
    plans,
    plansLoading,
    checkedPlanIds,
    onTogglePlan,
    newPlanIds,
}: {
    plans: TestPlanSummary[];
    plansLoading: boolean;
    checkedPlanIds: number[];
    onTogglePlan: (planId: number, checked: boolean) => void;
    newPlanIds: Set<number>;
}) {
    const styles = useStyles();
    const { t } = useTranslation();

    if (plansLoading) {
        return (
            <Text className={styles.hint}>
                {t("reportSidebar.loadingPlans")}
            </Text>
        );
    }

    if (plans.length === 0) {
        return (
            <Text className={styles.hint}>{t("reportSidebar.noPlans")}</Text>
        );
    }

    return (
        <>
            {plans.map((plan) => (
                <Checkbox
                    key={plan.id}
                    label={
                        <>
                            {plan.name}
                            {newPlanIds.has(plan.id) && (
                                <span className={styles.newBadge}>
                                    {t("reportSidebar.newPlanBadge")}
                                </span>
                            )}
                        </>
                    }
                    checked={checkedPlanIds.includes(plan.id)}
                    onChange={(_, data) => onTogglePlan(plan.id, !!data.checked)}
                />
            ))}
        </>
    );
}

// One clickable sprint row, expanding into its PlanChecklist when active -
// shared by the area-grouped and flat sprint lists below.
function SprintRow({
    iteration,
    active,
    onSelect,
    plans,
    plansLoading,
    checkedPlanIds,
    onTogglePlan,
    newPlanIds,
}: {
    iteration: Iteration;
    active: boolean;
    onSelect: () => void;
    plans: TestPlanSummary[];
    plansLoading: boolean;
    checkedPlanIds: number[];
    onTogglePlan: (planId: number, checked: boolean) => void;
    newPlanIds: Set<number>;
}) {
    const styles = useStyles();

    return (
        <div className={styles.sprintRow}>
            <button
                type="button"
                className={
                    active
                        ? `${styles.sprintButton} ${styles.sprintButtonSelected}`
                        : styles.sprintButton
                }
                onClick={onSelect}
            >
                {iteration.name}
            </button>

            {active && (
                <div className={styles.planList}>
                    <PlanChecklist
                        plans={plans}
                        plansLoading={plansLoading}
                        checkedPlanIds={checkedPlanIds}
                        onTogglePlan={onTogglePlan}
                        newPlanIds={newPlanIds}
                    />
                </div>
            )}
        </div>
    );
}

// Area Path -> Sprint -> Test Plan checkboxes, replacing the horizontal
// Area/Sprint fields ScopeBar would otherwise show on this page (see
// PageLayout's hideAreaSprintScope) with a persistent tree so a whole
// report scope - down to which test plans feed it - is visible/navigable
// in one place. Sprint stays a single active selection (report data below
// is only ever built from one sprint at a time); Area Path and Iteration
// are independent classification trees in Azure DevOps, so the sprint
// list itself isn't filtered by area - only which *test plans* show up
// under a sprint is (via their own areaPath/iteration fields).
export function ReportSidebar({
    project,
    areaPath,
    sprint,
    onAreaPathChange,
    onSprintChange,
    plans,
    plansLoading,
    checkedPlanIds,
    onCheckedPlanIdsChange,
    newPlanIds,
}: ReportSidebarProps) {
    const styles = useStyles();
    const { t } = useTranslation();

    const { data: areaPaths } = useQuery({
        queryKey: ["areas", project],
        queryFn: () => fetchAreaPaths(project),
        enabled: !!project,
    });

    const { data: iterations } = useQuery({
        queryKey: ["iterations", project],
        queryFn: () => fetchIterations(project),
        enabled: !!project,
    });

    const toggleAreaPath = (path: string) => {
        const next = areaPath === path ? "" : path;

        onAreaPathChange(next);
        onSprintChange("");
    };

    const togglePlan = (planId: number, checked: boolean) => {
        onCheckedPlanIdsChange(
            checked
                ? [...checkedPlanIds, planId]
                : checkedPlanIds.filter((id) => id !== planId)
        );
    };

    // Test Factory (confirmed) has neither real Area Paths nor real
    // Iterations below the project root - every work item there just carries
    // Area/Iteration = "Test Factory" (the root itself, which both endpoints
    // exclude from their results). With nothing to group by at all, skip
    // straight to a flat list of every test plan in the project - no area,
    // no sprint, nothing to pick first.
    if (
        areaPaths &&
        areaPaths.length === 0 &&
        iterations &&
        iterations.length === 0
    ) {
        return (
            <nav className={styles.sidebar} aria-label={t("reportSidebar.title")}>
                <Text weight="semibold">{t("reportSidebar.title")}</Text>

                <div className={styles.planList}>
                    <PlanChecklist
                        plans={plans}
                        plansLoading={plansLoading}
                        checkedPlanIds={checkedPlanIds}
                        onTogglePlan={togglePlan}
                        newPlanIds={newPlanIds}
                    />
                </div>
            </nav>
        );
    }

    // Some projects don't define any Area Paths at all, but do still have a
    // real Iteration tree - forcing the Area -> Sprint -> Plans tree there
    // would leave the Area level permanently empty and nothing pickable.
    // Falling back to a flat Sprint -> Plans list (no area filtering, since
    // there's no area to filter by) only kicks in once the query has
    // actually resolved to zero areas, so projects that do have areas
    // (ItasMutua) are entirely unaffected - they never see this branch.
    if (areaPaths && areaPaths.length === 0) {
        return (
            <nav className={styles.sidebar} aria-label={t("reportSidebar.title")}>
                <Text weight="semibold">{t("reportSidebar.title")}</Text>

                {(iterations ?? []).length === 0 && (
                    <Text className={styles.hint}>
                        {t("reportSidebar.noSprints")}
                    </Text>
                )}

                <div className={styles.sprintList}>
                    {(iterations ?? []).map((iteration) => (
                        <SprintRow
                            key={iteration.id}
                            iteration={iteration}
                            active={sprint === iteration.path}
                            onSelect={() =>
                                onSprintChange(
                                    sprint === iteration.path ? "" : iteration.path
                                )
                            }
                            plans={plans}
                            plansLoading={plansLoading}
                            checkedPlanIds={checkedPlanIds}
                            onTogglePlan={togglePlan}
                            newPlanIds={newPlanIds}
                        />
                    ))}
                </div>
            </nav>
        );
    }

    // Some projects (e.g. Test Factory) don't nest their Iteration tree
    // under a same-named Area Path subtree at all - the two classification
    // trees are unrelated there. Detected once, project-wide: if not a
    // single area has any path-matching sprint, the 1:1 convention below
    // doesn't apply to this project, so every area falls back to the full
    // iteration list instead of silently showing "no sprints" everywhere.
    const anyAreaHasMatchingSprints = (areaPaths ?? []).some((area) =>
        (iterations ?? []).some(
            (iteration) =>
                iteration.path !== area.path &&
                iteration.path.startsWith(`${area.path}\\`)
        )
    );

    return (
        <nav className={styles.sidebar} aria-label={t("reportSidebar.title")}>
            <Text weight="semibold">{t("reportSidebar.title")}</Text>

            <Accordion
                openItems={areaPath ? [areaPath] : []}
                onToggle={(_, data) => toggleAreaPath(String(data.value))}
            >
                {(areaPaths ?? []).map((area) => {
                    // Azure DevOps' Area and Iteration classification trees
                    // are separate endpoints. Where a project names each
                    // team's iteration subtree to match its area path 1:1
                    // (e.g. "Plurifond"'s sprints live under an iteration
                    // node whose path is "<project>\Plurifond\..."),
                    // filtering by path prefix (excluding the exact match,
                    // that subtree's own root node, not a real sprint)
                    // scopes sprints to this area instead of showing every
                    // team's sprints under every area. Projects that don't
                    // follow that convention (see anyAreaHasMatchingSprints
                    // above) fall back to the full iteration list.
                    const areaSprints = anyAreaHasMatchingSprints
                        ? (iterations ?? []).filter(
                              (iteration) =>
                                  iteration.path !== area.path &&
                                  iteration.path.startsWith(`${area.path}\\`)
                          )
                        : (iterations ?? []);

                    return (
                        <AccordionItem key={area.id} value={area.path}>
                            <AccordionHeader>{area.name}</AccordionHeader>
                            <AccordionPanel>
                                {areaSprints.length === 0 && (
                                    <Text className={styles.hint}>
                                        {t("reportSidebar.noSprints")}
                                    </Text>
                                )}
                                <div className={styles.sprintList}>
                                    {areaSprints.map((iteration) => (
                                        <SprintRow
                                            key={iteration.id}
                                            iteration={iteration}
                                            active={sprint === iteration.path}
                                            onSelect={() =>
                                                onSprintChange(
                                                    sprint === iteration.path
                                                        ? ""
                                                        : iteration.path
                                                )
                                            }
                                            plans={plans}
                                            plansLoading={plansLoading}
                                            checkedPlanIds={checkedPlanIds}
                                            onTogglePlan={togglePlan}
                                            newPlanIds={newPlanIds}
                                        />
                                    ))}
                                </div>
                            </AccordionPanel>
                        </AccordionItem>
                    );
                })}
            </Accordion>
        </nav>
    );
}
