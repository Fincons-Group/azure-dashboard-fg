import { useTranslation } from "react-i18next";
import {
    ResponsiveContainer,
    FunnelChart,
    Funnel,
    LabelList,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { ChartsGrid } from "./ChartsGrid";
import type { DashboardStats, TrendPoint } from "../types";

export function VisualsSection({
    stats,
    trend,
    totalTestCases,
}: {
    stats: DashboardStats;
    trend: TrendPoint[];
    totalTestCases: number;
}) {
    const { t } = useTranslation();

    const funnelData = [
        {
            name: t("testExecutionPage.visuals.funnel.total"),
            value: stats.totalTestCases,
            fill: "#0078d4",
        },
        {
            name: t("testExecutionPage.visuals.funnel.executed"),
            value: stats.executedCount,
            fill: "#5c2d91",
        },
        {
            name: t("testExecutionPage.visuals.funnel.passed"),
            value: stats.passedCount,
            fill: "#107c10",
        },
    ];

    const burnUpData = trend.map((p) => ({
        date: p.date,
        executed: p.cumulativeExecuted,
        total: totalTestCases,
    }));

    return (
        <ChartsGrid>
            <ChartCard title={t("testExecutionPage.visuals.executionFunnel")}>
                <ResponsiveContainer width="100%" height={300}>
                    <FunnelChart>
                        <Tooltip />
                        <Funnel dataKey="value" data={funnelData} isAnimationActive>
                            <LabelList
                                dataKey="name"
                                position="center"
                                style={{ fill: "#fff", fontWeight: 600 }}
                            />
                        </Funnel>
                    </FunnelChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t("testExecutionPage.visuals.burnUp")}>
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={burnUpData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Area
                            type="monotone"
                            dataKey="total"
                            stroke="#c4c4c4"
                            fill="none"
                            name={t("testExecutionPage.visuals.totalLine")}
                        />
                        <Area
                            type="monotone"
                            dataKey="executed"
                            stroke="#0078d4"
                            fill="#0078d4"
                            fillOpacity={0.3}
                            name={t("testExecutionPage.visuals.executedLine")}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t("testExecutionPage.visuals.passFailTrend")}>
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Area
                            type="monotone"
                            dataKey="passed"
                            stackId="outcome"
                            stroke="#107c10"
                            fill="#107c10"
                            name={t("outcome.Passed")}
                        />
                        <Area
                            type="monotone"
                            dataKey="failed"
                            stackId="outcome"
                            stroke="#d83b01"
                            fill="#d83b01"
                            name={t("outcome.Failed")}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </ChartCard>
        </ChartsGrid>
    );
}
