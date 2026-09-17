import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Badge,
    Card,
    Tab,
    TabList,
    Text,
    makeStyles,
    tokens,
    type SelectTabData,
    type SelectTabEvent,
} from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { ModuleCoverageBarChart } from "../components/AutomationKpiCharts";
import { fetchAutomationKpis, fetchTestSpecCatalog } from "../api/client";
import type { TestCatalogRow } from "../types";

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
    specCell: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    specFileName: {
        fontFamily: "monospace",
        fontSize: "12px",
        fontWeight: 600,
    },
    specTestCaseTitle: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
    runsStrip: {
        display: "flex",
        gap: "4px",
    },
    runDot: {
        width: "10px",
        height: "10px",
        borderRadius: tokens.borderRadiusCircular,
        flexShrink: 0,
    },
    errorsCell: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        maxWidth: "420px",
    },
    errorLine: {
        fontSize: "12px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    catalogHead: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalS,
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} 0`,
    },
    notLinkedBadge: {
        alignSelf: "flex-start",
    },
});

// This is the Test Factory project's *test-case* automation status
// (Microsoft.VSTS.TCM.AutomationStatus), not the same "automation" tracked
// by CoverageRoadmapPage.tsx/CycleTimeReportPage.tsx (those roll up Epic ->
// child-task completion). Fixed to "Test Factory" for the same reason those
// pages are: this KPI is inherently scoped to that project, not driven by
// the shared ScopeBar project selector.
const PROJECT = "Test Factory";

// "Blocked"/"NotApplicable"/etc. all fall back to neutral - only pass/fail
// need their own color for this strip to read at a glance.
function runDotColor(outcome: string): string {
    const normalized = outcome.toLowerCase();
    if (normalized === "passed") return tokens.colorPaletteGreenForeground1;
    if (normalized === "failed") return tokens.colorPaletteRedForeground1;
    return tokens.colorNeutralForeground3;
}

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

                    <SpecCatalogCard />
                </>
            )}
        </PageLayout>
    );
}

type SpecCatalogKind = "nrt" | "a11y" | "security";
const SPEC_CATALOG_KINDS: SpecCatalogKind[] = ["nrt", "a11y", "security"];

// Separate query from the automation-kpis one above: this needs
// TEST_SUITES_REPORTS_DIR (a repo checkout to scan), a different
// "configured" gate than the ADO-only KPIs, so it fails/loads independently
// rather than taking the whole page down with it.
function SpecCatalogCard() {
    const { t } = useTranslation();
    const styles = useStyles();
    const [kind, setKind] = useState<SpecCatalogKind>("nrt");

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["test-spec-catalog", PROJECT],
        queryFn: () => fetchTestSpecCatalog(PROJECT),
    });

    const handleTabSelect = (_event: SelectTabEvent, tabData: SelectTabData) => {
        setKind(tabData.value as SpecCatalogKind);
    };

    const rows: TestCatalogRow[] = data ? data[kind] : [];

    return (
        <Card>
            <div className={styles.catalogHead}>
                <Text className={styles.tableCardTitle} style={{ padding: 0 }}>
                    {t("automationKpiPage.specCatalog.title")}
                </Text>
                <TabList selectedValue={kind} onTabSelect={handleTabSelect} size="small">
                    {SPEC_CATALOG_KINDS.map((k) => (
                        <Tab key={k} value={k}>
                            {t(`automationKpiPage.specCatalog.tabs.${k}`)}
                        </Tab>
                    ))}
                </TabList>
            </div>

            {isLoading && (
                <Text
                    className={styles.hint}
                    style={{ display: "block", padding: tokens.spacingHorizontalM }}
                >
                    {t("automationKpiPage.specCatalog.loading")}
                </Text>
            )}

            {isError && (
                <div style={{ padding: tokens.spacingHorizontalM }}>
                    <ErrorState message={error.message} onRetry={refetch} />
                </div>
            )}

            {data && !data.configured && (
                <Text
                    className={styles.hint}
                    style={{ display: "block", padding: tokens.spacingHorizontalM }}
                >
                    {t("automationKpiPage.specCatalog.notConfigured")}
                </Text>
            )}

            {data && data.configured && rows.length === 0 && (
                <Text
                    className={styles.hint}
                    style={{ display: "block", padding: tokens.spacingHorizontalM }}
                >
                    {t("automationKpiPage.specCatalog.empty")}
                </Text>
            )}

            {data && data.configured && rows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.tableHeadCell}>
                                    {t("automationKpiPage.table.specFile")}
                                </th>
                                <th className={styles.tableHeadCell}>
                                    {t("automationKpiPage.table.browser")}
                                </th>
                                <th className={styles.tableHeadCell}>
                                    {t("automationKpiPage.table.lastRuns")}
                                </th>
                                <th className={styles.tableHeadCell}>
                                    {t("automationKpiPage.table.topErrors")}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.specPath}>
                                    <td className={styles.tableCell}>
                                        <div className={styles.specCell}>
                                            <span className={styles.specFileName}>
                                                {row.specFile}
                                            </span>
                                            {row.testCaseTitle && (
                                                <span className={styles.specTestCaseTitle}>
                                                    {row.testCaseTitle}
                                                </span>
                                            )}
                                            {kind !== "nrt" && !row.testCaseId && (
                                                <Badge
                                                    className={styles.notLinkedBadge}
                                                    appearance="tint"
                                                    color="informative"
                                                    size="small"
                                                >
                                                    {t("automationKpiPage.specCatalog.notLinked")}
                                                </Badge>
                                            )}
                                        </div>
                                    </td>
                                    <td className={styles.tableCell}>
                                        {row.browsers.length === 0 ? "—" : row.browsers.join(", ")}
                                    </td>
                                    <td className={styles.tableCell}>
                                        {row.lastRuns.length === 0 ? (
                                            "—"
                                        ) : (
                                            <div className={styles.runsStrip}>
                                                {[...row.lastRuns]
                                                    .reverse()
                                                    .map((run, i) => (
                                                        <span
                                                            key={i}
                                                            className={styles.runDot}
                                                            style={{
                                                                backgroundColor:
                                                                    runDotColor(run.outcome),
                                                            }}
                                                            title={`${run.outcome}${
                                                                run.browser ? ` (${run.browser})` : ""
                                                            } - ${new Date(
                                                                run.completedDate
                                                            ).toLocaleString()}`}
                                                        />
                                                    ))}
                                            </div>
                                        )}
                                    </td>
                                    <td className={styles.tableCell}>
                                        {row.topErrors.length === 0 ? (
                                            <Text className={styles.hint}>
                                                {t("automationKpiPage.table.noErrors")}
                                            </Text>
                                        ) : (
                                            <div className={styles.errorsCell}>
                                                {row.topErrors.map((err, i) => (
                                                    <span
                                                        key={i}
                                                        className={styles.errorLine}
                                                        title={err.message}
                                                    >
                                                        ({err.count}×) {err.message}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
}
