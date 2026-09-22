import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Card,
    Dropdown,
    Input,
    Option,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import { ChevronRightRegular, SearchRegular } from "@fluentui/react-icons";
import { StatusTag } from "./StatusTag";
import { STATUS_TONE_COLOR, type StatusTone } from "./statusTone";
import { CARD_RADIUS } from "../layoutConstants";
import type { CoverageArea, CoverageStatus, CoverageTask } from "../types";

// Shared with StatusTag's own dot so the epic pill, the coverage progress
// bar, and each task's dot all agree on what "done"/"in-progress"/"at-risk"
// looks like, from one theme-aware token map instead of three hardcoded ones.
const STATUS_TONE: Record<CoverageStatus, StatusTone> = {
    done: "success",
    "in-progress": "warning",
    "at-risk": "danger",
};

function initials(name: string | null): string {
    if (!name) {
        return "?";
    }

    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("");
}

const useStyles = makeStyles({
    card: {
        padding: 0,
        overflow: "hidden",
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
    },
    filterBar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        padding: tokens.spacingHorizontalM,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    searchInput: {
        flexGrow: 1,
        maxWidth: "320px",
    },
    summaryStrip: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalL,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    summaryCount: {
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    noResults: {
        padding: tokens.spacingHorizontalM,
        color: tokens.colorNeutralForeground3,
        fontStyle: "italic",
    },
    headerRow: {
        display: "grid",
        gridTemplateColumns: "2.3fr 2.4fr 1.2fr 1fr 1.3fr auto",
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    headerCell: {
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
    },
    epicRow: {
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    summaryRow: {
        display: "grid",
        gridTemplateColumns: "2.3fr 2.4fr 1.2fr 1fr 1.3fr auto",
        gap: tokens.spacingHorizontalM,
        alignItems: "center",
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
        cursor: "pointer",
        border: "none",
        background: "none",
        width: "100%",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        ":hover": {
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
    },
    chevron: {
        transition: "transform 120ms ease",
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    chevronOpen: {
        transform: "rotate(90deg)",
    },
    areaName: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },
    areaNameText: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    epicMeta: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
    coverageCell: {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
    },
    track: {
        display: "flex",
        width: "100%",
        height: "8px",
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    coverageLabel: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
    owner: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
    },
    avatar: {
        width: "24px",
        height: "24px",
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
        fontSize: "10px",
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    dueDate: {
        fontSize: "13px",
        color: tokens.colorNeutralForeground2,
    },
    tasks: {
        display: "flex",
        flexDirection: "column",
        padding: `4px ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM} 46px`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    taskHeaderRow: {
        display: "grid",
        gridTemplateColumns: "3.4fr 1fr 1.1fr",
        gap: tokens.spacingHorizontalM,
        padding: "8px 0 4px",
        color: tokens.colorNeutralForeground3,
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
    },
    taskRow: {
        display: "grid",
        gridTemplateColumns: "3.4fr 1fr 1.1fr",
        gap: tokens.spacingHorizontalM,
        padding: "7px 0",
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke2,
        alignItems: "center",
    },
    taskTitle: {
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    taskLink: {
        color: tokens.colorBrandForegroundLink,
        ":hover": {
            color: tokens.colorBrandForegroundLinkHover,
        },
    },
    taskDot: {
        width: "6px",
        height: "6px",
        borderRadius: tokens.borderRadiusCircular,
        flexShrink: 0,
    },
    taskId: {
        color: tokens.colorNeutralForeground3,
        fontSize: "11px",
    },
    taskAssignee: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground2,
    },
    taskStatus: {
        fontSize: "12px",
        fontWeight: 600,
    },
    emptyTasks: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        fontStyle: "italic",
        padding: "8px 0",
    },
});

function TaskRow({ task }: { task: CoverageTask }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const dotColor = task.isDone
        ? STATUS_TONE_COLOR.success
        : (tokens.colorNeutralStroke2 as string);
    const fgColor = task.isDone ? STATUS_TONE_COLOR.success : tokens.colorNeutralForeground3;

    return (
        <div className={styles.taskRow}>
            <span className={styles.taskTitle}>
                <span className={styles.taskDot} style={{ backgroundColor: dotColor }} />
                {task.url ? (
                    <a href={task.url} target="_blank" rel="noreferrer" className={styles.taskLink}>
                        {task.title}
                    </a>
                ) : (
                    task.title
                )}
                <span className={styles.taskId}>#{task.id}</span>
            </span>
            <span className={styles.taskAssignee}>
                {task.assignee ?? t("coverageRoadmapPage.unassigned")}
            </span>
            <span className={styles.taskStatus} style={{ color: fgColor }}>
                {task.state}
            </span>
        </div>
    );
}

function EpicRow({
    area,
    expanded,
    onToggle,
}: {
    area: CoverageArea;
    expanded: boolean;
    onToggle: () => void;
}) {
    const styles = useStyles();
    const { t, i18n } = useTranslation();

    const dueDateLabel = area.dueDate
        ? new Date(area.dueDate).toLocaleDateString(i18n.language, {
              day: "2-digit",
              month: "short",
          })
        : "—";

    const coverageLabel =
        area.targetPct != null
            ? t("coverageRoadmapPage.coverageOfTarget", {
                  done: area.tasks.filter((task) => task.isDone).length,
                  total: area.tasks.length,
                  target: area.targetPct,
              })
            : t("coverageRoadmapPage.coverageNoTarget", {
                  done: area.tasks.filter((task) => task.isDone).length,
                  total: area.tasks.length,
              });

    return (
        <div className={styles.epicRow}>
            <button
                type="button"
                className={styles.summaryRow}
                onClick={onToggle}
                aria-expanded={expanded}
            >
                <span className={styles.areaName}>
                    <ChevronRightRegular
                        className={mergeClasses(
                            styles.chevron,
                            expanded && styles.chevronOpen
                        )}
                        fontSize={12}
                    />
                    <span className={styles.areaNameText}>
                        <Text weight="semibold">{area.title}</Text>
                        <span className={styles.epicMeta}>
                            {t("coverageRoadmapPage.epicMeta", {
                                id: area.id,
                                count: area.tasks.length,
                            })}
                        </span>
                    </span>
                </span>

                <span className={styles.coverageCell}>
                    <div className={styles.track}>
                        <div
                            style={{
                                width: `${area.currentPct}%`,
                                height: "100%",
                                backgroundColor: STATUS_TONE_COLOR[STATUS_TONE[area.status]],
                            }}
                        />
                    </div>
                    <span className={styles.coverageLabel}>{coverageLabel}</span>
                </span>

                <span className={styles.owner}>
                    <span className={styles.avatar}>{initials(area.owner)}</span>
                    <Text size={200}>{area.owner ?? t("coverageRoadmapPage.unassigned")}</Text>
                </span>

                <span className={styles.dueDate}>{dueDateLabel}</span>

                <StatusTag tone={STATUS_TONE[area.status]}>
                    {t(`coverageRoadmapPage.status.${area.status}`)}
                </StatusTag>

                <span />
            </button>

            {expanded && (
                <div className={styles.tasks}>
                    {area.tasks.length === 0 ? (
                        <span className={styles.emptyTasks}>
                            {t("coverageRoadmapPage.noTasks")}
                        </span>
                    ) : (
                        <>
                            <div className={styles.taskHeaderRow}>
                                <span>{t("coverageRoadmapPage.taskColumns.task")}</span>
                                <span>{t("coverageRoadmapPage.taskColumns.assignee")}</span>
                                <span>{t("coverageRoadmapPage.taskColumns.status")}</span>
                            </div>
                            {area.tasks.map((task) => (
                                <TaskRow key={task.id} task={task} />
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export function CoverageRoadmapTable({ areas }: { areas: CoverageArea[] }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<CoverageStatus | "">("");

    const toggle = (id: number) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    };

    const counts = useMemo(() => {
        return {
            total: areas.length,
            done: areas.filter((area) => area.status === "done").length,
            inProgress: areas.filter((area) => area.status === "in-progress").length,
            atRisk: areas.filter((area) => area.status === "at-risk").length,
        };
    }, [areas]);

    const filteredAreas = useMemo(() => {
        const query = search.trim().toLowerCase();

        return areas.filter((area) => {
            const matchesStatus = !statusFilter || area.status === statusFilter;
            const matchesQuery =
                !query ||
                area.title.toLowerCase().includes(query) ||
                (area.owner ?? "").toLowerCase().includes(query);

            return matchesStatus && matchesQuery;
        });
    }, [areas, search, statusFilter]);

    const statusFilterLabel = statusFilter
        ? t(`coverageRoadmapPage.status.${statusFilter}`)
        : t("coverageRoadmapPage.statusFilterAll");

    return (
        <Card className={styles.card}>
            <div className={styles.filterBar}>
                <Input
                    className={styles.searchInput}
                    contentBefore={<SearchRegular />}
                    placeholder={t("coverageRoadmapPage.searchPlaceholder")}
                    value={search}
                    onChange={(_, data) => setSearch(data.value)}
                />
                <Dropdown
                    value={statusFilterLabel}
                    selectedOptions={statusFilter ? [statusFilter] : [""]}
                    onOptionSelect={(_, data) =>
                        setStatusFilter((data.optionValue as CoverageStatus | "") ?? "")
                    }
                >
                    <Option value="">{t("coverageRoadmapPage.statusFilterAll")}</Option>
                    <Option value="done">{t("coverageRoadmapPage.status.done")}</Option>
                    <Option value="in-progress">
                        {t("coverageRoadmapPage.status.in-progress")}
                    </Option>
                    <Option value="at-risk">{t("coverageRoadmapPage.status.at-risk")}</Option>
                </Dropdown>
            </div>

            <div className={styles.summaryStrip}>
                <span className={styles.summaryCount}>
                    {t("coverageRoadmapPage.summary.total", { count: counts.total })}
                </span>
                <span>{t("coverageRoadmapPage.summary.done", { count: counts.done })}</span>
                <span>
                    {t("coverageRoadmapPage.summary.inProgress", { count: counts.inProgress })}
                </span>
                <span>{t("coverageRoadmapPage.summary.atRisk", { count: counts.atRisk })}</span>
            </div>

            <div className={styles.headerRow}>
                <span className={styles.headerCell}>
                    {t("coverageRoadmapPage.columns.area")}
                </span>
                <span className={styles.headerCell}>
                    {t("coverageRoadmapPage.columns.coverage")}
                </span>
                <span className={styles.headerCell}>
                    {t("coverageRoadmapPage.columns.owner")}
                </span>
                <span className={styles.headerCell}>
                    {t("coverageRoadmapPage.columns.due")}
                </span>
                <span className={styles.headerCell}>
                    {t("coverageRoadmapPage.columns.status")}
                </span>
                <span />
            </div>

            {filteredAreas.length === 0 && (
                <Text as="p" className={styles.noResults}>
                    {t("coverageRoadmapPage.noResults")}
                </Text>
            )}

            {filteredAreas.map((area) => (
                <EpicRow
                    key={area.id}
                    area={area}
                    expanded={expandedIds.has(area.id)}
                    onToggle={() => toggle(area.id)}
                />
            ))}
        </Card>
    );
}
