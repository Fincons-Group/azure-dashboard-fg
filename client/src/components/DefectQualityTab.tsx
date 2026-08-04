import { useTranslation } from "react-i18next";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { StatCard } from "./StatCard";
import { CardGrid } from "./CardGrid";
import { ChartCard } from "./ChartCard";
import { ChartsGrid } from "./ChartsGrid";
import { EmptyState } from "./EmptyState";
import { categoryAxisWidth } from "../utils/chartAxis";
import type { DefectStats } from "../types";

const useStyles = makeStyles({
    donutWrap: {
        position: "relative",
        display: "flex",
        justifyContent: "center",
        width: "100%",
    },
    donutLabel: {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        textAlign: "center",
    },
    legend: {
        display: "flex",
        flexDirection: "row",
        gap: tokens.spacingHorizontalL,
        flexWrap: "wrap",
        justifyContent: "center",
    },
    legendRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalSNudge,
    },
    legendDot: {
        width: "10px",
        height: "10px",
        borderRadius: "50%",
        flexShrink: 0,
    },
    legendCount: {
        minWidth: "28px",
        textAlign: "right",
    },
});

// Real Defect vs OutOfScope - aqua/amber pair validated for CVD separation and
// contrast against both the light and dark chart surfaces (see dataviz skill).
const REAL_VS_OUT_OF_SCOPE_COLORS: Record<string, string> = {
    realDefects: "#1baf7a",
    outOfScope: "#eda100",
};

function toChartData(
    record: Record<string, number>
): { name: string; count: number }[] {
    return Object.entries(record)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}

export function DefectQualityTab({ stats }: { stats: DefectStats }) {
    const { t } = useTranslation();
    const styles = useStyles();
    const rejectionReasonsData = toChartData(stats.rejectionReasons);
    const outOfScopeBySuiteData = toChartData(stats.outOfScopeBySuite);

    const outOfScopeCount = stats.closureReasonBreakdown.OutOfScope ?? 0;
    const realDefectCount = Object.entries(stats.closureReasonBreakdown)
        .filter(([reason]) => reason !== "OutOfScope")
        .reduce((sum, [, count]) => sum + count, 0);
    const closedWithReasonCount = outOfScopeCount + realDefectCount;
    const outOfScopePctOfClosed = closedWithReasonCount
        ? Math.round((outOfScopeCount / closedWithReasonCount) * 100)
        : 0;

    const realVsOutOfScopeData = [
        { name: "realDefects", value: realDefectCount },
        { name: "outOfScope", value: outOfScopeCount },
    ].filter((entry) => entry.value > 0);

    const realVsOutOfScopeLegendEntries: Array<{
        key: keyof typeof REAL_VS_OUT_OF_SCOPE_COLORS;
        count: number;
    }> = [
        { key: "realDefects", count: realDefectCount },
        { key: "outOfScope", count: outOfScopeCount },
    ];

    // Same real-vs-out-of-scope split as above, but across every bug
    // regardless of state - the chart above only covers Closed/Duplicate
    // bugs (it needs a determined closure reason), so it misses out-of-scope
    // bugs that haven't been closed yet.
    const allBugsRealDefectCount = stats.sprintDefectReport.effectiveCount;
    const allBugsOutOfScopeCount = stats.sprintDefectReport.outOfScopeCount;
    const allBugsTotal = allBugsRealDefectCount + allBugsOutOfScopeCount;
    const outOfScopePctOfAll = allBugsTotal
        ? Math.round((allBugsOutOfScopeCount / allBugsTotal) * 100)
        : 0;

    const realVsOutOfScopeAllData = [
        { name: "realDefects", value: allBugsRealDefectCount },
        { name: "outOfScope", value: allBugsOutOfScopeCount },
    ].filter((entry) => entry.value > 0);

    const realVsOutOfScopeAllLegendEntries: Array<{
        key: keyof typeof REAL_VS_OUT_OF_SCOPE_COLORS;
        count: number;
    }> = [
        { key: "realDefects", count: allBugsRealDefectCount },
        { key: "outOfScope", count: allBugsOutOfScopeCount },
    ];

    return (
        <>
            <CardGrid>
                <StatCard
                    label={t("defectManagementPage.stats.leakageRate")}
                    value={
                        stats.defectLeakageRate != null
                            ? `${stats.defectLeakageRate}%`
                            : t("defectManagementPage.stats.notConfigured")
                    }
                />
                <StatCard
                    label={t("defectManagementPage.stats.rejectionRate")}
                    value={`${stats.defectRejectionRate}%`}
                />
                <StatCard
                    label={t("defectManagementPage.stats.firstTimeFixRate")}
                    value={
                        stats.firstTimeFixRate != null
                            ? `${stats.firstTimeFixRate}%`
                            : t("defectManagementPage.stats.notAvailable")
                    }
                />
                <StatCard
                    label={t("defectManagementPage.stats.outOfScopeRate")}
                    value={`${stats.outOfScopeRate}%`}
                />
                <StatCard
                    label={t("defectManagementPage.stats.regressionRate")}
                    value={`${stats.regressionRate}%`}
                />
            </CardGrid>

            <ChartsGrid>
                <ChartCard
                    title={t("defectManagementPage.charts.realVsOutOfScope")}
                >
                    {realVsOutOfScopeData.length > 0 ? (
                        <div>
                            <div className={styles.donutWrap}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <PieChart>
                                        <Pie
                                            data={realVsOutOfScopeData}
                                            dataKey="value"
                                            nameKey="name"
                                            innerRadius={62}
                                            outerRadius={88}
                                            startAngle={90}
                                            endAngle={-270}
                                            stroke="none"
                                        >
                                            {realVsOutOfScopeData.map((entry) => (
                                                <Cell
                                                    key={entry.name}
                                                    fill={
                                                        REAL_VS_OUT_OF_SCOPE_COLORS[
                                                            entry.name
                                                        ]
                                                    }
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            formatter={(value, name) => [
                                                value,
                                                t(
                                                    `defectManagementPage.charts.${name}`
                                                ),
                                            ]}
                                            contentStyle={{
                                                backgroundColor:
                                                    tokens.colorNeutralBackground1,
                                                border: `1px solid ${tokens.colorNeutralStroke2}`,
                                            }}
                                            itemStyle={{
                                                color: tokens.colorNeutralForeground1,
                                            }}
                                            labelStyle={{
                                                color: tokens.colorNeutralForeground1,
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className={styles.donutLabel}>
                                    <Text size={700} weight="bold">
                                        {outOfScopePctOfClosed}%
                                    </Text>
                                </div>
                            </div>
                            <div className={styles.legend}>
                                {realVsOutOfScopeLegendEntries.map(
                                    ({ key, count }) => (
                                        <div key={key} className={styles.legendRow}>
                                            <span
                                                className={styles.legendDot}
                                                style={{
                                                    backgroundColor:
                                                        REAL_VS_OUT_OF_SCOPE_COLORS[
                                                            key
                                                        ],
                                                }}
                                            />
                                            <Text
                                                className={styles.legendCount}
                                                weight="semibold"
                                            >
                                                {count}
                                            </Text>
                                            <Text>
                                                {t(
                                                    `defectManagementPage.charts.${key}`
                                                )}
                                            </Text>
                                        </div>
                                    )
                                )}
                            </div>
                        </div>
                    ) : (
                        <EmptyState
                            message={t(
                                "defectManagementPage.charts.noClosedDefects"
                            )}
                        />
                    )}
                </ChartCard>

                <ChartCard
                    title={t("defectManagementPage.charts.realVsOutOfScopeAll")}
                >
                    {realVsOutOfScopeAllData.length > 0 ? (
                        <div>
                            <div className={styles.donutWrap}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <PieChart>
                                        <Pie
                                            data={realVsOutOfScopeAllData}
                                            dataKey="value"
                                            nameKey="name"
                                            innerRadius={62}
                                            outerRadius={88}
                                            startAngle={90}
                                            endAngle={-270}
                                            stroke="none"
                                        >
                                            {realVsOutOfScopeAllData.map((entry) => (
                                                <Cell
                                                    key={entry.name}
                                                    fill={
                                                        REAL_VS_OUT_OF_SCOPE_COLORS[
                                                            entry.name
                                                        ]
                                                    }
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            formatter={(value, name) => [
                                                value,
                                                t(
                                                    `defectManagementPage.charts.${name}`
                                                ),
                                            ]}
                                            contentStyle={{
                                                backgroundColor:
                                                    tokens.colorNeutralBackground1,
                                                border: `1px solid ${tokens.colorNeutralStroke2}`,
                                            }}
                                            itemStyle={{
                                                color: tokens.colorNeutralForeground1,
                                            }}
                                            labelStyle={{
                                                color: tokens.colorNeutralForeground1,
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className={styles.donutLabel}>
                                    <Text size={700} weight="bold">
                                        {outOfScopePctOfAll}%
                                    </Text>
                                </div>
                            </div>
                            <div className={styles.legend}>
                                {realVsOutOfScopeAllLegendEntries.map(
                                    ({ key, count }) => (
                                        <div key={key} className={styles.legendRow}>
                                            <span
                                                className={styles.legendDot}
                                                style={{
                                                    backgroundColor:
                                                        REAL_VS_OUT_OF_SCOPE_COLORS[
                                                            key
                                                        ],
                                                }}
                                            />
                                            <Text
                                                className={styles.legendCount}
                                                weight="semibold"
                                            >
                                                {count}
                                            </Text>
                                            <Text>
                                                {t(
                                                    `defectManagementPage.charts.${key}`
                                                )}
                                            </Text>
                                        </div>
                                    )
                                )}
                            </div>
                        </div>
                    ) : (
                        <EmptyState
                            message={t(
                                "defectManagementPage.charts.noDefectsAllBugs"
                            )}
                        />
                    )}
                </ChartCard>

                <ChartCard
                    title={t("defectManagementPage.charts.outOfScopeBySuite")}
                >
                    {outOfScopeBySuiteData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart
                                data={outOfScopeBySuiteData}
                                layout="vertical"
                                margin={{ left: 24 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis type="number" allowDecimals={false} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={categoryAxisWidth(
                                        outOfScopeBySuiteData.map(
                                            (d) => d.name
                                        )
                                    )}
                                    tick={{ fontSize: 12 }}
                                />
                                <Tooltip />
                                <Bar dataKey="count" fill="#eda100" />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyState
                            message={t(
                                "defectManagementPage.charts.noOutOfScope"
                            )}
                        />
                    )}
                </ChartCard>
            </ChartsGrid>

            <ChartCard title={t("defectManagementPage.charts.rejectionReasons")}>
                {rejectionReasonsData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                            data={rejectionReasonsData}
                            layout="vertical"
                            margin={{ left: 24 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={categoryAxisWidth(
                                    rejectionReasonsData.map((d) => d.name)
                                )}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip />
                            <Bar dataKey="count" fill="#c4314b" />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState
                        message={t("defectManagementPage.charts.noRejections")}
                    />
                )}
            </ChartCard>
        </>
    );
}
