import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Accordion, makeStyles, tokens } from "@fluentui/react-components";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import { PageLayout } from "../components/PageLayout";
import { StatCard } from "../components/StatCard";
import { CardGrid } from "../components/CardGrid";
import { ChartCard } from "../components/ChartCard";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { ErrorGroupItem } from "../components/ErrorGroupItem";
import { fetchCommonErrors } from "../api/client";
import { categoryAxisWidth } from "../utils/chartAxis";

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
});

export function CommonErrorsPage() {
    const styles = useStyles();
    const { t } = useTranslation();

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["common-errors"],
        queryFn: fetchCommonErrors,
    });

    return (
        <PageLayout title={t("commonErrorsPage.title")}>
            {isLoading && <LoadingCardGrid />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data && (
                <>
                    <div className={styles.section}>
                        <CardGrid>
                            <StatCard
                                label={t("commonErrorsPage.kpis.totalFailedResults")}
                                value={data.totalFailedResults}
                            />
                            <StatCard
                                label={t("commonErrorsPage.kpis.uniqueSignatures")}
                                value={data.errors.length}
                            />
                            <StatCard
                                label={t("commonErrorsPage.kpis.topErrorCount")}
                                value={data.errors[0]?.count ?? 0}
                            />
                        </CardGrid>
                    </div>

                    {data.errors.length === 0 ? (
                        <EmptyState message={t("commonErrorsPage.empty")} />
                    ) : (
                        <>
                            <div className={styles.section}>
                                <ChartCard title={t("commonErrorsPage.charts.topErrors")}>
                                    <ResponsiveContainer
                                        width="100%"
                                        height={Math.max(300, data.errors.length * 28)}
                                    >
                                        <BarChart
                                            data={data.errors}
                                            layout="vertical"
                                            margin={{ left: 24 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis type="number" allowDecimals={false} />
                                            <YAxis
                                                type="category"
                                                dataKey="signature"
                                                width={categoryAxisWidth(
                                                    data.errors.map(
                                                        (err) => err.signature
                                                    ),
                                                    { min: 220 }
                                                )}
                                                tick={{ fontSize: 11 }}
                                            />
                                            <Tooltip />
                                            <Bar dataKey="count" fill="#d83b01" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </ChartCard>
                            </div>

                            <div className={styles.section}>
                                <Accordion multiple collapsible>
                                    {data.errors.map((err) => (
                                        <ErrorGroupItem key={err.signature} error={err} />
                                    ))}
                                </Accordion>
                            </div>
                        </>
                    )}
                </>
            )}
        </PageLayout>
    );
}
