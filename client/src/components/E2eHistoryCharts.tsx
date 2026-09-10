import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles, tokens } from "@fluentui/react-components";
import { useThemeMode } from "../hooks/useThemeMode";
import type { E2eRun } from "../types";

// Same brand-hue-per-chart approach as CycleTimeCharts.tsx's MARK_COLOR -
// a single series needs no categorical palette, just a value that reads on
// both the light and dark chart surface.
const MARK_COLOR = { light: "#0078D4", dark: "#3aa0f3" };

const CHART_WIDTH = 600;
const CHART_HEIGHT = 220;
const MARGIN = { top: 16, right: 12, bottom: 28, left: 36 };
const INNER_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

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

function useBandScale(n: number) {
    const bandWidth = n > 0 ? INNER_WIDTH / n : INNER_WIDTH;
    const labelEvery = Math.max(1, Math.ceil(n / 6));

    const xCenter = (index: number) => MARGIN.left + bandWidth * (index + 0.5);

    return { bandWidth, labelEvery, xCenter };
}

function GridAndAxis({
    xLabels,
    labelEvery,
    xCenter,
}: {
    xLabels: string[];
    labelEvery: number;
    xCenter: (index: number) => number;
}) {
    const styles = useStyles();
    // Fixed 0/50/100 ticks - the series is always a percentage, unlike
    // CycleTimeCharts.tsx's GridAndAxis which scales to a data-derived max.
    const ticks = [0, 50, 100];

    return (
        <g>
            {ticks.map((tick) => {
                const y = MARGIN.top + INNER_HEIGHT * (1 - tick / 100);

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
                            {tick}%
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

function formatRunDate(startedAt: string, language: string): string {
    return new Date(startedAt).toLocaleDateString(language, {
        day: "2-digit",
        month: "short",
    });
}

function passRatePct(run: E2eRun): number {
    return run.totalTests > 0
        ? Math.round((run.passed / run.totalTests) * 1000) / 10
        : 0;
}

// Expects `runs` oldest-first (the page reverses the API's newest-first
// order before passing it in) so the line reads left-to-right chronologically.
export function E2ePassRateTrendChart({ runs }: { runs: E2eRun[] }) {
    const styles = useStyles();
    const { i18n, t } = useTranslation();
    const { mode } = useThemeMode();
    const color = mode === "dark" ? MARK_COLOR.dark : MARK_COLOR.light;
    const [hovered, setHovered] = useState<number | null>(null);

    const { bandWidth, labelEvery, xCenter } = useBandScale(runs.length);

    const yFor = (pct: number) => MARGIN.top + INNER_HEIGHT * (1 - pct / 100);

    const linePath = runs
        .map(
            (run, index) =>
                `${index === 0 ? "M" : "L"} ${xCenter(index)} ${yFor(passRatePct(run))}`
        )
        .join(" ");

    const last = runs[runs.length - 1];

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("e2eHistoryPage.passRateChartLabel")}
            >
                <GridAndAxis
                    xLabels={runs.map((r) => formatRunDate(r.startedAt, i18n.language))}
                    labelEvery={labelEvery}
                    xCenter={xCenter}
                />

                <path
                    d={linePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />

                {runs.map((run, index) => {
                    const isLast = index === runs.length - 1;
                    const isHovered = hovered === index;

                    return (
                        <g key={run.id}>
                            {(isLast || isHovered) && (
                                <circle
                                    cx={xCenter(index)}
                                    cy={yFor(passRatePct(run))}
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
                        x={xCenter(runs.length - 1)}
                        y={yFor(passRatePct(last)) - 10}
                        textAnchor="middle"
                    >
                        {t("e2eHistoryPage.passRateValue", { pct: passRatePct(last) })}
                    </text>
                )}
            </svg>

            {hovered !== null && runs[hovered] && (
                <div
                    className={styles.tooltip}
                    style={{
                        left: `${(xCenter(hovered) / CHART_WIDTH) * 100}%`,
                        top: `${(yFor(passRatePct(runs[hovered])) / CHART_HEIGHT) * 100}%`,
                    }}
                >
                    <div className={styles.tooltipValue}>
                        {t("e2eHistoryPage.passRateValue", {
                            pct: passRatePct(runs[hovered]),
                        })}
                    </div>
                    <div className={styles.tooltipLabel}>
                        {formatRunDate(runs[hovered].startedAt, i18n.language)} ·{" "}
                        {runs[hovered].branch}
                    </div>
                </div>
            )}
        </div>
    );
}
