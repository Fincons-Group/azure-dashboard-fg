import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card, Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { WrenchRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { E2ePassRateTrendChart } from "../components/E2eHistoryCharts";
import { PaginationControls } from "../components/PaginationControls";
import { usePagination } from "../hooks/usePagination";
import { fetchE2eHistory } from "../api/client";

const TABLE_PAGE_SIZE = 8;

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    placeholderCard: {
        padding: tokens.spacingHorizontalXXL,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: tokens.spacingVerticalS,
    },
    placeholderIcon: {
        fontSize: "32px",
        color: tokens.colorNeutralForeground3,
    },
    placeholderBody: {
        color: tokens.colorNeutralForeground3,
        maxWidth: "480px",
    },
    statRow: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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

function passRatePct(totalTests: number, passed: number): number {
    return totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
}

export function E2eHistoryPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["e2e-history"],
        queryFn: () => fetchE2eHistory(30),
    });

    // Server returns newest-first; the table wants that order but the trend
    // chart reads left-to-right chronologically, so it gets a reversed copy.
    const runs = data?.runs ?? [];
    const runsPagination = usePagination(runs, TABLE_PAGE_SIZE);
    const latest = runs[0];

    return (
        <PageLayout title={t("e2eHistoryPage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>
                {t("e2eHistoryPage.subtitle")}
            </Text>

            {isLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && !data.configured && (
                <Card className={styles.placeholderCard}>
                    <WrenchRegular className={styles.placeholderIcon} />
                    <Text weight="semibold">
                        {t("e2eHistoryPage.notConfiguredTitle")}
                    </Text>
                    <Text className={styles.placeholderBody}>
                        {t("e2eHistoryPage.notConfiguredBody")}
                    </Text>
                </Card>
            )}

            {data && data.configured && runs.length === 0 && (
                <Card className={styles.placeholderCard}>
                    <WrenchRegular className={styles.placeholderIcon} />
                    <Text weight="semibold">
                        {t("e2eHistoryPage.noRunsTitle")}
                    </Text>
                    <Text className={styles.placeholderBody}>
                        {t("e2eHistoryPage.noRunsBody")}
                    </Text>
                </Card>
            )}

            {data && data.configured && latest && (
                <>
                    <div className={styles.statRow}>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {t("e2eHistoryPage.passRateValue", {
                                    pct: passRatePct(latest.totalTests, latest.passed),
                                })}
                            </span>
                            <span className={styles.statLabel}>
                                {t("e2eHistoryPage.stats.passRate")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {latest.totalTests}
                            </span>
                            <span className={styles.statLabel}>
                                {t("e2eHistoryPage.stats.totalTests")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {latest.flaky}
                            </span>
                            <span className={styles.statLabel}>
                                {t("e2eHistoryPage.stats.flaky")}
                            </span>
                        </Card>
                    </div>

                    {runs.length > 1 && (
                        <Card className={styles.chartCard}>
                            <Text className={styles.chartTitle}>
                                {t("e2eHistoryPage.chartTitle")}
                            </Text>
                            <E2ePassRateTrendChart runs={[...runs].reverse()} />
                        </Card>
                    )}

                    <Card>
                        <Text className={styles.tableCardTitle}>
                            {t("e2eHistoryPage.table.title")}
                        </Text>
                        <div style={{ overflowX: "auto" }}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th className={styles.tableHeadCell}>
                                            {t("e2eHistoryPage.table.date")}
                                        </th>
                                        <th className={styles.tableHeadCell}>
                                            {t("e2eHistoryPage.table.branch")}
                                        </th>
                                        <th className={styles.tableHeadCell}>
                                            {t("e2eHistoryPage.table.commit")}
                                        </th>
                                        <th
                                            className={styles.tableHeadCell}
                                            style={{ textAlign: "right" }}
                                        >
                                            {t("e2eHistoryPage.table.passRate")}
                                        </th>
                                        <th
                                            className={styles.tableHeadCell}
                                            style={{ textAlign: "right" }}
                                        >
                                            {t("e2eHistoryPage.table.tests")}
                                        </th>
                                        <th
                                            className={styles.tableHeadCell}
                                            style={{ textAlign: "right" }}
                                        >
                                            {t("e2eHistoryPage.table.flaky")}
                                        </th>
                                        <th className={styles.tableHeadCell}>
                                            {t("e2eHistoryPage.table.report")}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {runsPagination.pageItems.map((run) => (
                                        <tr key={run.id}>
                                            <td className={styles.tableCell}>
                                                {new Date(run.startedAt).toLocaleString()}
                                            </td>
                                            <td className={styles.tableCell}>{run.branch}</td>
                                            <td className={styles.tableCell}>
                                                {run.commitSha
                                                    ? run.commitSha.slice(0, 7)
                                                    : "—"}
                                            </td>
                                            <td className={styles.tableCellNum}>
                                                {t("e2eHistoryPage.passRateValue", {
                                                    pct: passRatePct(run.totalTests, run.passed),
                                                })}
                                            </td>
                                            <td className={styles.tableCellNum}>
                                                {run.passed} / {run.totalTests}
                                            </td>
                                            <td className={styles.tableCellNum}>{run.flaky}</td>
                                            <td className={styles.tableCell}>
                                                {run.reportUrl ? (
                                                    <Link
                                                        href={run.reportUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        {t("e2eHistoryPage.viewReport")}
                                                    </Link>
                                                ) : (
                                                    "—"
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <PaginationControls
                            page={runsPagination.page}
                            pageCount={runsPagination.pageCount}
                            total={runs.length}
                            pageSize={TABLE_PAGE_SIZE}
                            onPageChange={runsPagination.setPage}
                        />
                    </Card>
                </>
            )}
        </PageLayout>
    );
}
