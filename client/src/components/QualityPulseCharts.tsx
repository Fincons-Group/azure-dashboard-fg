import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles, tokens } from "@fluentui/react-components";
import { useThemeMode } from "../hooks/useThemeMode";
import type { PipelineTrendPoint, SuiteModuleStats, EscapeModuleStats } from "../pages/qualityPulseMockData";

// Same single brand hue approach as CycleTimeCharts.tsx/AutomationKpiCharts.tsx
// for the two single-series charts here (build trend, defect escapes).
const MARK_COLOR = { light: "#0078D4", dark: "#3aa0f3" };

// Passed/failed reuse QaControlCenterPage's OUTCOME_COLORS hex (kept in sync
// manually - that map isn't exported); flaky reuses its "blocked" amber
// since this codebase has no existing flaky-state color to borrow instead.
const PASSED_COLOR = "#43a047";
const FAILED_COLOR = "#e05252";
const FLAKY_COLOR = "#c97b00";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 220;
const MARGIN = { top: 16, right: 12, bottom: 44, left: 36 };
const INNER_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

function niceCeil(value: number): number {
    if (value <= 0) {
        return 1;
    }

    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

    return step * magnitude;
}

function truncateLabel(label: string, maxChars = 10): string {
    return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
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
    moduleLabel: {
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
    tooltipRow: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        color: tokens.colorNeutralForeground3,
        marginTop: "2px",
    },
    tooltipDot: {
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flexShrink: 0,
    },
    legend: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalM,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
        marginTop: tokens.spacingVerticalXS,
    },
    legendDot: {
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        marginRight: "4px",
    },
});

function useBandScale(n: number) {
    const bandWidth = n > 0 ? INNER_WIDTH / n : INNER_WIDTH;

    const xCenter = (index: number) => MARGIN.left + bandWidth * (index + 0.5);

    return { bandWidth, xCenter };
}

function formatDay(iso: string, language: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(language, { day: "2-digit", month: "short" });
}

/** Pipeline Overview's build trend - pass rate is already a 0-100 bound, so
 * the y-axis is fixed rather than niceCeil'd off the data max like other
 * charts here. */
export function BuildTrendLineChart({ points }: { points: PipelineTrendPoint[] }) {
    const styles = useStyles();
    const { i18n, t } = useTranslation();
    const { mode } = useThemeMode();
    const color = mode === "dark" ? MARK_COLOR.dark : MARK_COLOR.light;
    const [hovered, setHovered] = useState<number | null>(null);

    const { bandWidth, xCenter } = useBandScale(points.length);
    const maxValue = 100;
    const yFor = (value: number) => MARGIN.top + INNER_HEIGHT * (1 - value / maxValue);
    const ticks = [0, 50, 100];

    const linePath = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${xCenter(index)} ${yFor(point.passRatePct)}`)
        .join(" ");

    const last = points[points.length - 1];

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("qualityPulsePage.pipeline.trendChartLabel")}
            >
                <g>
                    {ticks.map((tick) => {
                        const y = yFor(tick);

                        return (
                            <g key={tick}>
                                <line className={styles.gridline} x1={MARGIN.left} x2={CHART_WIDTH - MARGIN.right} y1={y} y2={y} />
                                <text className={styles.axisText} x={MARGIN.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
                                    {tick}%
                                </text>
                            </g>
                        );
                    })}
                    {points.map((point, index) =>
                        index % 2 === 0 ? (
                            <text key={point.date} className={styles.axisText} x={xCenter(index)} y={CHART_HEIGHT - MARGIN.bottom + 14} textAnchor="middle">
                                {formatDay(point.date, i18n.language)}
                            </text>
                        ) : null
                    )}
                </g>

                <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

                {points.map((point, index) => {
                    const isLast = index === points.length - 1;
                    const isHovered = hovered === index;

                    return (
                        <g key={point.date}>
                            {(isLast || isHovered) && (
                                <circle cx={xCenter(index)} cy={yFor(point.passRatePct)} r={5} fill={color} stroke={tokens.colorNeutralBackground1} strokeWidth={2} />
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
                    <text className={styles.endLabel} x={xCenter(points.length - 1)} y={yFor(last.passRatePct) - 10} textAnchor="middle">
                        {last.passRatePct}%
                    </text>
                )}
            </svg>

            {hovered !== null && points[hovered] && (
                <div
                    className={styles.tooltip}
                    style={{
                        left: `${(xCenter(hovered) / CHART_WIDTH) * 100}%`,
                        top: `${(yFor(points[hovered].passRatePct) / CHART_HEIGHT) * 100}%`,
                    }}
                >
                    <div className={styles.tooltipValue}>{points[hovered].passRatePct}%</div>
                    <div className={styles.tooltipRow}>{formatDay(points[hovered].date, i18n.language)}</div>
                </div>
            )}
        </div>
    );
}

/** Suite Analytics - a stacked bar per module (passed/failed/flaky run
 * counts). No existing chart in this codebase stacks multiple series in
 * SVG (QaControlCenterPage's stack is a flex-row of divs, not a per-category
 * chart), so this follows ModuleCoverageBarChart's per-category band-scale
 * layout but cumulatively offsets three rects per column instead of one. */
export function SuiteStackedBarChart({ modules }: { modules: SuiteModuleStats[] }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const [hovered, setHovered] = useState<number | null>(null);

    const { bandWidth, xCenter } = useBandScale(modules.length);
    const barWidth = Math.min(32, bandWidth * 0.6);
    const totals = modules.map((m) => m.passed + m.failed + m.flaky);
    const maxValue = niceCeil(Math.max(1, ...totals));
    const ticks = [0, maxValue / 2, maxValue];

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("qualityPulsePage.suiteAnalytics.chartLabel")}
            >
                <g>
                    {ticks.map((tick) => {
                        const y = MARGIN.top + INNER_HEIGHT * (1 - tick / maxValue);

                        return (
                            <g key={tick}>
                                <line className={styles.gridline} x1={MARGIN.left} x2={CHART_WIDTH - MARGIN.right} y1={y} y2={y} />
                                <text className={styles.axisText} x={MARGIN.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
                                    {Math.round(tick)}
                                </text>
                            </g>
                        );
                    })}
                </g>

                {modules.map((m, index) => {
                    const segments = [
                        { key: "passed", value: m.passed, color: PASSED_COLOR },
                        { key: "failed", value: m.failed, color: FAILED_COLOR },
                        { key: "flaky", value: m.flaky, color: FLAKY_COLOR },
                    ];
                    let cumulative = 0;
                    const x = xCenter(index) - barWidth / 2;

                    return (
                        <g key={m.module}>
                            {segments.map((seg) => {
                                const segHeight = (seg.value / maxValue) * INNER_HEIGHT;
                                const y = MARGIN.top + INNER_HEIGHT - (cumulative / maxValue) * INNER_HEIGHT - segHeight;
                                cumulative += seg.value;

                                return (
                                    <rect
                                        key={seg.key}
                                        x={x}
                                        y={y}
                                        width={barWidth}
                                        height={Math.max(segHeight, 0)}
                                        fill={seg.color}
                                        opacity={hovered === null || hovered === index ? 1 : 0.5}
                                    />
                                );
                            })}
                            <text
                                className={styles.moduleLabel}
                                x={xCenter(index)}
                                y={CHART_HEIGHT - MARGIN.bottom + 14}
                                textAnchor="middle"
                                transform={`rotate(20, ${xCenter(index)}, ${CHART_HEIGHT - MARGIN.bottom + 14})`}
                            >
                                {truncateLabel(m.module)}
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
                    <div className={styles.tooltipValue}>{modules[hovered].module}</div>
                    <div className={styles.tooltipRow}>
                        <span className={styles.tooltipDot} style={{ backgroundColor: PASSED_COLOR }} />
                        {t("qualityPulsePage.suiteAnalytics.legend.passed")}: {modules[hovered].passed}
                    </div>
                    <div className={styles.tooltipRow}>
                        <span className={styles.tooltipDot} style={{ backgroundColor: FAILED_COLOR }} />
                        {t("qualityPulsePage.suiteAnalytics.legend.failed")}: {modules[hovered].failed}
                    </div>
                    <div className={styles.tooltipRow}>
                        <span className={styles.tooltipDot} style={{ backgroundColor: FLAKY_COLOR }} />
                        {t("qualityPulsePage.suiteAnalytics.legend.flaky")}: {modules[hovered].flaky}
                    </div>
                </div>
            )}

            <div className={styles.legend}>
                <span><span className={styles.legendDot} style={{ backgroundColor: PASSED_COLOR }} />{t("qualityPulsePage.suiteAnalytics.legend.passed")}</span>
                <span><span className={styles.legendDot} style={{ backgroundColor: FAILED_COLOR }} />{t("qualityPulsePage.suiteAnalytics.legend.failed")}</span>
                <span><span className={styles.legendDot} style={{ backgroundColor: FLAKY_COLOR }} />{t("qualityPulsePage.suiteAnalytics.legend.flaky")}</span>
            </div>
        </div>
    );
}

/** Defect Escapes - single-hue bar, already sorted worst-first by the caller
 * so it reads alongside ModuleCoverageBarChart's per-module coverage bars
 * (same module set, same order) without needing a second axis. */
export function EscapesBarChart({ modules }: { modules: EscapeModuleStats[] }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const { mode } = useThemeMode();
    const color = mode === "dark" ? MARK_COLOR.dark : MARK_COLOR.light;
    const [hovered, setHovered] = useState<number | null>(null);

    const { bandWidth, xCenter } = useBandScale(modules.length);
    const barWidth = Math.min(32, bandWidth * 0.6);
    const maxValue = niceCeil(Math.max(1, ...modules.map((m) => m.escapes)));
    const ticks = [0, maxValue / 2, maxValue];

    return (
        <div className={styles.wrapper}>
            <svg
                className={styles.svg}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={t("qualityPulsePage.defectEscapes.escapesChartLabel")}
            >
                <g>
                    {ticks.map((tick) => {
                        const y = MARGIN.top + INNER_HEIGHT * (1 - tick / maxValue);

                        return (
                            <g key={tick}>
                                <line className={styles.gridline} x1={MARGIN.left} x2={CHART_WIDTH - MARGIN.right} y1={y} y2={y} />
                                <text className={styles.axisText} x={MARGIN.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
                                    {Math.round(tick)}
                                </text>
                            </g>
                        );
                    })}
                </g>

                {modules.map((m, index) => {
                    const barHeight = (m.escapes / maxValue) * INNER_HEIGHT;
                    const x = xCenter(index) - barWidth / 2;
                    const y = MARGIN.top + INNER_HEIGHT - barHeight;

                    return (
                        <g key={m.module}>
                            <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx={4} fill={color} opacity={hovered === null || hovered === index ? 1 : 0.5} />
                            <text
                                className={styles.moduleLabel}
                                x={xCenter(index)}
                                y={CHART_HEIGHT - MARGIN.bottom + 14}
                                textAnchor="middle"
                                transform={`rotate(20, ${xCenter(index)}, ${CHART_HEIGHT - MARGIN.bottom + 14})`}
                            >
                                {truncateLabel(m.module)}
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
                        {t("qualityPulsePage.defectEscapes.escapesCount", { count: modules[hovered].escapes })}
                    </div>
                    <div className={styles.tooltipRow}>{modules[hovered].module}</div>
                </div>
            )}
        </div>
    );
}
