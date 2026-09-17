import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Badge,
    Card,
    Dropdown,
    Option,
    Text,
    Title2,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { useScope } from "../hooks/useScope";
import { fetchPlans, fetchPlanSuites, fetchQaControlCenter } from "../api/client";
import type { QaControlCenterTrendDay, QaTrendStatus } from "../types";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    pickerRow: {
        display: "flex",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    pickerDropdown: {
        minWidth: "260px",
    },
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    header: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    eyebrow: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorBrandForeground1,
        display: "block",
    },
    scope: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
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
        fontSize: "26px",
        fontWeight: 700,
        color: tokens.colorBrandForeground1,
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
    cardTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
    },
    stack: {
        display: "flex",
        height: "12px",
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralBackground3,
    },
    stackSeg: {
        height: "100%",
    },
    legend: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalM,
        rowGap: "4px",
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
        alignItems: "center",
    },
    legendDot: {
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        marginRight: "4px",
    },
    gridTwo: {
        display: "grid",
        gridTemplateColumns: "1.25fr 1fr",
        gap: tokens.spacingHorizontalM,
        alignItems: "start",
    },
    trendChart: {
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: tokens.spacingHorizontalXS,
        alignItems: "end",
        height: "120px",
        marginTop: tokens.spacingVerticalS,
    },
    trendCol: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        height: "100%",
        gap: "4px",
    },
    trendValue: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    trendBarWrap: {
        width: "100%",
        height: "76px",
        display: "flex",
        alignItems: "flex-end",
    },
    trendBar: {
        width: "100%",
        borderRadius: "4px 4px 0 0",
        minHeight: "3px",
        background: `linear-gradient(180deg, #00b7c3, ${tokens.colorBrandForeground1})`,
    },
    trendBarForecast: {
        width: "100%",
        borderRadius: "4px 4px 0 0",
        minHeight: "3px",
        border: `1px dashed ${tokens.colorBrandStroke1}`,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    trendLabel: {
        fontSize: tokens.fontSizeBase100,
        color: tokens.colorNeutralForeground3,
        textTransform: "capitalize",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeadCell: {
        textAlign: "right",
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
    tableHeadCellFirst: {
        textAlign: "left",
    },
    tableCell: {
        textAlign: "right",
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        fontSize: tokens.fontSizeBase200,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCellFirst: {
        textAlign: "left",
        fontWeight: tokens.fontWeightSemibold,
    },
    riskRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalS,
    },
    riskPill: {
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusCircular,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    riskPillBad: {
        backgroundColor: "#fdecef",
        color: "#a4262c",
    },
    riskPillWarn: {
        backgroundColor: "#fff7dc",
        color: "#8a5700",
    },
    footer: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
});

const OUTCOME_COLORS: Record<string, string> = {
    passed: "#43a047",
    failed: "#e05252",
    blocked: "#c97b00",
    partial: "#0078d4",
    other: "#7666a8",
    notApplicable: "#c7b900",
};

function healthAppearance(status: QaTrendStatus): "success" | "danger" | "warning" {
    if (status === "up") return "success";
    if (status === "down") return "danger";
    return "warning";
}

function formatHours(value: number): string {
    return (Math.round(value * 100) / 100).toString();
}

function dayLabel(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function QaControlCenterPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const scope = useScope();

    const [planId, setPlanId] = useState<number | null>(null);
    const [suiteId, setSuiteId] = useState<number | null>(null);

    // Reset the downstream picker(s) when their upstream selection changes -
    // done during render (React's own escape hatch for "adjusting state when
    // a prop changes") rather than in an effect, which would commit the stale
    // plan/suite for one extra render before resetting.
    const [prevProject, setPrevProject] = useState(scope.project);
    if (scope.project !== prevProject) {
        setPrevProject(scope.project);
        setPlanId(null);
        setSuiteId(null);
    }

    const [prevPlanId, setPrevPlanId] = useState(planId);
    if (planId !== prevPlanId) {
        setPrevPlanId(planId);
        setSuiteId(null);
    }

    const { data: plans, isLoading: plansLoading } = useQuery({
        queryKey: ["qacc-plans", scope.project],
        queryFn: () => fetchPlans(scope.project),
        enabled: !!scope.project,
    });

    const { data: suites, isLoading: suitesLoading } = useQuery({
        queryKey: ["qacc-suites", scope.project, planId],
        queryFn: () => fetchPlanSuites(planId!, scope.project),
        enabled: !!scope.project && planId != null,
    });

    const {
        data,
        isLoading: dataLoading,
        isError,
        error,
        refetch,
    } = useQuery({
        queryKey: ["qa-control-center", scope.project, planId, suiteId],
        queryFn: () => fetchQaControlCenter(planId!, suiteId!, scope.project),
        enabled: !!scope.project && planId != null && suiteId != null,
    });

    const selectedPlan = (plans ?? []).find((p) => p.id === planId) ?? null;
    const selectedSuite = (suites ?? []).find((s) => s.id === suiteId) ?? null;

    const outcomeSegments = useMemo(() => {
        if (!data) return [];
        return [
            { key: "passed", count: data.passed },
            { key: "failed", count: data.failed },
            { key: "blocked", count: data.blocked },
            { key: "partial", count: data.partial },
            { key: "other", count: data.other },
            { key: "notApplicable", count: data.notApplicable },
        ];
    }, [data]);

    const trendMax = useMemo(() => {
        if (!data) return 1;
        return Math.max(1, ...data.trend.map((d: QaControlCenterTrendDay) => d.count));
    }, [data]);

    return (
        <PageLayout title={t("qaControlCenterPage.title")} hideAreaSprintScope wide>
            <Text className={styles.subtitle}>{t("qaControlCenterPage.subtitle")}</Text>

            <div className={styles.pickerRow}>
                <Dropdown
                    className={styles.pickerDropdown}
                    placeholder={t("qaControlCenterPage.pickPlan")}
                    value={selectedPlan?.name ?? ""}
                    selectedOptions={planId != null ? [String(planId)] : []}
                    onOptionSelect={(_, d) => setPlanId(d.optionValue ? Number(d.optionValue) : null)}
                    disabled={!scope.project || plansLoading}
                >
                    {(plans ?? []).map((plan) => (
                        <Option key={plan.id} value={String(plan.id)}>
                            {plan.name}
                        </Option>
                    ))}
                </Dropdown>

                <Dropdown
                    className={styles.pickerDropdown}
                    placeholder={t("qaControlCenterPage.pickSuite")}
                    value={selectedSuite?.name ?? ""}
                    selectedOptions={suiteId != null ? [String(suiteId)] : []}
                    onOptionSelect={(_, d) => setSuiteId(d.optionValue ? Number(d.optionValue) : null)}
                    disabled={planId == null || suitesLoading}
                >
                    {(suites ?? []).map((suite) => (
                        <Option key={suite.id} value={String(suite.id)}>
                            {suite.name}
                        </Option>
                    ))}
                </Dropdown>
            </div>

            {!scope.project && (
                <Text className={styles.hint}>{t("qaControlCenterPage.pickProject")}</Text>
            )}

            {scope.project && (planId == null || suiteId == null) && (
                <Text className={styles.hint}>{t("qaControlCenterPage.pickPlanSuite")}</Text>
            )}

            {dataLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && !dataLoading && !isError && (
                <>
                    <div className={styles.header}>
                        <div>
                            <span className={styles.eyebrow}>{t("qaControlCenterPage.eyebrow")}</span>
                            <Title2 as="h2">{data.planName}</Title2>
                            <Text className={styles.scope}>
                                {data.planName} › {data.suiteName}
                            </Text>
                        </div>
                        <Badge appearance="filled" color={healthAppearance(data.trendStatus)} size="large">
                            {t(`qaControlCenterPage.trend.${data.trendStatus}`)}
                        </Badge>
                    </div>

                    <div className={styles.statRow}>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>{data.remainingCases}</span>
                            <span className={styles.statLabel}>{t("qaControlCenterPage.kpi.remaining")}</span>
                            <span className={styles.statDetail}>
                                {t("qaControlCenterPage.kpi.remainingDetail", { total: data.totalCases })}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>{data.todayCases}</span>
                            <span className={styles.statLabel}>{t("qaControlCenterPage.kpi.today")}</span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>{data.yesterdayCases}</span>
                            <span className={styles.statLabel}>{t("qaControlCenterPage.kpi.yesterday")}</span>
                        </Card>
                        <Card
                            className={
                                styles.statTile +
                                " " +
                                (data.trendStatus === "up"
                                    ? styles.statTileGood
                                    : data.trendStatus === "down"
                                      ? styles.statTileRisk
                                      : styles.statTileWarning)
                            }
                        >
                            <span className={styles.statValue}>{data.tomorrowForecast}</span>
                            <span className={styles.statLabel}>{t("qaControlCenterPage.kpi.forecast")}</span>
                            <span className={styles.statDetail}>
                                {data.tomorrowIsWorkingDay
                                    ? t("qaControlCenterPage.kpi.forecastDetail", {
                                          average: formatHours(data.historicalAveragePerDay),
                                      })
                                    : t("qaControlCenterPage.kpi.forecastNonWorkingDay")}
                            </span>
                        </Card>
                    </div>

                    <Card className={styles.card}>
                        <div className={styles.cardTitle}>
                            <span>{t("qaControlCenterPage.completionTitle")}</span>
                            <span className={styles.statDetail}>
                                {t("qaControlCenterPage.completionDetail", {
                                    executed: data.executedCases,
                                    total: data.totalCases,
                                    executionRate: data.executionRatePct,
                                    passRate: data.passRatePct,
                                })}
                            </span>
                        </div>
                        <div className={styles.stack}>
                            {outcomeSegments.map((seg) => (
                                <div
                                    key={seg.key}
                                    className={styles.stackSeg}
                                    style={{
                                        width: `${data.totalCases ? (seg.count / data.totalCases) * 100 : 0}%`,
                                        backgroundColor: OUTCOME_COLORS[seg.key],
                                    }}
                                />
                            ))}
                        </div>
                        <div className={styles.legend}>
                            {outcomeSegments.map((seg) => (
                                <span key={seg.key}>
                                    <span
                                        className={styles.legendDot}
                                        style={{ backgroundColor: OUTCOME_COLORS[seg.key] }}
                                    />
                                    {seg.count} {t(`qaControlCenterPage.outcome.${seg.key}`)}
                                </span>
                            ))}
                            <span>{formatHours(data.remainingEffortHours)} {t("qaControlCenterPage.hoursRemaining")}</span>
                        </div>
                    </Card>

                    <div className={styles.gridTwo}>
                        <Card className={styles.card}>
                            <div className={styles.cardTitle}>
                                <span>{t("qaControlCenterPage.trendTitle")}</span>
                                <span className={styles.statDetail}>{t("qaControlCenterPage.trendHint")}</span>
                            </div>
                            <div className={styles.trendChart}>
                                {data.trend.map((day: QaControlCenterTrendDay, i: number) => (
                                    <div key={i} className={styles.trendCol}>
                                        <span className={styles.trendValue}>{day.count}</span>
                                        <div className={styles.trendBarWrap}>
                                            <div
                                                className={day.forecast ? styles.trendBarForecast : styles.trendBar}
                                                style={{
                                                    height: `${Math.max(3, Math.round((day.count / trendMax) * 76))}px`,
                                                }}
                                            />
                                        </div>
                                        <span className={styles.trendLabel}>
                                            {dayLabel(day.date)}
                                            {day.forecast ? "*" : ""}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </Card>

                        <Card className={styles.card}>
                            <div className={styles.cardTitle}>
                                <span>{t("qaControlCenterPage.teamTitle")}</span>
                            </div>
                            {data.team.length === 0 ? (
                                <Text className={styles.hint}>{t("qaControlCenterPage.noTeam")}</Text>
                            ) : (
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th className={`${styles.tableHeadCell} ${styles.tableHeadCellFirst}`}>
                                                {t("qaControlCenterPage.team.tester")}
                                            </th>
                                            <th className={styles.tableHeadCell}>{t("qaControlCenterPage.team.assigned")}</th>
                                            <th className={styles.tableHeadCell}>{t("qaControlCenterPage.team.remaining")}</th>
                                            <th className={styles.tableHeadCell}>{t("qaControlCenterPage.team.hours")}</th>
                                            <th className={styles.tableHeadCell}>{t("qaControlCenterPage.team.completion")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.team.slice(0, 8).map((member) => (
                                            <tr key={member.key}>
                                                <td className={`${styles.tableCell} ${styles.tableCellFirst}`}>
                                                    {member.key === "__unassigned__"
                                                        ? t("qaControlCenterPage.unassignedTester")
                                                        : member.name}
                                                </td>
                                                <td className={styles.tableCell}>{member.assigned}</td>
                                                <td className={styles.tableCell}>{member.remaining}</td>
                                                <td className={styles.tableCell}>{formatHours(member.effortHours)}</td>
                                                <td className={styles.tableCell}>{member.completionPct}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Card>
                    </div>

                    <Card className={styles.card}>
                        <div className={styles.cardTitle}>
                            <span>{t("qaControlCenterPage.riskTitle")}</span>
                        </div>
                        <div className={styles.riskRow}>
                            <span className={`${styles.riskPill} ${data.unassignedCount > 0 ? styles.riskPillBad : ""}`}>
                                {t("qaControlCenterPage.risk.unassigned", { count: data.unassignedCount })}
                            </span>
                            <span className={`${styles.riskPill} ${data.openBugs > 0 ? styles.riskPillWarn : ""}`}>
                                {t("qaControlCenterPage.risk.openBugs", { count: data.openBugs })}
                            </span>
                            <span className={`${styles.riskPill} ${data.blockedByBug > 0 ? styles.riskPillWarn : ""}`}>
                                {t("qaControlCenterPage.risk.blockedByBug", { count: data.blockedByBug })}
                            </span>
                            <span className={styles.riskPill}>
                                {t("qaControlCenterPage.risk.readyForRetest", { count: data.readyForRetest })}
                            </span>
                            <span className={`${styles.riskPill} ${data.failedWithoutBug > 0 ? styles.riskPillBad : ""}`}>
                                {t("qaControlCenterPage.risk.failedWithoutBug", { count: data.failedWithoutBug })}
                            </span>
                        </div>
                    </Card>

                    <Text className={styles.footer}>
                        {t("qaControlCenterPage.calibrationNote", {
                            factor: formatHours(data.calibrationFactor),
                            samples: data.calibrationSamples,
                        })}
                        {data.historyTruncated && ` · ${t("qaControlCenterPage.historyTruncated")}`}
                        {data.historyFallback && ` · ${t("qaControlCenterPage.historyFallback")}`}
                    </Text>
                </>
            )}
        </PageLayout>
    );
}
