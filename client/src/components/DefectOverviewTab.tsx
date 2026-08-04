import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, makeStyles, tokens } from "@fluentui/react-components";
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
import { ChartsGrid } from "./ChartsGrid";
import { EmptyState } from "./EmptyState";
import { BugsTable } from "./BugsTable";
import { Pagination } from "./Pagination";
import { compareByState } from "../utils/bugState";
import { categoryAxisWidth } from "../utils/chartAxis";
import type { DefectStats } from "../types";

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
});

const GAPS_PAGE_SIZE = 5;

function toChartData(
    record: Record<string, number>
): { name: string; count: number }[] {
    return Object.entries(record)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}

export function DefectOverviewTab({ stats }: { stats: DefectStats }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const [excludeClosed, setExcludeClosed] = useState(true);
    const [gapsPage, setGapsPage] = useState(1);
    const [breachesPage, setBreachesPage] = useState(1);
    const [suiteGapsPage, setSuiteGapsPage] = useState(1);

    const filteredGaps = stats.defectsWithoutLinkedTestCase
        .filter((b) => !excludeClosed || b.state !== "Closed")
        .sort(compareByState);

    const gapsPageCount = Math.max(
        1,
        Math.ceil(filteredGaps.length / GAPS_PAGE_SIZE)
    );
    const currentGapsPage = Math.min(gapsPage, gapsPageCount);
    const paginatedGaps = filteredGaps.slice(
        (currentGapsPage - 1) * GAPS_PAGE_SIZE,
        currentGapsPage * GAPS_PAGE_SIZE
    );

    const sortedSuiteGaps = [...stats.defectsWithoutSuite].sort(
        compareByState
    );

    const suiteGapsPageCount = Math.max(
        1,
        Math.ceil(sortedSuiteGaps.length / GAPS_PAGE_SIZE)
    );
    const currentSuiteGapsPage = Math.min(
        suiteGapsPage,
        suiteGapsPageCount
    );
    const paginatedSuiteGaps = sortedSuiteGaps.slice(
        (currentSuiteGapsPage - 1) * GAPS_PAGE_SIZE,
        currentSuiteGapsPage * GAPS_PAGE_SIZE
    );

    const breachesPageCount = Math.max(
        1,
        Math.ceil(stats.slaBreaches.length / GAPS_PAGE_SIZE)
    );
    const currentBreachesPage = Math.min(breachesPage, breachesPageCount);
    const paginatedBreaches = stats.slaBreaches.slice(
        (currentBreachesPage - 1) * GAPS_PAGE_SIZE,
        currentBreachesPage * GAPS_PAGE_SIZE
    );

    return (
        <>
            <div className={styles.section}>
                <ChartCard title={t("defectManagementPage.sections.highAttention")}>
                    {paginatedBreaches.length > 0 ? (
                        <>
                            <BugsTable
                                bugs={paginatedBreaches}
                                ariaLabel={t(
                                    "defectManagementPage.sections.highAttention"
                                )}
                                quickActionLabel={t(
                                    "defectManagementPage.sections.openInAdo"
                                )}
                            />
                            <Pagination
                                page={currentBreachesPage}
                                pageCount={breachesPageCount}
                                onPageChange={setBreachesPage}
                            />
                        </>
                    ) : (
                        <EmptyState
                            message={t("defectManagementPage.sections.noBreaches")}
                        />
                    )}
                </ChartCard>
            </div>

            <div className={styles.section}>
                <CardGrid>
                    <StatCard
                        label={t("defectManagementPage.stats.totalOpen")}
                        value={stats.totalOpen}
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.totalClosed")}
                        value={stats.totalClosed}
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.mttr")}
                        value={
                            stats.mttrDays != null
                                ? t("defectManagementPage.stats.days", {
                                    value: stats.mttrDays,
                                })
                                : t("defectManagementPage.stats.notAvailable")
                        }
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.reopenedBugs")}
                        value={stats.reopenedBugCount}
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.reopenRate")}
                        value={`${stats.reopenRate}%`}
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.duplicateRate")}
                        value={`${stats.duplicateRate}%`}
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.bugsPerStory")}
                        value={
                            stats.bugsPerStory != null
                                ? stats.bugsPerStory
                                : t("defectManagementPage.stats.notAvailable")
                        }
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.withoutLinkedTestCase")}
                        value={filteredGaps.length}
                    />
                    <StatCard
                        label={t("defectManagementPage.stats.withoutSuite")}
                        value={stats.defectsWithoutSuite.length}
                    />
                </CardGrid>
            </div>

            <div className={styles.section}>
                <ChartCard title={t("defectManagementPage.charts.trend")}>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={stats.trend}>
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
                                dataKey="openTotal"
                                name={t("defectManagementPage.charts.openTotal")}
                                stroke="#0078d4"
                                strokeWidth={2}
                                dot={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            <ChartsGrid>
                <ChartCard title={t("defectManagementPage.charts.bySeverity")}>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={toChartData(stats.bySeverity)}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#d83b01" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title={t("defectManagementPage.charts.byPriority")}>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={toChartData(stats.byPriority)}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#0078d4" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title={t("defectManagementPage.charts.byTestSuite")}>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                            data={toChartData(stats.byTestSuite)}
                            layout="vertical"
                            margin={{ left: 24 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={categoryAxisWidth(
                                    Object.keys(stats.byTestSuite)
                                )}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip />
                            <Bar dataKey="count" fill="#605e5c" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title={t("defectManagementPage.charts.aging")}>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={stats.agingBuckets}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#c4314b" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title={t("defectManagementPage.charts.byComponent")}>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                            data={toChartData(stats.byComponent)}
                            layout="vertical"
                            margin={{ left: 24 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={categoryAxisWidth(
                                    Object.keys(stats.byComponent)
                                )}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip />
                            <Bar dataKey="count" fill="#8764b8" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                    title={t("defectManagementPage.charts.reopenDistribution")}
                >
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={stats.reopenDistribution}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#d13438" />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </ChartsGrid>

            <div className={styles.section}>
                <ChartCard
                    title={t("defectManagementPage.sections.withoutLinkedTestCase")}
                >
                    <Switch
                        checked={excludeClosed}
                        onChange={(_, data) => {
                            setExcludeClosed(data.checked);
                            setGapsPage(1);
                        }}
                        label={t("defectManagementPage.sections.excludeClosed")}
                    />

                    {paginatedGaps.length > 0 ? (
                        <>
                            <BugsTable
                                bugs={paginatedGaps}
                                ariaLabel={t(
                                    "defectManagementPage.sections.withoutLinkedTestCase"
                                )}
                                quickActionLabel={t(
                                    "defectManagementPage.sections.openInAdo"
                                )}
                            />
                            <Pagination
                                page={currentGapsPage}
                                pageCount={gapsPageCount}
                                onPageChange={setGapsPage}
                            />
                        </>
                    ) : (
                        <EmptyState
                            message={t("defectManagementPage.sections.noGaps")}
                        />
                    )}
                </ChartCard>
            </div>

            <div className={styles.section}>
                <ChartCard
                    title={t("defectManagementPage.sections.withoutSuite")}
                >
                    {paginatedSuiteGaps.length > 0 ? (
                        <>
                            <BugsTable
                                bugs={paginatedSuiteGaps}
                                ariaLabel={t(
                                    "defectManagementPage.sections.withoutSuite"
                                )}
                                quickActionLabel={t(
                                    "defectManagementPage.sections.openInAdo"
                                )}
                            />
                            <Pagination
                                page={currentSuiteGapsPage}
                                pageCount={suiteGapsPageCount}
                                onPageChange={setSuiteGapsPage}
                            />
                        </>
                    ) : (
                        <EmptyState
                            message={t("defectManagementPage.sections.noSuiteGaps")}
                        />
                    )}
                </ChartCard>
            </div>
        </>
    );
}
