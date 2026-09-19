import { useTranslation } from "react-i18next";
import { Badge, Card, Text, makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { ModuleCoverageBarChart } from "../components/AutomationKpiCharts";
import { BuildTrendLineChart, SuiteStackedBarChart, EscapesBarChart } from "../components/QualityPulseCharts";
import {
    PIPELINE_STAGES,
    BUILD_TREND,
    SUITE_ANALYTICS,
    FLAKY_MONITOR,
    DEFECT_ESCAPES,
    COVERAGE_BY_MODULE,
    HIGHEST_RISK_MODULE,
    pipelineGate,
    type PipelineHealth,
} from "./qualityPulseMockData";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    sampleBadge: {
        alignSelf: "flex-start",
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

function CardHead({ title, audienceKey, actionKey }: { title: string; audienceKey: string; actionKey: string }) {
    const styles = useStyles();
    const { t } = useTranslation();

    return (
        <div className={styles.cardHead}>
            <Text className={styles.cardTitle}>{title}</Text>
            <Text className={styles.cardMeta}>
                {t(audienceKey)} &middot; {t(actionKey)}
            </Text>
        </div>
    );
}

// Preview page behind AppSettings.showExperimentalPages - every section here
// runs on generated sample data (client/src/pages/qualityPulseMockData.ts),
// not a live query, so there's deliberately no useQuery/LoadingCardGrid/
// ErrorState here unlike the app's other experimental pages. See that file's
// header comment for what each section would need to go live.
export function QualityPulsePage() {
    const { t, i18n } = useTranslation();
    const styles = useStyles();

    const gate = pipelineGate(PIPELINE_STAGES);

    return (
        <PageLayout title={t("qualityPulsePage.title")} hideAreaSprintScope wide>
            <Text className={styles.subtitle}>{t("qualityPulsePage.subtitle")}</Text>
            <Badge className={styles.sampleBadge} appearance="tint" color="informative" size="small">
                {t("qualityPulsePage.sampleDataBadge")}
            </Badge>

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

            <Card className={styles.card}>
                <CardHead
                    title={t("qualityPulsePage.suiteAnalytics.title")}
                    audienceKey="qualityPulsePage.suiteAnalytics.audience"
                    actionKey="qualityPulsePage.suiteAnalytics.action"
                />
                <Text className={styles.chartTitle}>{t("qualityPulsePage.suiteAnalytics.chartTitle")}</Text>
                <SuiteStackedBarChart modules={SUITE_ANALYTICS} />
            </Card>

            <Card className={styles.card}>
                <CardHead
                    title={t("qualityPulsePage.flakyMonitor.title")}
                    audienceKey="qualityPulsePage.flakyMonitor.audience"
                    actionKey="qualityPulsePage.flakyMonitor.action"
                />
                <div style={{ overflowX: "auto" }}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.test")}</th>
                                <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.module")}</th>
                                <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                    {t("qualityPulsePage.flakyMonitor.table.retries")}
                                </th>
                                <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                    {t("qualityPulsePage.flakyMonitor.table.flakeRate")}
                                </th>
                                <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.status")}</th>
                                <th className={styles.tableHeadCell}>{t("qualityPulsePage.flakyMonitor.table.lastSeen")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {FLAKY_MONITOR.map((row) => (
                                <tr key={row.testCaseId}>
                                    <td className={styles.tableCell}>
                                        {row.testName} <Text className={styles.cardMeta}>#{row.testCaseId}</Text>
                                    </td>
                                    <td className={styles.tableCell}>{row.module}</td>
                                    <td className={styles.tableCellNum}>{row.retries}</td>
                                    <td className={styles.tableCellNum}>{row.flakeRatePct}%</td>
                                    <td className={styles.tableCell}>
                                        <Badge appearance="filled" color={row.status === "quarantined" ? "danger" : "warning"} size="small">
                                            {t(`qualityPulsePage.flakyMonitor.status.${row.status}`)}
                                        </Badge>
                                    </td>
                                    <td className={styles.tableCell}>{row.lastSeen}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

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
        </PageLayout>
    );
}
