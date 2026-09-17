import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Badge,
    Card,
    Input,
    Spinner,
    Text,
    Title2,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import { OpenRegular, SearchRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { ErrorState } from "../components/ErrorState";
import { useScope } from "../hooks/useScope";
import { fetchPlans, fetchPlanOverview } from "../api/client";
import type { Outcome, PlanOverviewTestCase } from "../types";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    layout: {
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: tokens.spacingHorizontalM,
        alignItems: "start",
    },
    sideCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        // Independent scroll region so a long plan list never pushes the
        // detail panel below the fold.
        maxHeight: "calc(100vh - 260px)",
    },
    planList: {
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    planRow: {
        width: "100%",
        textAlign: "left",
        border: "2px solid transparent",
        backgroundColor: "transparent",
        // A plain <button> doesn't inherit the page's text color from the UA
        // stylesheet (defaults to black), which read as unreadable/near-
        // invisible against this card's dark background - same root cause as
        // the test-case link color fix above.
        color: tokens.colorNeutralForeground1,
        borderRadius: tokens.borderRadiusMedium,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground3,
        },
    },
    planRowActive: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        borderTopColor: tokens.colorBrandStroke1,
        borderRightColor: tokens.colorBrandStroke1,
        borderBottomColor: tokens.colorBrandStroke1,
        borderLeftColor: tokens.colorBrandStroke1,
    },
    planName: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
    },
    planMeta: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        display: "flex",
        gap: tokens.spacingHorizontalXS,
        flexWrap: "wrap",
    },
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    detailCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    detailHead: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    detailSub: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        flexWrap: "wrap",
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    openLink: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        color: tokens.colorBrandForeground1,
        fontWeight: tokens.fontWeightSemibold,
        textDecorationLine: "none",
    },
    statRow: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    statTile: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        borderTopWidth: "3px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorBrandStroke1,
    },
    statValue: {
        fontSize: "22px",
        fontWeight: 700,
        color: tokens.colorBrandForeground1,
    },
    statLabel: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    tableCardTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeadCell: {
        textAlign: "left",
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCell: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        fontSize: tokens.fontSizeBase200,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    runLink: {
        color: tokens.colorBrandForeground1,
        fontWeight: tokens.fontWeightSemibold,
        textDecorationLine: "none",
        fontFamily: tokens.fontFamilyMonospace,
    },
    testCaseLink: {
        color: tokens.colorBrandForeground1,
        textDecorationLine: "none",
        ":hover": {
            textDecorationLine: "underline",
        },
    },
});

function outcomeToBadgeColor(
    outcome: Outcome
): "success" | "danger" | "severe" | "warning" | "informative" | "subtle" {
    switch (outcome) {
        case "Passed":
            return "success";
        case "Failed":
            return "danger";
        case "Blocked":
            return "severe";
        case "InProgress":
            return "warning";
        case "NotApplicable":
        case "Paused":
            return "subtle";
        default:
            return "informative";
    }
}

function formatDateTime(iso: string | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function matchesSearch(testCase: PlanOverviewTestCase, needle: string): boolean {
    if (!needle) return true;
    const haystacks = [
        testCase.title,
        String(testCase.testCaseId),
        testCase.suiteName,
        testCase.lastRunId != null ? String(testCase.lastRunId) : "",
    ];
    return haystacks.some((h) => h.toLowerCase().includes(needle));
}

export function TestPlansPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const scope = useScope();

    const [planSearch, setPlanSearch] = useState("");
    const [testCaseSearch, setTestCaseSearch] = useState("");
    const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

    const {
        data: plans,
        isLoading: plansLoading,
        isError: plansError,
        error: plansErrorObj,
        refetch: refetchPlans,
    } = useQuery({
        queryKey: ["test-plans", scope.project],
        queryFn: () => fetchPlans(scope.project),
        enabled: !!scope.project,
    });

    const filteredPlans = useMemo(() => {
        const needle = planSearch.trim().toLowerCase();
        const list = plans ?? [];
        if (!needle) return list;
        return list.filter(
            (plan) =>
                plan.name.toLowerCase().includes(needle) ||
                String(plan.id).includes(needle)
        );
    }, [plans, planSearch]);

    const selectedPlan = (plans ?? []).find((p) => p.id === selectedPlanId) ?? null;

    const {
        data: overview,
        isLoading: overviewLoading,
        isError: overviewError,
        error: overviewErrorObj,
        refetch: refetchOverview,
    } = useQuery({
        queryKey: ["test-plan-overview", scope.project, selectedPlanId],
        queryFn: () => fetchPlanOverview(selectedPlanId!, scope.project),
        enabled: !!scope.project && selectedPlanId != null,
    });

    const testCases = overview?.testCases ?? [];
    const filteredTestCases = useMemo(() => {
        const needle = testCaseSearch.trim().toLowerCase();
        return (overview?.testCases ?? []).filter((tc) => matchesSearch(tc, needle));
    }, [overview, testCaseSearch]);

    const selectPlan = (planId: number) => {
        setSelectedPlanId(planId);
        setTestCaseSearch("");
    };

    return (
        <PageLayout title={t("testPlansPage.title")} wide>
            <Text className={styles.subtitle}>{t("testPlansPage.subtitle")}</Text>

            {!scope.project && (
                <Text className={styles.hint}>{t("testPlansPage.pickProject")}</Text>
            )}

            {scope.project && plansError && (
                <ErrorState message={plansErrorObj.message} onRetry={refetchPlans} />
            )}

            {scope.project && !plansError && (
                <div className={styles.layout}>
                    <Card className={styles.sideCard}>
                        <Input
                            contentBefore={<SearchRegular />}
                            placeholder={t("testPlansPage.searchPlansPlaceholder")}
                            value={planSearch}
                            onChange={(_, data) => setPlanSearch(data.value)}
                        />

                        {plansLoading && <Spinner size="small" label={t("testPlansPage.loadingPlans")} />}

                        {!plansLoading && filteredPlans.length === 0 && (
                            <Text className={styles.hint}>{t("testPlansPage.noPlans")}</Text>
                        )}

                        <div className={styles.planList}>
                            {filteredPlans.map((plan) => (
                                <button
                                    key={plan.id}
                                    type="button"
                                    className={mergeClasses(
                                        styles.planRow,
                                        plan.id === selectedPlanId && styles.planRowActive
                                    )}
                                    onClick={() => selectPlan(plan.id)}
                                >
                                    <span className={styles.planName}>{plan.name}</span>
                                    <span className={styles.planMeta}>
                                        <span>#{plan.id}</span>
                                        {plan.iteration && <span>· {plan.iteration}</span>}
                                        {plan.owner && <span>· {plan.owner}</span>}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </Card>

                    {!selectedPlan && (
                        <Card className={styles.detailCard}>
                            <Text className={styles.hint}>{t("testPlansPage.selectPlanHint")}</Text>
                        </Card>
                    )}

                    {selectedPlan && overviewLoading && (
                        <Card className={styles.detailCard}>
                            <Spinner label={t("testPlansPage.loadingOverview")} />
                        </Card>
                    )}

                    {selectedPlan && overviewError && (
                        <ErrorState
                            message={overviewErrorObj.message}
                            onRetry={refetchOverview}
                        />
                    )}

                    {selectedPlan && overview && !overviewLoading && !overviewError && (
                        <Card className={styles.detailCard}>
                            <div className={styles.detailHead}>
                                <div>
                                    <Title2 as="h2">{overview.planName}</Title2>
                                    <div className={styles.detailSub}>
                                        <span>#{overview.planId}</span>
                                        {selectedPlan.areaPath && <span>&middot; {selectedPlan.areaPath}</span>}
                                        {selectedPlan.iteration && <span>&middot; {selectedPlan.iteration}</span>}
                                        {selectedPlan.state && <span>&middot; {selectedPlan.state}</span>}
                                    </div>
                                </div>
                                {selectedPlan.url && (
                                    <a
                                        className={styles.openLink}
                                        href={selectedPlan.url}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        <OpenRegular />
                                        {t("testPlansPage.openInAdo")}
                                    </a>
                                )}
                            </div>

                            <div className={styles.statRow}>
                                <Card className={styles.statTile}>
                                    <span className={styles.statValue}>{overview.totalTestCases}</span>
                                    <span className={styles.statLabel}>{t("testPlansPage.stats.totalTestCases")}</span>
                                </Card>
                                <Card className={styles.statTile}>
                                    <span className={styles.statValue}>{overview.outcomeCounts.Passed}</span>
                                    <span className={styles.statLabel}>{t("outcome.Passed")}</span>
                                </Card>
                                <Card className={styles.statTile}>
                                    <span className={styles.statValue}>{overview.outcomeCounts.Failed}</span>
                                    <span className={styles.statLabel}>{t("outcome.Failed")}</span>
                                </Card>
                                <Card className={styles.statTile}>
                                    <span className={styles.statValue}>{overview.totalBugs}</span>
                                    <span className={styles.statLabel}>{t("testPlansPage.stats.totalBugs")}</span>
                                </Card>
                            </div>

                            <div>
                                <div className={styles.tableCardTitle}>
                                    <span>
                                        {t("testPlansPage.testCasesTitle", {
                                            count: filteredTestCases.length,
                                            total: testCases.length,
                                        })}
                                    </span>
                                    <Input
                                        contentBefore={<SearchRegular />}
                                        placeholder={t("testPlansPage.searchTestCasesPlaceholder")}
                                        value={testCaseSearch}
                                        onChange={(_, data) => setTestCaseSearch(data.value)}
                                    />
                                </div>

                                {testCases.length === 0 ? (
                                    <Text className={styles.hint}>{t("testPlansPage.noTestCases")}</Text>
                                ) : (
                                    <div style={{ overflowX: "auto" }}>
                                        <table className={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th className={styles.tableHeadCell}>{t("testPlansPage.table.testCase")}</th>
                                                    <th className={styles.tableHeadCell}>{t("testPlansPage.table.suite")}</th>
                                                    <th className={styles.tableHeadCell}>{t("testPlansPage.table.outcome")}</th>
                                                    <th className={styles.tableHeadCell}>{t("testPlansPage.table.lastRun")}</th>
                                                    <th className={styles.tableHeadCell}>{t("testPlansPage.table.lastRunAt")}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredTestCases.map((tc) => (
                                                    <tr key={tc.testCaseId}>
                                                        <td className={styles.tableCell}>
                                                            {tc.url ? (
                                                                <a
                                                                    className={styles.testCaseLink}
                                                                    href={tc.url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                >
                                                                    {tc.title}
                                                                </a>
                                                            ) : (
                                                                tc.title
                                                            )}
                                                        </td>
                                                        <td className={styles.tableCell}>{tc.suiteName}</td>
                                                        <td className={styles.tableCell}>
                                                            <Badge appearance="filled" color={outcomeToBadgeColor(tc.outcome)}>
                                                                {t(`outcome.${tc.outcome}`)}
                                                            </Badge>
                                                        </td>
                                                        <td className={styles.tableCell}>
                                                            {tc.lastRunId != null ? (
                                                                tc.lastRunUrl ? (
                                                                    <a
                                                                        className={styles.runLink}
                                                                        href={tc.lastRunUrl}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                    >
                                                                        #{tc.lastRunId}
                                                                    </a>
                                                                ) : (
                                                                    `#${tc.lastRunId}`
                                                                )
                                                            ) : (
                                                                "—"
                                                            )}
                                                        </td>
                                                        <td className={styles.tableCell}>{formatDateTime(tc.lastRunAt)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </Card>
                    )}
                </div>
            )}
        </PageLayout>
    );
}
