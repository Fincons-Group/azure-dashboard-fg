import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles, tokens } from "@fluentui/react-components";
import { useThemeMode } from "../hooks/useThemeMode";
import type { CoverageByModule } from "../types";

// Same single-series brand hue approach as CycleTimeCharts.tsx (this chart
// has no categorical breakdown to color by either, just one coverage % per
// module).
const MARK_COLOR = { light: "#0078D4", dark: "#3aa0f3" };

const CHART_WIDTH = 600;
const CHART_HEIGHT = 240;
const MARGIN = { top: 16, right: 12, bottom: 44, left: 36 };
const INNER_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

// Fixed 0-100 axis rather than CycleTimeCharts.tsx's niceCeil(data max) -
// this chart is always a percentage, so a shrinking axis on low-coverage
// data would misrepresent how far from full coverage a module actually is.
const MAX_PCT = 100;

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
    moduleLabel: {
        fill: tokens.colorNeutralForeground3,
        fontSize: "9px",
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

function truncateLabel(label: string, maxChars = 10): string {
    return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
}

export function ModuleCoverageBarChart({
    modules,
}: {
    modules: CoverageByModule[];
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const { mode } = useThemeMode();
    const color = mode === "dark" ? MARK_COLOR.dark : MARK_COLOR.light;
    const [hovered, setHovered] = useState<number | null>(null);

    const n = modules.length;
    const bandWidth = n > 0 ? INNER_WIDTH / n : INNER_WIDTH;
    const barWidth = Math.min(32, bandWidth * 0.6);
    const xCenter = (index: number) => MARGIN.left + bandWidth * (index + 0.5);
    const ticks = [0, MAX_PCT / 2, MAX_PCT];

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("automationKpiPage.moduleChartLabel")}
            >
                <g>
                    {ticks.map((tick) => {
                        const y = MARGIN.top + INNER_HEIGHT * (1 - tick / MAX_PCT);

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
                </g>

                {modules.map((module, index) => {
                    const barHeight = (module.coveragePct / MAX_PCT) * INNER_HEIGHT;
                    const x = xCenter(index) - barWidth / 2;
                    const y = MARGIN.top + INNER_HEIGHT - barHeight;

                    return (
                        <g key={module.module}>
                            <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={Math.max(barHeight, 1)}
                                rx={4}
                                fill={color}
                                opacity={hovered === null || hovered === index ? 1 : 0.5}
                            />
                            <text
                                className={styles.moduleLabel}
                                x={xCenter(index)}
                                y={CHART_HEIGHT - MARGIN.bottom + 14}
                                textAnchor="middle"
                                transform={`rotate(20, ${xCenter(index)}, ${
                                    CHART_HEIGHT - MARGIN.bottom + 14
                                })`}
                            >
                                {truncateLabel(module.module)}
                            </text>
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

            {hovered !== null && modules[hovered] && (
                <div
                    className={styles.tooltip}
                    style={{
                        left: `${(xCenter(hovered) / CHART_WIDTH) * 100}%`,
                        top: `${(MARGIN.top / CHART_HEIGHT) * 100}%`,
                    }}
                >
                    <div className={styles.tooltipValue}>
                        {t("automationKpiPage.coveragePctValue", {
                            pct: modules[hovered].coveragePct,
                        })}
                    </div>
                    <div className={styles.tooltipLabel}>
                        {modules[hovered].module} ·{" "}
                        {t("automationKpiPage.automatedOfTotal", {
                            automated: modules[hovered].automated,
                            total:
                                modules[hovered].automated + modules[hovered].manual,
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
