import { useTranslation } from "react-i18next";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from "recharts";
import { StatCard } from "./StatCard";
import { CardGrid } from "./CardGrid";
import { ChartCard } from "./ChartCard";
import { EmptyState } from "./EmptyState";
import { categoryAxisWidth } from "../utils/chartAxis";
import type { DefectStats } from "../types";

function toDensityChartData(
    record: Record<string, number | null>
): { name: string; density: number }[] {
    return Object.entries(record)
        .filter(([, density]) => density != null)
        .map(([name, density]) => ({ name, density: density! }))
        .sort((a, b) => b.density - a.density);
}

function toChartData(
    record: Record<string, number>
): { name: string; count: number }[] {
    return Object.entries(record)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}

export function DefectResourceTab({ stats }: { stats: DefectStats }) {
    const { t } = useTranslation();
    const densityData = toDensityChartData(stats.densityByComponent);
    const workloadData = toChartData(stats.byAssignee);

    return (
        <>
            <CardGrid>
                <StatCard
                    label={t("defectManagementPage.stats.backlogDirection")}
                    value={t(
                        `defectManagementPage.stats.backlogDirection_${stats.backlogDirection}`
                    )}
                />
            </CardGrid>

            <ChartCard title={t("defectManagementPage.charts.density")}>
                {densityData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                            data={densityData}
                            layout="vertical"
                            margin={{ left: 24 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={categoryAxisWidth(
                                    densityData.map((d) => d.name)
                                )}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip />
                            <Bar dataKey="density" fill="#8764b8" />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState
                        message={t("defectManagementPage.charts.noDensity")}
                    />
                )}
            </ChartCard>

            <ChartCard title={t("defectManagementPage.charts.workload")}>
                {workloadData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                            data={workloadData}
                            layout="vertical"
                            margin={{ left: 24 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={categoryAxisWidth(
                                    workloadData.map((d) => d.name)
                                )}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip />
                            <Bar dataKey="count" fill="#0078d4" />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState
                        message={t("defectManagementPage.charts.noWorkload")}
                    />
                )}
            </ChartCard>

            <ChartCard title={t("defectManagementPage.charts.backlogTrend")}>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={stats.backlogTrend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Line
                            type="monotone"
                            dataKey="opened"
                            name={t("defectManagementPage.charts.opened")}
                            stroke="#d83b01"
                            strokeWidth={2}
                            dot={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="closed"
                            name={t("defectManagementPage.charts.closed")}
                            stroke="#107c10"
                            strokeWidth={2}
                            dot={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="delta"
                            name={t("defectManagementPage.charts.backlogDelta")}
                            stroke="#0078d4"
                            strokeWidth={2}
                            dot={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </ChartCard>
        </>
    );
}
