import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Badge,
    Card,
    Dropdown,
    Option,
    Tab,
    TabList,
    Text,
    Title2,
    makeStyles,
    mergeClasses,
    tokens,
    type SelectTabData,
    type SelectTabEvent,
} from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { StatusTag } from "../components/StatusTag";
import type { StatusTone } from "../components/statusTone";
import { useScope } from "../hooks/useScope";
import { fetchPlans, fetchPlanSuites, fetchQaControlCenter } from "../api/client";
import { CARD_RADIUS } from "../layoutConstants";
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
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
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
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
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
        marginTop: tokens.spacingVerticalS,
    },
    teamList: {
        display: "flex",
        flexDirection: "column",
    },
    teamRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        padding: `${tokens.spacingVerticalS} 0`,
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke2,
    },
    teamRowFirst: {
        borderTopStyle: "none",
    },
    teamAvatar: {
        width: "28px",
        height: "28px",
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
        fontSize: "11px",
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    teamName: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
    },
    teamMeta: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    riskRow: {
        display: "flex",
        flexWrap: "wrap",
        columnGap: tokens.spacingHorizontalL,
        rowGap: tokens.spacingVerticalS,
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

function initials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("");
}

// Thresholds are a display judgment call (how "on track" a tester looks),
// not a scored metric from the API - kept local to this one presentation.
function completionTone(pct: number): StatusTone {
    if (pct >= 80) return "success";
    if (pct >= 40) return "warning";
    return "danger";
}

// A single connected SVG chart in place of the old per-day CSS bars, so the
// forecast day reads as a dashed continuation of the real trend rather than
// a same-weight bar - all coordinates (including value/day labels) share one
// SVG coordinate space, which keeps everything pixel-aligned without trying
// to line up separate HTML label rows against chart columns.
function TrendChart({ trend }: { trend: QaControlCenterTrendDay[] }) {
    const max = Math.max(1, ...trend.map((d) => d.count));
    const width = 700;
    const plotTop = 34;
    const plotBottom = 118;
    const plotHeight = plotBottom - plotTop;
    const stepX = trend.length > 1 ? width / (trend.length - 1) : 0;

    const points = trend.map((day, i) => ({
        x: i * stepX,
        y: plotBottom - (day.count / max) * plotHeight,
        day,
    }));

    const realPoints = points.filter((p) => !p.day.forecast);
    const lastReal = realPoints[realPoints.length - 1];
    const forecastPoints = points.filter((p) => p.day.forecast);

    const realPath = realPoints.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPath =
        realPoints.length > 0
            ? `0,${plotBottom} ${realPath} ${lastReal.x},${plotBottom}`
            : "";
    const forecastPath =
        lastReal && forecastPoints.length > 0
            ? [lastReal, ...forecastPoints].map((p) => `${p.x},${p.y}`).join(" ")
            : "";

    return (
        <svg width="100%" height="170" viewBox={`0 0 ${width} 150`} preserveAspectRatio="none">
            <defs>
                <linearGradient id="qaccTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tokens.colorBrandForeground1} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={tokens.colorBrandForeground1} stopOpacity={0} />
                </linearGradient>
            </defs>

            <line
                x1={0}
                y1={plotBottom}
                x2={width}
                y2={plotBottom}
                style={{ stroke: tokens.colorNeutralStroke2 }}
                strokeWidth={1}
            />

            {areaPath && <polygon points={areaPath} fill="url(#qaccTrendFill)" />}
            {realPath && (
                <polyline
                    points={realPath}
                    fill="none"
                    style={{ stroke: tokens.colorBrandForeground1 }}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
            {forecastPath && (
                <polyline
                    points={forecastPath}
                    fill="none"
                    style={{ stroke: tokens.colorBrandStroke1 }}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeLinecap="round"
                />
            )}

            {points.map((p, i) => (
                <g key={i}>
                    {p.day.forecast ? (
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={4}
                            fill={tokens.colorNeutralBackground1}
                            style={{ stroke: tokens.colorBrandStroke1 }}
                            strokeWidth={2}
                        />
                    ) : (
                        <circle cx={p.x} cy={p.y} r={4} style={{ fill: tokens.colorBrandForeground1 }} />
                    )}
                    <text
                        x={p.x}
                        y={p.y - 12}
                        textAnchor="middle"
                        fontSize={13}
                        fontWeight={600}
                        style={{ fill: tokens.colorNeutralForeground1 }}
                    >
                        {p.day.count}
                    </text>
                    <text
                        x={p.x}
                        y={plotBottom + 22}
                        textAnchor="middle"
                        fontSize={11}
                        style={{ fill: tokens.colorNeutralForeground3 }}
                    >
                        {dayLabel(p.day.date)}
                        {p.day.forecast ? "*" : ""}
                    </text>
                </g>
            ))}
        </svg>
    );
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

    // Land on a working view without forcing a manual pick every time: the
    // first plan, then that plan's root suite - which the server already
    // treats as "every point under it, recursively" (includeChildren
    // defaults true - see /api/qa-control-center), so selecting it is a
    // real "All suites in this plan" view, not a fabricated aggregate.
    // Done during render, same escape hatch as the reset logic above,
    // rather than in an effect (which would commit one extra render with
    // nothing selected before the default kicks in).
    if (planId == null && plans && plans.length > 0) {
        setPlanId(plans[0].id);
    }

    const rootSuite = useMemo(
        () => (suites ?? []).find((s) => s.parentId == null) ?? null,
        [suites]
    );

    if (suiteId == null && suites && suites.length > 0) {
        setSuiteId(rootSuite?.id ?? suites[0].id);
    }

    // Tab-style suite filter (mirrors Test Suites' Overview + per-suite
    // tabs): the root suite stands in for "All", followed by its direct
    // children. Deeper nesting still rolls up into whichever tab covers it
    // recursively, it just doesn't get its own tab.
    const suiteTabs = useMemo(() => {
        if (!suites) return [];
        if (!rootSuite) return suites;
        const children = suites.filter((s) => s.parentId === rootSuite.id);
        return [{ id: rootSuite.id, name: t("qaControlCenterPage.allSuitesTab") }, ...children];
    }, [suites, rootSuite, t]);

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
            </div>

            {!scope.project && (
                <Text className={styles.hint}>{t("qaControlCenterPage.pickProject")}</Text>
            )}

            {scope.project && planId != null && suiteTabs.length > 0 && (
                <TabList
                    selectedValue={suiteId != null ? String(suiteId) : undefined}
                    onTabSelect={(_: SelectTabEvent, tabData: SelectTabData) =>
                        setSuiteId(Number(tabData.value))
                    }
                >
                    {suiteTabs.map((suite) => (
                        <Tab key={suite.id} value={String(suite.id)}>
                            {suite.name}
                        </Tab>
                    ))}
                </TabList>
            )}

            {scope.project && planId != null && suitesLoading && (
                <Text className={styles.hint}>{t("qaControlCenterPage.loadingSuites")}</Text>
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
                            className={mergeClasses(
                                styles.statTile,
                                data.trendStatus === "up"
                                    ? styles.statTileGood
                                    : data.trendStatus === "down"
                                      ? styles.statTileRisk
                                      : styles.statTileWarning
                            )}
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
                                <TrendChart trend={data.trend} />
                            </div>
                        </Card>

                        <Card className={styles.card}>
                            <div className={styles.cardTitle}>
                                <span>{t("qaControlCenterPage.teamTitle")}</span>
                            </div>
                            {data.team.length === 0 ? (
                                <Text className={styles.hint}>{t("qaControlCenterPage.noTeam")}</Text>
                            ) : (
                                <div className={styles.teamList}>
                                    {data.team.slice(0, 8).map((member, i) => (
                                        <div
                                            key={member.key}
                                            className={mergeClasses(
                                                styles.teamRow,
                                                i === 0 && styles.teamRowFirst
                                            )}
                                        >
                                            <span className={styles.teamAvatar}>
                                                {member.key === "__unassigned__"
                                                    ? "?"
                                                    : initials(member.name)}
                                            </span>
                                            <div style={{ flexGrow: 1, minWidth: 0 }}>
                                                <div className={styles.teamName}>
                                                    {member.key === "__unassigned__"
                                                        ? t("qaControlCenterPage.unassignedTester")
                                                        : member.name}
                                                </div>
                                                <div className={styles.teamMeta}>
                                                    {t("qaControlCenterPage.team.metaLine", {
                                                        assigned: member.assigned,
                                                        remaining: member.remaining,
                                                        hours: formatHours(member.effortHours),
                                                    })}
                                                </div>
                                            </div>
                                            <StatusTag tone={completionTone(member.completionPct)}>
                                                {member.completionPct}%
                                            </StatusTag>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>

                    <Card className={styles.card}>
                        <div className={styles.cardTitle}>
                            <span>{t("qaControlCenterPage.riskTitle")}</span>
                        </div>
                        <div className={styles.riskRow}>
                            <StatusTag tone={data.unassignedCount > 0 ? "danger" : "neutral"}>
                                {t("qaControlCenterPage.risk.unassigned", { count: data.unassignedCount })}
                            </StatusTag>
                            <StatusTag tone={data.openBugs > 0 ? "warning" : "neutral"}>
                                {t("qaControlCenterPage.risk.openBugs", { count: data.openBugs })}
                            </StatusTag>
                            <StatusTag tone={data.blockedByBug > 0 ? "warning" : "neutral"}>
                                {t("qaControlCenterPage.risk.blockedByBug", { count: data.blockedByBug })}
                            </StatusTag>
                            <StatusTag tone="neutral">
                                {t("qaControlCenterPage.risk.readyForRetest", { count: data.readyForRetest })}
                            </StatusTag>
                            <StatusTag tone={data.failedWithoutBug > 0 ? "danger" : "neutral"}>
                                {t("qaControlCenterPage.risk.failedWithoutBug", { count: data.failedWithoutBug })}
                            </StatusTag>
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
