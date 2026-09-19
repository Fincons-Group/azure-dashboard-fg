import { useMemo, useState } from "react";
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
import { BuildTrendLineChart, SuiteStackedBarChart, EscapesBarChart } from "../components/QualityPulseCharts";
import { fetchAutomationKpis, fetchTestSuites } from "../api/client";
import { buildSuiteAnalytics, buildFlakyRows } from "./qualityPulseData";
import {
    PIPELINE_STAGES,
    BUILD_TREND,
    DEFECT_ESCAPES,
    COVERAGE_BY_MODULE,
    HIGHEST_RISK_MODULE,
    SAMPLE_SUITE_HEALTH_PCT,
    SAMPLE_QUARANTINED_COUNT,
    pipelineGate,
    type PipelineHealth,
} from "./qualityPulseMockData";

// Same fixed project as AutomationKpiPage.tsx - this KPI is inherently
// scoped to Test Factory, and reusing the exact queryKey shares its cache
// instead of firing a second request if that page was already visited.
const PROJECT = "Test Factory";

// Role lens for the page: same four sections/data, different slice. Tab
// chrome deliberately uses the standard dashboard-tier terms (Engineering /
// Operations / Governance / Executive) rather than literal job titles -
// Engineering = automation engineers, Operations = QA leads (+ DevOps for
// the pipeline), Governance = QA principals (coverage/risk strategy),
// Executive = managers (headline numbers only, no chart detail).
type Tier = "engineering" | "operations" | "governance" | "executive";
const TIERS: Tier[] = ["engineering", "operations", "governance", "executive"];

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    sampleBadge: {
        alignSelf: "flex-start",
    },
    tierRow: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    tierHint: {
        fontSize: tokens.fontSizeBase200,
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
    statTileGood: { borderTopColor: tokens.colorPaletteGreenForeground1 },
    statTileWarning: { borderTopColor: tokens.colorPaletteMarigoldForeground1 },
    statTileRisk: { borderTopColor: tokens.colorPaletteRedForeground1 },
    statValue: {
        fontSize: "24px",
        fontWeight: 700,
    },
    statLabel: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    statDetail: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    card: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    cardHead: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    cardTitleRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    cardTitle: {
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    cardMeta: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    gateRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    stageRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalS,
    },
    stagePill: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
        minWidth: "180px",
    },
    stageName: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    stageDetail: {
        fontSize: tokens.fontSizeBase100,
        color: tokens.colorNeutralForeground3,
    },
    chartTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
    },
    gridTwo: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: tokens.spacingHorizontalM,
        alignItems: "start",
    },
    riskNote: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorPaletteRedForeground1,
        fontWeight: tokens.fontWeightSemibold,
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

function healthBadgeColor(health: PipelineHealth): "success" | "warning" | "danger" {
    if (health === "good") return "success";
    if (health === "warn") return "warning";
    return "danger";
}

function formatLastRun(iso: string, language: string): string {
    return new Date(iso).toLocaleString(language, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function CardHead({
    title,
    audienceKey,
    actionKey,
    live,
}: {
    title: string;
    audienceKey: string;
    actionKey: string;
    live?: boolean;
}) {
    const styles = useStyles();
    const { t } = useTranslation();

    return (
        <div className={styles.cardHead}>
            <div className={styles.cardTitleRow}>
                <Text className={styles.cardTitle}>{title}</Text>
                {live && (
                    <Badge appearance="tint" color="success" size="small">
                        {t("qualityPulsePage.liveDataBadge")}
                    </Badge>
                )}
            </div>
            <Text className={styles.cardMeta}>
                {t(audienceKey)} &middot; {t(actionKey)}
            </Text>
        </div>
    );
}

// Behind AppSettings.showExperimentalPages. The Engineering tab (Suite
// Analytics + Flaky Test Monitor) runs on real data - the same
// /api/automation-kpis and /api/test-suites AutomationKpiPage.tsx and
// TestSuitesPage.tsx already fetch, reshaped by qualityPulseData.ts.
// Operations/Governance/Executive still run on generated sample data
// (qualityPulseMockData.ts) - no CI/CD pipeline source and no "Found In"
// defect field exist in this project yet, see that file's header comment.
export function QualityPulsePage() {
    const { t, i18n } = useTranslation();
    const styles = useStyles();
    const [tier, setTier] = useState<Tier>("engineering");

    const gate = pipelineGate(PIPELINE_STAGES);

    const {
        data: automationKpis,
        isLoading: automationKpisLoading,
        isError: automationKpisError,
        error: automationKpisErrorObj,
        refetch: refetchAutomationKpis,
    } = useQuery({
        queryKey: ["automation-kpis", PROJECT],
        queryFn: () => fetchAutomationKpis(PROJECT),
    });

    const {
        data: testSuites,
        isLoading: testSuitesLoading,
        isError: testSuitesError,
        error: testSuitesErrorObj,
        refetch: refetchTestSuites,
    } = useQuery({
        queryKey: ["test-suites"],
        queryFn: fetchTestSuites,
    });

    const suiteAnalytics = useMemo(() => buildSuiteAnalytics(testSuites?.runs ?? []), [testSuites]);
    const flakyRows = useMemo(() => buildFlakyRows(automationKpis?.flakyTests ?? []), [automationKpis]);

    return (
        <PageLayout title={t("qualityPulsePage.title")} hideAreaSprintScope wide>
            <Text className={styles.subtitle}>{t("qualityPulsePage.subtitle")}</Text>
            <Badge className={styles.sampleBadge} appearance="tint" color="informative" size="small">
                {t("qualityPulsePage.sampleDataBadge")}
            </Badge>

            <div className={styles.tierRow}>
                <TabList
                    selectedValue={tier}
                    onTabSelect={(_: SelectTabEvent, data: SelectTabData) => setTier(data.value as Tier)}
                >
                    {TIERS.map((tr) => (
                        <Tab key={tr} value={tr}>
                            {t(`qualityPulsePage.tiers.${tr}`)}
                        </Tab>
                    ))}
                </TabList>
                <Text className={styles.tierHint}>{t(`qualityPulsePage.tierHint.${tier}`)}</Text>
            </div>

            {tier === "executive" && (
                <Card className={styles.card}>
                    <CardHead
                        title={t("qualityPulsePage.executive.title")}
                        audienceKey="qualityPulsePage.executive.audience"
                        actionKey="qualityPulsePage.executive.action"
                    />
                    <div className={styles.statRow}>
                        <Card
                            className={
                                styles.statTile +
                                " " +
                                (gate === "good" ? styles.statTileGood : gate === "warn" ? styles.statTileWarning : styles.statTileRisk)
                            }
                        >
                            <span className={styles.statValue}>{t(`qualityPulsePage.pipeline.gate.${gate}`)}</span>
                            <span className={styles.statLabel}>{t("qualityPulsePage.executive.gateLabel")}</span>
                        </Card>
                        <Card
                            className={
                                styles.statTile +
                                " " +
                                (SAMPLE_SUITE_HEALTH_PCT >= 95
                                    ? styles.statTileGood
                                    : SAMPLE_SUITE_HEALTH_PCT >= 85
                                      ? styles.statTileWarning
                                      : styles.statTileRisk)
                            }
                        >
                            <span className={styles.statValue}>{SAMPLE_SUITE_HEALTH_PCT}%</span>
                            <span className={styles.statLabel}>{t("qualityPulsePage.executive.suiteHealthLabel")}</span>
                        </Card>
                        <Card
                            className={
                                styles.statTile + " " + (SAMPLE_QUARANTINED_COUNT === 0 ? styles.statTileGood : styles.statTileRisk)
                            }
                        >
                            <span className={styles.statValue}>{SAMPLE_QUARANTINED_COUNT}</span>
                            <span className={styles.statLabel}>{t("qualityPulsePage.executive.flakyLabel")}</span>
                        </Card>
                        <Card className={styles.statTile + " " + styles.statTileRisk}>
                            <span className={styles.statValue}>{HIGHEST_RISK_MODULE.module}</span>
                            <span className={styles.statLabel}>{t("qualityPulsePage.executive.riskLabel")}</span>
                            <span className={styles.statDetail}>
                                {t("qualityPulsePage.defectEscapes.escapesCount", { count: HIGHEST_RISK_MODULE.escapes })}
                                {" · "}
                                {HIGHEST_RISK_MODULE.coveragePct}% coverage
                            </span>
                        </Card>
                    </div>
                </Card>
            )}

            {tier === "operations" && (
                <Card className={styles.card}>
                    <CardHead
                        title={t("qualityPulsePage.pipeline.title")}
                        audienceKey="qualityPulsePage.pipeline.audience"
                        actionKey="qualityPulsePage.pipeline.action"
                    />

                    <div className={styles.gateRow}>
                        <Badge appearance="filled" color={healthBadgeColor(gate)} size="extra-large">
                            {t(`qualityPulsePage.pipeline.gate.${gate}`)}
                        </Badge>
                    </div>

                    <div className={styles.stageRow}>
                        {PIPELINE_STAGES.map((stage) => (
                            <div key={stage.id} className={styles.stagePill}>
                                <div className={styles.stageName}>{stage.name}</div>
                                <Badge appearance="filled" color={healthBadgeColor(stage.health)} size="small">
                                    {t(`qualityPulsePage.pipeline.status.${stage.health}`)}
                                </Badge>
                                <span className={styles.stageDetail}>
                                    {t("qualityPulsePage.pipeline.lastRun", { time: formatLastRun(stage.lastRunAt, i18n.language) })}
                                    {" · "}
                                    {t("qualityPulsePage.pipeline.duration", { minutes: stage.durationMinutes })}
                                </span>
                            </div>
                        ))}
                    </div>

                    <Text className={styles.chartTitle}>{t("qualityPulsePage.pipeline.trendChartTitle")}</Text>
                    <BuildTrendLineChart points={BUILD_TREND} />
                </Card>
            )}

            {tier === "engineering" && (
                <>
                    <Card className={styles.card}>
                        <CardHead
                            title={t("qualityPulsePage.suiteAnalytics.title")}
                            audienceKey="qualityPulsePage.suiteAnalytics.audience"
                            actionKey="qualityPulsePage.suiteAnalytics.action"
                            live
                        />
                        {testSuitesLoading && <LoadingCardGrid count={1} />}
                        {testSuitesError && (
                            <ErrorState message={testSuitesErrorObj.message} onRetry={() => void refetchTestSuites()} />
                        )}
                        {testSuites && !testSuites.configured && (
                            <Text className={styles.cardMeta}>{t("testSuitesPage.notConfiguredBody")}</Text>
                        )}
                        {testSuites?.configured && suiteAnalytics.length === 0 && (
                            <Text className={styles.cardMeta}>{t("qualityPulsePage.suiteAnalytics.empty")}</Text>
                        )}
                        {testSuites?.configured && suiteAnalytics.length > 0 && (
                            <>
                                <Text className={styles.chartTitle}>{t("qualityPulsePage.suiteAnalytics.chartTitle")}</Text>
                                <SuiteStackedBarChart modules={suiteAnalytics} />
                            </>
                        )}
                    </Card>

                    <Card className={styles.card}>
                        <CardHead
                            title={t("qualityPulsePage.flakyMonitor.title")}
                            audienceKey="qualityPulsePage.flakyMonitor.audience"
                            actionKey="qualityPulsePage.flakyMonitor.action"
                            live
                        />
                        {automationKpisLoading && <LoadingCardGrid count={1} />}
                        {automationKpisError && (
                            <ErrorState message={automationKpisErrorObj.message} onRetry={() => void refetchAutomationKpis()} />
                        )}
                        {automationKpis && flakyRows.length === 0 && (
                            <Text className={styles.cardMeta}>{t("qualityPulsePage.flakyMonitor.empty")}</Text>
                        )}
                        {automationKpis && flakyRows.length > 0 && (
                            <div style={{ overflowX: "auto" }}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.test")}</th>
                                            <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                                {t("qualityPulsePage.flakyMonitor.table.flakeCount")}
                                            </th>
                                            <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.status")}</th>
                                            <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.lastSeen")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {flakyRows.map((row) => (
                                            <tr key={row.testCaseId}>
                                                <td className={styles.tableCell}>
                                                    {row.testName} <Text className={styles.cardMeta}>#{row.testCaseId}</Text>
                                                </td>
                                                <td className={styles.tableCellNum}>{row.flakeCount}</td>
                                                <td className={styles.tableCell}>
                                                    <Badge appearance="filled" color={row.status === "quarantined" ? "danger" : "warning"} size="small">
                                                        {t(`qualityPulsePage.flakyMonitor.status.${row.status}`)}
                                                    </Badge>
                                                </td>
                                                <td className={styles.tableCell}>
                                                    {row.lastFailedDate ? new Date(row.lastFailedDate).toLocaleDateString(i18n.language) : "—"}
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

            {tier === "governance" && (
                <Card className={styles.card}>
                    <CardHead
                        title={t("qualityPulsePage.defectEscapes.title")}
                        audienceKey="qualityPulsePage.defectEscapes.audience"
                        actionKey="qualityPulsePage.defectEscapes.action"
                    />
                    <Text className={styles.riskNote}>
                        {t("qualityPulsePage.defectEscapes.riskNote", {
                            module: HIGHEST_RISK_MODULE.module,
                            escapes: HIGHEST_RISK_MODULE.escapes,
                            coverage: HIGHEST_RISK_MODULE.coveragePct,
                        })}
                    </Text>
                    <div className={styles.gridTwo}>
                        <div>
                            <Text className={styles.chartTitle}>{t("qualityPulsePage.defectEscapes.escapesChartTitle")}</Text>
                            <EscapesBarChart modules={DEFECT_ESCAPES} />
                        </div>
                        <div>
                            <Text className={styles.chartTitle}>{t("qualityPulsePage.defectEscapes.coverageChartTitle")}</Text>
                            <ModuleCoverageBarChart modules={COVERAGE_BY_MODULE} />
                        </div>
                    </div>
                </Card>
            )}
        </PageLayout>
    );
}
