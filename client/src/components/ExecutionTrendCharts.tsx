import { useTranslation } from "react-i18next";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { ChartsGrid } from "./ChartsGrid";
import type { TrendPoint } from "../types";

export function ExecutionTrendCharts({ trend }: { trend: TrendPoint[] }) {
    const { t } = useTranslation();

    const dailyExecution = trend.map((p) => ({
        date: p.date,
        executed: p.passed + p.failed + p.blocked,
    }));

    return (
        <ChartsGrid>
            <ChartCard title={t("testExecutionPage.trends.passRate")}>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Line
                            type="monotone"
                            dataKey="passRate"
                            stroke="#107c10"
                            strokeWidth={2}
                            dot={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t("testExecutionPage.trends.dailyExecution")}>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dailyExecution}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="executed" fill="#0078d4" />
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t("testExecutionPage.trends.failedTests")}>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Line
                            type="monotone"
                            dataKey="failed"
                            stroke="#d83b01"
                            strokeWidth={2}
                            dot={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </ChartCard>
        </ChartsGrid>
    );
}
