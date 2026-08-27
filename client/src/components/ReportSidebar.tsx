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

    return (
        <nav className={styles.sidebar} aria-label={t("reportSidebar.title")}>
            <Text weight="semibold">{t("reportSidebar.title")}</Text>

            <Accordion
                openItems={areaPath ? [areaPath] : []}
                onToggle={(_, data) => toggleAreaPath(String(data.value))}
            >
                {(areaPaths ?? []).map((area) => {
                    // Azure DevOps' Area and Iteration classification
                    // trees are separate endpoints, but in this project
                    // each team's iteration subtree is named to match its
                    // area path 1:1 - so "Plurifond"'s sprints live under
                    // an iteration node whose path is
                    // "<project>\Plurifond\...". Filtering by path prefix
                    // (excluding the exact match, which is that subtree's
                    // own root node, not a real sprint) scopes sprints to
                    // this area instead of showing every team's sprints
                    // under every area.
                    const areaSprints = (iterations ?? []).filter(
                        (iteration) =>
                            iteration.path !== area.path &&
                            iteration.path.startsWith(`${area.path}\\`)
                    );

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
                                    <div key={iteration.id} className={styles.sprintRow}>
                                        <button
                                            type="button"
                                            className={
                                                sprint === iteration.path
                                                    ? `${styles.sprintButton} ${styles.sprintButtonSelected}`
                                                    : styles.sprintButton
                                            }
                                            onClick={() =>
                                                onSprintChange(
                                                    sprint === iteration.path
                                                        ? ""
                                                        : iteration.path
                                                )
                                            }
                                        >
                                            {iteration.name}
                                        </button>

                                        {sprint === iteration.path && (
                                            <div className={styles.planList}>
                                                {plansLoading && (
                                                    <Text className={styles.hint}>
                                                        {t("reportSidebar.loadingPlans")}
                                                    </Text>
                                                )}

                                                {!plansLoading && plans.length === 0 && (
                                                    <Text className={styles.hint}>
                                                        {t("reportSidebar.noPlans")}
                                                    </Text>
                                                )}

                                                {!plansLoading &&
                                                    plans.map((plan) => (
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
                                                            onChange={(_, data) =>
                                                                togglePlan(plan.id, !!data.checked)
                                                            }
                                                        />
                                                    ))}
                                            </div>
                                        )}
                                    </div>
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
