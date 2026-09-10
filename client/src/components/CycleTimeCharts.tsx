import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles, tokens } from "@fluentui/react-components";
import { useThemeMode } from "../hooks/useThemeMode";
import type { CycleTimeTrendPoint, ThroughputPoint } from "../types";

// One brand hue per chart, theme-aware (see CoverageRoadmapTable.tsx's own
// note on this) - a single series needs no categorical palette, just a
// value that reads on both the light and dark chart surface.
const MARK_COLOR = { light: "#0078D4", dark: "#3aa0f3" };

const CHART_WIDTH = 600;
const CHART_HEIGHT = 220;
const MARGIN = { top: 16, right: 12, bottom: 28, left: 36 };
const INNER_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

// Rounds a max value up to a "clean" axis ceiling (1/2/5/10/20/50/100...)
// so gridline ticks read as round numbers instead of raw data maxima.
function niceCeil(value: number): number {
    if (value <= 0) {
        return 1;
    }

    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

    return step * magnitude;
}

const useStyles = makeStyles({
    wrapper: {
        position: "relative",
    },
    svg: {
        display: "block",
        width: "100%",
        height: "auto",
        overflow: "visible",
    },
    gridline: {
        stroke: tokens.colorNeutralStroke2,
        strokeWidth: 1,
    },
    axisText: {
        fill: tokens.colorNeutralForeground3,
        fontSize: "9px",
    },
    endLabel: {
        fill: tokens.colorNeutralForeground1,
        fontSize: "10px",
        fontWeight: 600,
    },
    hitArea: {
        fill: "transparent",
        cursor: "pointer",
    },
    tooltip: {
        position: "absolute",
        pointerEvents: "none",
        transform: "translate(-50%, -100%)",
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: "6px 10px",
        boxShadow: tokens.shadow8,
        fontSize: "12px",
        whiteSpace: "nowrap",
        zIndex: 1,
    },
    tooltipValue: {
        fontWeight: 700,
        color: tokens.colorNeutralForeground1,
    },
    tooltipLabel: {
        color: tokens.colorNeutralForeground3,
        marginTop: "2px",
    },
});

function formatWeek(weekStart: string, language: string): string {
    return new Date(weekStart).toLocaleDateString(language, {
        day: "2-digit",
        month: "short",
    });
}

// Every axis position + geometry a bar/line chart needs, derived once from
// the shared band-scale math both charts use (n categorical positions across
// the same inner plot area).
function useBandScale(n: number) {
    const bandWidth = n > 0 ? INNER_WIDTH / n : INNER_WIDTH;
    const labelEvery = Math.max(1, Math.ceil(n / 6));

    const xCenter = (index: number) => MARGIN.left + bandWidth * (index + 0.5);

    return { bandWidth, labelEvery, xCenter };
}

function GridAndAxis({
    maxValue,
    xLabels,
    labelEvery,
    xCenter,
}: {
    maxValue: number;
    xLabels: string[];
    labelEvery: number;
    xCenter: (index: number) => number;
}) {
    const styles = useStyles();
    const ticks = [0, maxValue / 2, maxValue];

    return (
        <g>
            {ticks.map((tick) => {
                const y = MARGIN.top + INNER_HEIGHT * (1 - tick / maxValue);

                return (
                    <g key={tick}>
                        <line
                            className={styles.gridline}
                            x1={MARGIN.left}
                            x2={CHART_WIDTH - MARGIN.right}
                            y1={y}
                            y2={y}
                        />
                        <text
                            className={styles.axisText}
                            x={MARGIN.left - 6}
                            y={y}
                            textAnchor="end"
                            dominantBaseline="middle"
                        >
                            {Math.round(tick)}
                        </text>
                    </g>
                );
            })}

            {xLabels.map((label, index) =>
                index % labelEvery === 0 ? (
                    <text
                        key={label + index}
                        className={styles.axisText}
                        x={xCenter(index)}
                        y={CHART_HEIGHT - MARGIN.bottom + 14}
                        textAnchor="middle"
                    >
                        {label}
                    </text>
                ) : null
            )}
        </g>
    );
}

export function ThroughputBarChart({ points }: { points: ThroughputPoint[] }) {
    const styles = useStyles();
    const { i18n, t } = useTranslation();
    const { mode } = useThemeMode();
    const color = mode === "dark" ? MARK_COLOR.dark : MARK_COLOR.light;
    const [hovered, setHovered] = useState<number | null>(null);

    const { bandWidth, labelEvery, xCenter } = useBandScale(points.length);
    const maxValue = niceCeil(Math.max(1, ...points.map((p) => p.completedCount)));
    const barWidth = Math.min(24, bandWidth * 0.6);

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("cycleTimePage.throughputChartLabel")}
            >
                <GridAndAxis
                    maxValue={maxValue}
                    xLabels={points.map((p) => formatWeek(p.weekStart, i18n.language))}
                    labelEvery={labelEvery}
                    xCenter={xCenter}
                />

                {points.map((point, index) => {
                    const barHeight =
                        (point.completedCount / maxValue) * INNER_HEIGHT;
                    const x = xCenter(index) - barWidth / 2;
                    const y = MARGIN.top + INNER_HEIGHT - barHeight;

                    return (
                        <g key={point.weekStart}>
                            <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={Math.max(barHeight, 1)}
                                rx={4}
                                fill={color}
                                opacity={hovered === null || hovered === index ? 1 : 0.5}
                            />
                            <rect
                                className={styles.hitArea}
                                x={xCenter(index) - bandWidth / 2}
                                y={MARGIN.top}
                                width={bandWidth}
                                height={INNER_HEIGHT}
                                onMouseEnter={() => setHovered(index)}
                                onMouseLeave={() => setHovered(null)}
                                onFocus={() => setHovered(index)}
                                onBlur={() => setHovered(null)}
                                tabIndex={0}
                            />
                        </g>
                    );
                })}
            </svg>

            {hovered !== null && points[hovered] && (
                <div
                    className={styles.tooltip}
                    style={{
                        left: `${(xCenter(hovered) / CHART_WIDTH) * 100}%`,
                        top: `${(MARGIN.top / CHART_HEIGHT) * 100}%`,
                    }}
                >
                    <div className={styles.tooltipValue}>
                        {t("cycleTimePage.tasksCompleted", {
                            count: points[hovered].completedCount,
                        })}
                    </div>
                    <div className={styles.tooltipLabel}>
                        {formatWeek(points[hovered].weekStart, i18n.language)}
                    </div>
                </div>
            )}
        </div>
    );
}

export function CycleTimeLineChart({ points }: { points: CycleTimeTrendPoint[] }) {
    const styles = useStyles();
    const { i18n, t } = useTranslation();
    const { mode } = useThemeMode();
    const color = mode === "dark" ? MARK_COLOR.dark : MARK_COLOR.light;
    const [hovered, setHovered] = useState<number | null>(null);

    const { bandWidth, labelEvery, xCenter } = useBandScale(points.length);
    const maxValue = niceCeil(
        Math.max(1, ...points.map((p) => p.avgCycleTimeDays))
    );

    const yFor = (value: number) =>
        MARGIN.top + INNER_HEIGHT * (1 - value / maxValue);

    const linePath = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${xCenter(index)} ${yFor(point.avgCycleTimeDays)}`)
        .join(" ");

    const last = points[points.length - 1];

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("cycleTimePage.cycleTimeChartLabel")}
            >
                <GridAndAxis
                    maxValue={maxValue}
                    xLabels={points.map((p) => formatWeek(p.weekStart, i18n.language))}
                    labelEvery={labelEvery}
                    xCenter={xCenter}
                />

                <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

                {points.map((point, index) => {
                    const isLast = index === points.length - 1;
                    const isHovered = hovered === index;

                    return (
                        <g key={point.weekStart}>
                            {(isLast || isHovered) && (
                                <circle
                                    cx={xCenter(index)}
                                    cy={yFor(point.avgCycleTimeDays)}
                                    r={5}
                                    fill={color}
                                    stroke={tokens.colorNeutralBackground1}
                                    strokeWidth={2}
                                />
                            )}
                            <rect
                                className={styles.hitArea}
                                x={xCenter(index) - bandWidth / 2}
                                y={MARGIN.top}
                                width={bandWidth}
                                height={INNER_HEIGHT}
                                onMouseEnter={() => setHovered(index)}
                                onMouseLeave={() => setHovered(null)}
                                onFocus={() => setHovered(index)}
                                onBlur={() => setHovered(null)}
                                tabIndex={0}
                            />
                        </g>
                    );
                })}

                {last && (
                    <text
                        className={styles.endLabel}
                        x={xCenter(points.length - 1)}
                        y={yFor(last.avgCycleTimeDays) - 10}
                        textAnchor="middle"
                    >
                        {t("cycleTimePage.avgDaysShort", { days: last.avgCycleTimeDays })}
                    </text>
                )}
            </svg>

            {hovered !== null && points[hovered] && (
                <div
                    className={styles.tooltip}
                    style={{
                        left: `${(xCenter(hovered) / CHART_WIDTH) * 100}%`,
                        top: `${(yFor(points[hovered].avgCycleTimeDays) / CHART_HEIGHT) * 100}%`,
                    }}
                >
                    <div className={styles.tooltipValue}>
                        {t("cycleTimePage.avgDays", {
                            days: points[hovered].avgCycleTimeDays,
                        })}
                    </div>
                    <div className={styles.tooltipLabel}>
                        {formatWeek(points[hovered].weekStart, i18n.language)} ·{" "}
                        {t("cycleTimePage.tasksCompleted", {
                            count: points[hovered].completedCount,
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
