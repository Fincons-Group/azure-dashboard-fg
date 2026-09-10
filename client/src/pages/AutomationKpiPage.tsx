import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card, Text, makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { ModuleCoverageBarChart } from "../components/AutomationKpiCharts";
import { fetchAutomationKpis } from "../api/client";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
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
        fontSize: "24px",
        fontWeight: 700,
        color: tokens.colorBrandForeground1,
    },
    statLabel: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    chartCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    chartTitle: {
        fontSize: "14px",
        fontWeight: 600,
    },
    tableCardTitle: {
        fontSize: "14px",
        fontWeight: 600,
        display: "block",
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} 0`,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeadCell: {
        textAlign: "left",
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCell: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        fontSize: "13px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCellNum: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        fontSize: "13px",
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
});

// This is the Test Factory project's *test-case* automation status
// (Microsoft.VSTS.TCM.AutomationStatus), not the same "automation" tracked
// by CoverageRoadmapPage.tsx/CycleTimeReportPage.tsx (those roll up Epic ->
// child-task completion). Fixed to "Test Factory" for the same reason those
// pages are: this KPI is inherently scoped to that project, not driven by
// the shared ScopeBar project selector.
const PROJECT = "Test Factory";

export function AutomationKpiPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["automation-kpis", PROJECT],
        queryFn: () => fetchAutomationKpis(PROJECT),
    });

    const hasData = !!data && (data.kpis.automatedTests + data.kpis.manualTests) > 0;

    return (
        <PageLayout title={t("automationKpiPage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>
                {t("automationKpiPage.subtitle")}
            </Text>

            {isLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && !hasData && (
                <Text className={styles.hint}>
                    {t("automationKpiPage.noTestCases")}
                </Text>
            )}

            {data && hasData && (
                <>
                    <div className={styles.statRow}>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {t("automationKpiPage.coveragePctValue", {
                                    pct: data.kpis.automationCoveragePct,
                                })}
                            </span>
                            <span className={styles.statLabel}>
                                {t("automationKpiPage.stats.coverage")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {data.kpis.automatedTests}
                            </span>
                            <span className={styles.statLabel}>
                                {t("automationKpiPage.stats.automatedTests")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {data.kpis.manualTests}
                            </span>
                            <span className={styles.statLabel}>
                                {t("automationKpiPage.stats.manualTests")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {t("automationKpiPage.coveragePctValue", {
                                    pct: data.kpis.automationSuccessRatePct,
                                })}
                            </span>
                            <span className={styles.statLabel}>
                                {t("automationKpiPage.stats.successRate")}
                            </span>
                        </Card>
                    </div>

                    {data.coverageByModule.length > 0 && (
                        <Card className={styles.chartCard}>
                            <Text className={styles.chartTitle}>
                                {t("automationKpiPage.moduleChartTitle")}
                            </Text>
                            <ModuleCoverageBarChart modules={data.coverageByModule} />
                        </Card>
                    )}

                    <Card>
                        <Text className={styles.tableCardTitle}>
                            {t("automationKpiPage.flakyTestsTitle", {
                                count: data.flakyTests.length,
                            })}
                        </Text>
                        {data.flakyTests.length === 0 ? (
                            <Text
                                className={styles.hint}
                                style={{ display: "block", padding: tokens.spacingHorizontalM }}
                            >
                                {t("automationKpiPage.noFlakyTests")}
                            </Text>
                        ) : (
                            <div style={{ overflowX: "auto" }}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th className={styles.tableHeadCell}>
                                                {t("automationKpiPage.table.testCase")}
                                            </th>
                                            <th
                                                className={styles.tableHeadCell}
                                                style={{ textAlign: "right" }}
                                            >
                                                {t("automationKpiPage.table.flakeCount")}
                                            </th>
                                            <th className={styles.tableHeadCell}>
                                                {t("automationKpiPage.table.lastFailed")}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.flakyTests.map((flaky) => (
                                            <tr key={flaky.testCaseId}>
                                                <td className={styles.tableCell}>
                                                    {flaky.testName}
                                                </td>
                                                <td className={styles.tableCellNum}>
                                                    {flaky.flakeCount}
                                                </td>
                                                <td className={styles.tableCell}>
                                                    {flaky.lastFailedDate
                                                        ? new Date(
                                                              flaky.lastFailedDate
                                                          ).toLocaleDateString()
                                                        : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </>
            )}
        </PageLayout>
    );
}
