import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Card,
    Dropdown,
    Field,
    Option,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ChevronDownRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { ThroughputBarChart, CycleTimeLineChart } from "../components/CycleTimeCharts";
import { PaginationControls } from "../components/PaginationControls";
import { usePagination } from "../hooks/usePagination";
import { fetchCycleTime } from "../api/client";
import type { CycleTimeTask, CycleTimeTrendPoint, ThroughputPoint } from "../types";

const TABLE_PAGE_SIZE = 5;

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    filterRow: {
        display: "flex",
        alignItems: "flex-end",
    },
    filterField: {
        minWidth: "260px",
    },
    chevron: {
        color: tokens.colorBrandForeground1,
        fontSize: "18px",
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
    statValue: {
        fontSize: "24px",
        fontWeight: 700,
        color: tokens.colorBrandForeground1,
    },
    statLabel: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    chartsRow: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    chartCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    chartTitle: {
        fontSize: "14px",
        fontWeight: 600,
    },
    tableCardTitle: {
        fontSize: "14px",
        fontWeight: 600,
        display: "block",
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} 0`,
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
    taskLink: {
        color: tokens.colorBrandForegroundLink,
        ":hover": {
            color: tokens.colorBrandForegroundLinkHover,
        },
    },
});

// Same project this roadmap always tracks (see CoverageRoadmapPage.tsx) -
// fixed rather than driven by the shared ScopeBar project selector.
const PROJECT = "Test Factory";

const ALL_EPICS = "all";

// Same Monday-start ISO week bucketing as the server's cycleTimeData.ts (and
// defectData.ts before it) - kept in sync so a client-side re-bucket after
// the epic filter produces the exact same week boundaries the unfiltered
// server response used.
function weekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;

    d.setUTCDate(d.getUTCDate() - diff);

    return d.toISOString().slice(0, 10);
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function median(sortedValues: number[]): number | null {
    if (sortedValues.length === 0) {
        return null;
    }

    const mid = Math.floor(sortedValues.length / 2);

    return sortedValues.length % 2 === 1
        ? sortedValues[mid]
        : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

// Re-derives the same aggregates the server computes over all tasks, but
// over whichever subset the epic filter leaves - the full per-task list is
// already on the client, so filtering doesn't need another round trip.
function computeAggregates(tasks: CycleTimeTask[]): {
    throughput: ThroughputPoint[];
    cycleTimeTrend: CycleTimeTrendPoint[];
    overallAvgCycleTimeDays: number | null;
    overallMedianCycleTimeDays: number | null;
} {
    const buckets = new Map<string, { count: number; totalDays: number }>();

    for (const task of tasks) {
        const week = weekStart(new Date(task.doneDate));
        const bucket = buckets.get(week) ?? { count: 0, totalDays: 0 };

        bucket.count += 1;
        bucket.totalDays += task.cycleTimeDays;
        buckets.set(week, bucket);
    }

    const sortedWeeks = [...buckets.keys()].sort((a, b) => a.localeCompare(b));

    const throughput = sortedWeeks.map((week) => ({
        weekStart: week,
        completedCount: buckets.get(week)!.count,
    }));

    const cycleTimeTrend = sortedWeeks.map((week) => {
        const bucket = buckets.get(week)!;

        return {
            weekStart: week,
            avgCycleTimeDays: round1(bucket.totalDays / bucket.count),
            completedCount: bucket.count,
        };
    });

    const durations = tasks.map((task) => task.cycleTimeDays);
    const overallAvgCycleTimeDays = durations.length
        ? round1(durations.reduce((sum, d) => sum + d, 0) / durations.length)
        : null;
    const medianValue = median([...durations].sort((a, b) => a - b));

    return {
        throughput,
        cycleTimeTrend,
        overallAvgCycleTimeDays,
        overallMedianCycleTimeDays: medianValue != null ? round1(medianValue) : null,
    };
}

export function CycleTimeReportPage() {
    const { t, i18n } = useTranslation();
    const styles = useStyles();
    const [selectedEpicId, setSelectedEpicId] = useState<string>(ALL_EPICS);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["cycle-time", PROJECT],
        queryFn: () => fetchCycleTime(PROJECT),
    });

    const epicOptions = useMemo(() => {
        if (!data) {
            return [];
        }

        const byId = new Map<number, string>();
        for (const task of data.tasks) {
            byId.set(task.epicId, task.epicTitle);
        }

        return [...byId.entries()]
            .map(([id, title]) => ({ id, title }))
            .sort((a, b) => a.title.localeCompare(b.title));
    }, [data]);

    const filteredTasks = useMemo(() => {
        if (!data) {
            return [];
        }

        if (selectedEpicId === ALL_EPICS) {
            return data.tasks;
        }

        const epicId = Number(selectedEpicId);

        return data.tasks.filter((task) => task.epicId === epicId);
    }, [data, selectedEpicId]);

    const aggregates = useMemo(
        () => computeAggregates(filteredTasks),
        [filteredTasks]
    );

    // Separate from `tasks`/`filteredTasks` (which only ever hold tasks a
    // completed cycle could be measured for) - this is every automation
    // task under the selected epic(s) that isn't Done yet, so "still open"
    // reflects the real backlog (and which tasks make it up), not just what
    // the charts above can plot.
    const openTasks = useMemo(() => {
        // `?? []`: guards a stale cached response from before allTasks
        // existed on this shape (dev HMR can serve one without a full
        // reload) - a hard refresh always gets the current shape.
        const allTasks = data?.allTasks ?? [];

        const scoped =
            selectedEpicId === ALL_EPICS
                ? allTasks
                : allTasks.filter(
                      (task) => task.epicId === Number(selectedEpicId)
                  );

        return scoped.filter((task) => !task.isDone);
    }, [data, selectedEpicId]);

    const sortedOpenTasks = useMemo(
        () => [...openTasks].sort((a, b) => a.title.localeCompare(b.title)),
        [openTasks]
    );
    const sortedCompletedTasks = useMemo(
        () => [...filteredTasks].sort((a, b) => b.doneDate.localeCompare(a.doneDate)),
        [filteredTasks]
    );

    const openPagination = usePagination(sortedOpenTasks, TABLE_PAGE_SIZE);
    const completedPagination = usePagination(sortedCompletedTasks, TABLE_PAGE_SIZE);

    const selectedEpicTitle =
        selectedEpicId === ALL_EPICS
            ? t("cycleTimePage.allEpics")
            : epicOptions.find((e) => String(e.id) === selectedEpicId)?.title ??
              t("cycleTimePage.allEpics");

    return (
        <PageLayout title={t("cycleTimePage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>{t("cycleTimePage.subtitle")}</Text>

            {isLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && data.tasks.length === 0 && (
                <Text className={styles.hint}>{t("cycleTimePage.noTasks")}</Text>
            )}

            {data && data.tasks.length > 0 && (
                <>
                    <div className={styles.filterRow}>
                        <Field
                            label={t("cycleTimePage.epicFilterLabel")}
                            className={styles.filterField}
                        >
                            <Dropdown
                                expandIcon={<ChevronDownRegular className={styles.chevron} />}
                                value={selectedEpicTitle}
                                selectedOptions={[selectedEpicId]}
                                onOptionSelect={(_, optionData) =>
                                    setSelectedEpicId(optionData.optionValue ?? ALL_EPICS)
                                }
                            >
                                <Option value={ALL_EPICS}>
                                    {t("cycleTimePage.allEpics")}
                                </Option>
                                {epicOptions.map((epic) => (
                                    <Option key={epic.id} value={String(epic.id)}>
                                        {epic.title}
                                    </Option>
                                ))}
                            </Dropdown>
                        </Field>
                    </div>

                    <div className={styles.statRow}>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {aggregates.overallAvgCycleTimeDays != null
                                    ? t("cycleTimePage.daysValue", {
                                          days: aggregates.overallAvgCycleTimeDays,
                                      })
                                    : "—"}
                            </span>
                            <span className={styles.statLabel}>
                                {t("cycleTimePage.stats.avgCycleTime")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {aggregates.overallMedianCycleTimeDays != null
                                    ? t("cycleTimePage.daysValue", {
                                          days: aggregates.overallMedianCycleTimeDays,
                                      })
                                    : "—"}
                            </span>
                            <span className={styles.statLabel}>
                                {t("cycleTimePage.stats.medianCycleTime")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>
                                {filteredTasks.length}
                            </span>
                            <span className={styles.statLabel}>
                                {t("cycleTimePage.stats.tasksCompleted")}
                            </span>
                        </Card>
                        <Card className={styles.statTile}>
                            <span className={styles.statValue}>{openTasks.length}</span>
                            <span className={styles.statLabel}>
                                {t("cycleTimePage.stats.stillOpen")}
                            </span>
                        </Card>
                    </div>

                    {openTasks.length > 0 && (
                        <Card>
                            <Text className={styles.tableCardTitle}>
                                {t("cycleTimePage.openTasksTitle", {
                                    count: openTasks.length,
                                })}
                            </Text>
                            <div style={{ overflowX: "auto" }}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th className={styles.tableHeadCell}>
                                                {t("cycleTimePage.table.task")}
                                            </th>
                                            <th className={styles.tableHeadCell}>
                                                {t("cycleTimePage.table.epic")}
                                            </th>
                                            <th className={styles.tableHeadCell}>
                                                {t("cycleTimePage.table.state")}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {openPagination.pageItems.map((task) => (
                                            <tr key={task.id}>
                                                <td className={styles.tableCell}>
                                                    {task.url ? (
                                                        <a
                                                            href={task.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className={styles.taskLink}
                                                        >
                                                            {task.title}
                                                        </a>
                                                    ) : (
                                                        task.title
                                                    )}
                                                </td>
                                                <td className={styles.tableCell}>
                                                    {task.epicTitle}
                                                </td>
                                                <td className={styles.tableCell}>
                                                    {task.state}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationControls
                                page={openPagination.page}
                                pageCount={openPagination.pageCount}
                                total={sortedOpenTasks.length}
                                pageSize={TABLE_PAGE_SIZE}
                                onPageChange={openPagination.setPage}
                            />
                        </Card>
                    )}

                    {filteredTasks.length === 0 ? (
                        <Text className={styles.hint}>
                            {t("cycleTimePage.noTasksForEpic")}
                        </Text>
                    ) : (
                        <>
                            <div className={styles.chartsRow}>
                                <Card className={styles.chartCard}>
                                    <Text className={styles.chartTitle}>
                                        {t("cycleTimePage.throughputChartTitle")}
                                    </Text>
                                    <ThroughputBarChart points={aggregates.throughput} />
                                </Card>
                                <Card className={styles.chartCard}>
                                    <Text className={styles.chartTitle}>
                                        {t("cycleTimePage.cycleTimeChartTitle")}
                                    </Text>
                                    <CycleTimeLineChart points={aggregates.cycleTimeTrend} />
                                </Card>
                            </div>

                            <Card>
                                <Text className={styles.tableCardTitle}>
                                    {t("cycleTimePage.completedTasksTitle", {
                                        count: filteredTasks.length,
                                    })}
                                </Text>
                                <div style={{ overflowX: "auto" }}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th className={styles.tableHeadCell}>
                                                    {t("cycleTimePage.table.task")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("cycleTimePage.table.epic")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("cycleTimePage.table.started")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("cycleTimePage.table.done")}
                                                </th>
                                                <th
                                                    className={styles.tableHeadCell}
                                                    style={{ textAlign: "right" }}
                                                >
                                                    {t("cycleTimePage.table.cycleTime")}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {completedPagination.pageItems.map((task) => (
                                                <tr key={task.id}>
                                                    <td className={styles.tableCell}>
                                                        {task.url ? (
                                                            <a
                                                                href={task.url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className={styles.taskLink}
                                                            >
                                                                {task.title}
                                                            </a>
                                                        ) : (
                                                            task.title
                                                        )}
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        {task.epicTitle}
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        {new Date(task.startDate).toLocaleDateString(
                                                            i18n.language,
                                                            {
                                                                day: "2-digit",
                                                                month: "short",
                                                                year: "numeric",
                                                            }
                                                        )}
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        {new Date(task.doneDate).toLocaleDateString(
                                                            i18n.language,
                                                            {
                                                                day: "2-digit",
                                                                month: "short",
                                                                year: "numeric",
                                                            }
                                                        )}
                                                    </td>
                                                    <td className={styles.tableCellNum}>
                                                        {t("cycleTimePage.daysValue", {
                                                            days: task.cycleTimeDays,
                                                        })}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <PaginationControls
                                    page={completedPagination.page}
                                    pageCount={completedPagination.pageCount}
                                    total={sortedCompletedTasks.length}
                                    pageSize={TABLE_PAGE_SIZE}
                                    onPageChange={completedPagination.setPage}
                                />
                            </Card>
                        </>
                    )}
                </>
            )}
        </PageLayout>
    );
}
