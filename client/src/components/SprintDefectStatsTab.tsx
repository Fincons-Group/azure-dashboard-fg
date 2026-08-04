import { useState } from "react";
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
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { StatCard } from "./StatCard";
import { CardGrid } from "./CardGrid";
import { ChartCard } from "./ChartCard";
import { ChartsGrid } from "./ChartsGrid";
import { EmptyState } from "./EmptyState";
import { BugsTable } from "./BugsTable";
import { Pagination } from "./Pagination";
import type { DefectStats } from "../types";

const LIST_PAGE_SIZE = 10;

const useStyles = makeStyles({
    chartColumn: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: tokens.spacingVerticalS,
    },
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
    listHeader: {
        display: "flex",
        justifyContent: "flex-end",
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
});

// DSI vs Test Factory - blue/purple pair, distinct from the status and
// severity colors used elsewhere in this tab.
const ORIGIN_COLORS: Record<string, string> = {
    dsi: "#0078d4",
    testFactory: "#8764b8",
};

// Status buckets get a fixed semantic color (green/amber/blue/purple) since
// there are always exactly four of them, unlike the open-ended category
// charts elsewhere in this dashboard that use a single flat bar color.
const STATUS_COLORS: Record<string, string> = {
    closed: "#107c10",
    resolved: "#8764b8",
    inProgress: "#eda100",
    new: "#0078d4",
};

const STATUS_KEY_BY_NAME: Record<string, string> = {
    Closed: "closed",
    Resolved: "resolved",
    "In Progress": "inProgress",
    New: "new",
};

const STATUS_SORT_ORDER = ["new", "inProgress", "resolved", "closed"];

// Severity is stored as e.g. "1 - Critical" (see SLA_THRESHOLD_DAYS in
// src/defectData.ts); rendered here as "Critical(P1)" and ordered P1..Pn
// instead of by count, so the chart and legend always read Critical first.
function parseSeverity(raw: string): { label: string; order: number } {
    const match = /^(\d+)\s*-\s*(.+)$/.exec(raw);

    if (!match) {
        return { label: raw, order: Number.MAX_SAFE_INTEGER };
    }

    const [, rank, label] = match;

    return { label: `${label}(P${rank})`, order: Number(rank) };
}

// Mirrors statusBucket() in src/defectData.ts so a clicked status bar filters
// the same bug set the server counted into that bucket.
function statusBucketOf(state: string): string {
    if (state === "New") {
        return "new";
    }

    if (state === "Resolved") {
        return "resolved";
    }

    if (state === "Closed") {
        return "closed";
    }

    return "inProgress";
}

type DrilldownFilter = {
    kind: "status" | "severity";
    key: string;
    label: string;
};

export function SprintDefectStatsTab({
    stats,
}: {
    stats: DefectStats;
}) {
    const { t } = useTranslation();
    const styles = useStyles();
    const report = stats.sprintDefectReport;

    const [filter, setFilter] = useState<DrilldownFilter | null>(null);
    const [listPage, setListPage] = useState(1);

    const selectStatus = (key: string, label: string) => {
        setFilter((prev) =>
            prev?.kind === "status" && prev.key === key
                ? null
                : { kind: "status", key, label }
        );
        setListPage(1);
    };

    const selectSeverity = (key: string, label: string) => {
        setFilter((prev) =>
            prev?.kind === "severity" && prev.key === key
                ? null
                : { kind: "severity", key, label }
        );
        setListPage(1);
    };

    const filteredBugs = filter
        ? report.effectiveDefects.filter((bug) =>
            filter.kind === "status"
                ? statusBucketOf(bug.state) === filter.key
                : (bug.severity ?? "Unspecified") === filter.key
        )
        : [];

    const listPageCount = Math.max(
        1,
        Math.ceil(filteredBugs.length / LIST_PAGE_SIZE)
    );
    const currentListPage = Math.min(listPage, listPageCount);
    const paginatedBugs = filteredBugs.slice(
        (currentListPage - 1) * LIST_PAGE_SIZE,
        currentListPage * LIST_PAGE_SIZE
    );

    const filterLabel = filter?.label;

    const originData = [
        { key: "dsi", name: t("defectManagementPage.sprintReport.origin.dsi"), value: report.byOrigin.DSI ?? 0 },
        {
            key: "testFactory",
            name: t("defectManagementPage.sprintReport.origin.testFactory"),
            value: report.byOrigin["Test Factory"] ?? 0,
        },
    ].filter((entry) => entry.value > 0);

    const statusData = Object.entries(report.byStatus)
        .map(([name, count]) => {
            const key = STATUS_KEY_BY_NAME[name] ?? name;

            return {
                key,
                name: t(`defectManagementPage.sprintReport.status.${key}`, {
                    defaultValue: name,
                }),
                count,
            };
        })
        .sort(
            (a, b) =>
                STATUS_SORT_ORDER.indexOf(a.key) -
                STATUS_SORT_ORDER.indexOf(b.key)
        );

    const severityTotal = Object.values(report.bySeverity).reduce(
        (sum, count) => sum + count,
        0
    );

    const severityData = Object.entries(report.bySeverity)
        .map(([raw, count]) => {
            const { label, order } = parseSeverity(raw);
            const percent =
                severityTotal > 0
                    ? Math.round((count / severityTotal) * 100)
                    : 0;

            return { key: raw, name: label, count, percent, order };
        })
        .sort((a, b) => a.order - b.order);

    // Same shape as severityData but scoped to bugs still open (not
    // Closed) - mirrors the "still open" definition used elsewhere (e.g.
    // StatusReportCard's openSeverityCounts, byStatusAll.Closed), so the
    // dashboard has a chart for "what's left to fix" alongside the general
    // all-time severity breakdown.
    const openBySeverity = report.effectiveDefects
        .filter((bug) => bug.state !== "Closed")
        .reduce<Record<string, number>>((acc, bug) => {
            const key = bug.severity ?? "Unspecified";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
        }, {});

    const openSeverityTotal = Object.values(openBySeverity).reduce(
        (sum, count) => sum + count,
        0
    );

    const openSeverityData = Object.entries(openBySeverity)
        .map(([raw, count]) => {
            const { label, order } = parseSeverity(raw);
            const percent =
                openSeverityTotal > 0
                    ? Math.round((count / openSeverityTotal) * 100)
                    : 0;

            return { key: raw, name: label, count, percent, order };
        })
        .sort((a, b) => a.order - b.order);

    return (
        <>
            <CardGrid>
                <StatCard
                    label={t("defectManagementPage.sprintReport.stats.total")}
                    value={report.total}
                />
                <StatCard
                    label={t("defectManagementPage.sprintReport.stats.effective")}
                    value={report.effectiveCount}
                />
                <StatCard
                    label={t("defectManagementPage.sprintReport.stats.outOfScope")}
                    value={report.outOfScopeCount}
                />
            </CardGrid>

            <Text className={styles.note}>
                {t("defectManagementPage.sprintReport.stats.outOfScopeNote")}
            </Text>

            <ChartsGrid>
                <ChartCard
                    title={t("defectManagementPage.sprintReport.charts.byOrigin")}
                >
                    {originData.length > 0 ? (
                        <div className={styles.chartColumn}>
                            <div className={styles.donutWrap}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <PieChart>
                                        <Pie
                                            data={originData}
                                            dataKey="value"
                                            nameKey="name"
                                            innerRadius={62}
                                            outerRadius={88}
                                            startAngle={90}
                                            endAngle={-270}
                                            stroke="none"
                                        >
                                            {originData.map((entry) => (
                                                <Cell
                                                    key={entry.key}
                                                    fill={ORIGIN_COLORS[entry.key]}
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className={styles.donutLabel}>
                                    <Text size={700} weight="bold">
                                        {report.effectiveCount}
                                    </Text>
                                </div>
                            </div>
                            <div className={styles.legend}>
                                {originData.map(({ key, name, value }) => (
                                    <div key={key} className={styles.legendRow}>
                                        <span
                                            className={styles.legendDot}
                                            style={{
                                                backgroundColor: ORIGIN_COLORS[key],
                                            }}
                                        />
                                        <Text
                                            className={styles.legendCount}
                                            weight="semibold"
                                        >
                                            {value}
                                        </Text>
                                        <Text>{name}</Text>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <EmptyState
                            message={t(
                                "defectManagementPage.sprintReport.charts.noEffectiveDefects"
                            )}
                        />
                    )}
                </ChartCard>

                <ChartCard
                    title={t("defectManagementPage.sprintReport.charts.byStatus")}
                >
                    {statusData.length > 0 ? (
                        <div>
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={statusData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 13 }} />
                                    <Tooltip />
                                    <Bar
                                        dataKey="count"
                                        cursor="pointer"
                                        onClick={(_data, index) => {
                                            const entry = statusData[index];
                                            selectStatus(entry.key, entry.name);
                                        }}
                                    >
                                        {statusData.map((entry) => (
                                            <Cell
                                                key={entry.key}
                                                fill={STATUS_COLORS[entry.key]}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                            <div className={styles.legend}>
                                {statusData.map(({ key, name, count }) => (
                                    <div key={key} className={styles.legendRow}>
                                        <span
                                            className={styles.legendDot}
                                            style={{
                                                backgroundColor: STATUS_COLORS[key],
                                            }}
                                        />
                                        <Text
                                            className={styles.legendCount}
                                            weight="semibold"
                                        >
                                            {count}
                                        </Text>
                                        <Text>{name}</Text>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <EmptyState
                            message={t(
                                "defectManagementPage.sprintReport.charts.noEffectiveDefects"
                            )}
                        />
                    )}
                </ChartCard>
            </ChartsGrid>

            <ChartCard
                title={t("defectManagementPage.sprintReport.charts.bySeverity")}
            >
                {severityData.length > 0 ? (
                    <div>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={severityData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 13 }} />
                                <Tooltip />
                                <Bar
                                    dataKey="count"
                                    fill="#d83b01"
                                    cursor="pointer"
                                    onClick={(_data, index) => {
                                        const entry = severityData[index];
                                        selectSeverity(entry.key, entry.name);
                                    }}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                        <div className={styles.legend}>
                            {severityData.map(({ key, name, count, percent }) => (
                                <div key={key} className={styles.legendRow}>
                                    <span
                                        className={styles.legendDot}
                                        style={{ backgroundColor: "#d83b01" }}
                                    />
                                    <Text
                                        className={styles.legendCount}
                                        weight="semibold"
                                    >
                                        {count} ({percent}%)
                                    </Text>
                                    <Text>{name}</Text>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <EmptyState
                        message={t(
                            "defectManagementPage.sprintReport.charts.noEffectiveDefects"
                        )}
                    />
                )}
            </ChartCard>

            <ChartCard
                title={t("defectManagementPage.sprintReport.charts.byOpenSeverity")}
            >
                {openSeverityData.length > 0 ? (
                    <div>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={openSeverityData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 13 }} />
                                <Tooltip />
                                <Bar
                                    dataKey="count"
                                    fill="#d13438"
                                    cursor="pointer"
                                    onClick={(_data, index) => {
                                        const entry = openSeverityData[index];
                                        selectSeverity(entry.key, entry.name);
                                    }}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                        <div className={styles.legend}>
                            {openSeverityData.map(({ key, name, count, percent }) => (
                                <div key={key} className={styles.legendRow}>
                                    <span
                                        className={styles.legendDot}
                                        style={{ backgroundColor: "#d13438" }}
                                    />
                                    <Text
                                        className={styles.legendCount}
                                        weight="semibold"
                                    >
                                        {count} ({percent}%)
                                    </Text>
                                    <Text>{name}</Text>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <EmptyState
                        message={t(
                            "defectManagementPage.sprintReport.charts.noEffectiveDefects"
                        )}
                    />
                )}
            </ChartCard>

            {filter && (
                <ChartCard
                    title={t("defectManagementPage.sprintReport.list.title", {
                        filter: filterLabel,
                    })}
                >
                    <div className={styles.listHeader}>
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<DismissRegular />}
                            onClick={() => setFilter(null)}
                        >
                            {t("defectManagementPage.sprintReport.list.clear")}
                        </Button>
                    </div>

                    {paginatedBugs.length > 0 ? (
                        <>
                            <BugsTable
                                bugs={paginatedBugs}
                                ariaLabel={t(
                                    "defectManagementPage.sprintReport.list.title",
                                    { filter: filterLabel }
                                )}
                                quickActionLabel={t(
                                    "defectManagementPage.sections.openInAdo"
                                )}
                            />
                            <Pagination
                                page={currentListPage}
                                pageCount={listPageCount}
                                onPageChange={setListPage}
                            />
                        </>
                    ) : (
                        <EmptyState
                            message={t(
                                "defectManagementPage.sprintReport.list.empty"
                            )}
                        />
                    )}
                </ChartCard>
            )}
        </>
    );
}
