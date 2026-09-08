import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Text, makeStyles, tokens } from "@fluentui/react-components";
import {
    ChevronRightRegular,
    CheckmarkCircleRegular,
    ClockRegular,
    WarningRegular,
} from "@fluentui/react-icons";
import { useThemeMode } from "../hooks/useThemeMode";
import type { CoverageArea, CoverageStatus, CoverageTask } from "../types";

// The bar/dot fill is one saturated color in both themes (it reads fine on
// the neutral track either way); fg/bg are separate per theme because a text
// color tuned for a light tint background (dark theme) is unreadable on a
// dark one and vice versa - same problem StatusReportCard's SEVERITY_PALETTE
// solves by only ever rendering on its own fixed dark card. This page
// switches with the app's light/dark toggle, so it needs both.
const STATUS_COLORS_LIGHT: Record<
    CoverageStatus,
    { fg: string; bg: string; bar: string }
> = {
    done: { fg: "#227A3B", bg: "rgba(63,185,80,0.14)", bar: "#3fb950" },
    "in-progress": { fg: "#8A5A00", bg: "rgba(237,161,0,0.16)", bar: "#eda100" },
    "at-risk": { fg: "#A4262C", bg: "rgba(209,52,56,0.14)", bar: "#d13438" },
};

const STATUS_COLORS_DARK: Record<
    CoverageStatus,
    { fg: string; bg: string; bar: string }
> = {
    done: { fg: "#6bcf6b", bg: "rgba(63,185,80,0.22)", bar: "#3fb950" },
    "in-progress": { fg: "#f4c669", bg: "rgba(237,161,0,0.22)", bar: "#eda100" },
    "at-risk": { fg: "#ff9b93", bg: "rgba(209,52,56,0.22)", bar: "#d13438" },
};

const STATUS_ICONS: Record<CoverageStatus, typeof CheckmarkCircleRegular> = {
    done: CheckmarkCircleRegular,
    "in-progress": ClockRegular,
    "at-risk": WarningRegular,
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
    statusPill: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        width: "fit-content",
        padding: "4px 10px 4px 8px",
        borderRadius: tokens.borderRadiusCircular,
        fontSize: "12px",
        fontWeight: 600,
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

function StatusPill({ status }: { status: CoverageStatus }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const { mode } = useThemeMode();
    const colors = (mode === "dark" ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT)[
        status
    ];
    const Icon = STATUS_ICONS[status];

    return (
        <span
            className={styles.statusPill}
            style={{ backgroundColor: colors.bg, color: colors.fg }}
        >
            <Icon fontSize={12} />
            {t(`coverageRoadmapPage.status.${status}`)}
        </span>
    );
}

function TaskRow({ task }: { task: CoverageTask }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const { mode } = useThemeMode();
    const palette = mode === "dark" ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
    const colors = task.isDone
        ? palette.done
        : { fg: tokens.colorNeutralForeground3, bg: "", bar: tokens.colorNeutralStroke2 as string };

    return (
        <div className={styles.taskRow}>
            <span className={styles.taskTitle}>
                <span className={styles.taskDot} style={{ backgroundColor: colors.bar }} />
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
            <span className={styles.taskStatus} style={{ color: colors.fg }}>
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
    const { mode } = useThemeMode();
    const palette = mode === "dark" ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;

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
                        className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}
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
                                backgroundColor: palette[area.status].bar,
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

                <StatusPill status={area.status} />

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

    return (
        <Card className={styles.card}>
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

            {areas.map((area) => (
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
