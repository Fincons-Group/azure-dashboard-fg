import { forwardRef, useMemo } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "@fluentui/react-components";
import { SuiteProgressBar } from "./SuiteProgressBar";
import type { Outcome, SprintDefectReport } from "../types";

function formatUpdatedTimestamp(date: Date): {
    datePart: string;
    timePart: string;
} {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return {
        datePart: `${day}/${month}`,
        timePart: `${hours}:${minutes}`,
    };
}

export interface SuiteProgressGroup {
    label: string;
    totalTestCases: number;
    outcomeCounts: Record<Outcome, number>;
}

// Severity is stored as "N - Label" (e.g. "1 - Critical"); the leading rank
// number is what drives both sort order and color, same convention used in
// SprintDefectReportTab.tsx and export.ts's severityRank.
function severityRank(raw: string): number {
    const match = /^(\d+)\s*-/.exec(raw);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function severityLabel(raw: string): string {
    const match = /^(\d+)\s*-\s*(.+)$/.exec(raw);
    return match ? match[2] : raw;
}

// The three severities this card always shows a chip for, even when a
// severity has zero bugs - keeps the row's shape stable sprint to sprint
// instead of chips appearing/disappearing as counts hit zero.
const SEVERITY_KEYS = ["1 - Critical", "2 - High", "3 - Medium"];

const SEVERITY_PALETTE = [
    { bg: "#442726", border: "#d13438", text: "#ff9b93" },
    { bg: "#3d3319", border: "#eda100", text: "#f4c669" },
    { bg: "#26313d", border: "#5b8bb0", text: "#9cc7e6" },
];
const SEVERITY_FALLBACK = { bg: "#2d2d2d", border: "#605e5c", text: "#c8c6c4" };

// Order/colors match the reference status card: most-done to least-done,
// left to right (green -> blue -> amber -> salmon), with the out-of-scope
// "Not Applicable" bucket trailing at the end.
const STATUS_ORDER = ["Closed", "Resolved", "In Progress", "New", "Not Applicable"];
const STATUS_COLORS: Record<string, string> = {
    Closed: "#3fb950",
    Resolved: "#0078d4",
    "In Progress": "#eda100",
    New: "#e8746c",
    "Not Applicable": "#8a8886",
};
const STATUS_LABEL_KEYS: Record<string, string> = {
    Closed: "closed",
    Resolved: "resolved",
    "In Progress": "inProgress",
    New: "new",
    "Not Applicable": "notApplicable",
};

// Matches the server-side fallback bucket in computeDuplicateSuiteBySuite
// (defectData.ts) for a Test Agenti/Business bug whose linked test case
// couldn't be title-matched to a Test Factory suite - shown as its own
// callout instead of a suite name so it reads as "needs manual review"
// rather than an unlabeled/generic suite.
const UNMATCHED_SUITE_KEY = "Unspecified";

const ACTION_PALETTE = [
    { bg: "#3d3319", border: "#eda100" },
    { bg: "#1f3550", border: "#3aa0f3" },
];

// A paragraph like "In arrivo su Azure DevOps: la maschera..." gets its
// "Label:" lead-in bolded, matching the reference card - only when the
// colon shows up early/on the first line, so it doesn't misfire on
// sentences that just happen to contain a colon further in.
function splitActionLeadIn(paragraph: string): {
    lead: string | null;
    rest: string;
} {
    const match = /^([^:\n]{1,80}:)\s*([\s\S]*)$/.exec(paragraph);

    if (!match) {
        return { lead: null, rest: paragraph };
    }

    return { lead: match[1], rest: match[2] };
}

const useStyles = makeStyles({
    card: {
        maxWidth: "900px",
        display: "flex",
        flexDirection: "column",
        borderRadius: "8px",
        overflow: "hidden",
        backgroundColor: "#1f1f1f",
        color: "#f3f2f1",
        fontFamily:
            "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "12px",
        padding: "14px 18px",
        backgroundColor: "#3e4a68",
    },
    headerTitleGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: "0",
    },
    headerTitle: {
        fontSize: "17px",
        fontWeight: 700,
        color: "#ffffff",
    },
    headerSubtitle: {
        fontSize: "12px",
        color: "#c3c9d9",
    },
    headerTimestamp: {
        fontSize: "11px",
        color: "#c3c9d9",
        whiteSpace: "nowrap",
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "18px",
    },
    alertBanner: {
        display: "flex",
        gap: "8px",
        padding: "10px 12px",
        borderRadius: "6px",
        backgroundColor: "#3d2f14",
        borderLeft: "4px solid #eda100",
        fontSize: "13px",
        lineHeight: 1.4,
    },
    kpiGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: "8px",
    },
    kpiTile: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2px",
        padding: "10px 6px",
        // Fixed rather than content-sized so the second-row tile (alone,
        // with a single-line label) matches the height that row 1's grid
        // row is stretched to by its tallest tile (avgClosureTime's
        // two-line label) - otherwise it'd render visibly shorter.
        minHeight: "64px",
        boxSizing: "border-box",
        borderRadius: "6px",
        backgroundColor: "#2d2d2d",
        textAlign: "center",
    },
    kpiValue: {
        fontSize: "20px",
        fontWeight: 700,
    },
    kpiLabel: {
        fontSize: "10px",
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        color: "#c8c6c4",
        // Lets \n in translation strings (e.g. kpis.totalTestCases) render
        // as an actual line break instead of collapsing to a space.
        whiteSpace: "pre-line",
    },
    dashboardButton: {
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "10px 16px",
        borderRadius: "6px",
        backgroundColor: "#0078d4",
        color: "#ffffff",
        fontSize: "13px",
        fontWeight: 600,
        textDecoration: "none",
        whiteSpace: "nowrap",
    },
    sectionTitle: {
        fontSize: "14px",
        fontWeight: 600,
        color: "#f3f2f1",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    actionsBox: {
        padding: "10px 12px",
        borderRadius: "6px",
        borderLeft: "4px solid",
        fontSize: "13px",
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
    },
    emptyNote: {
        fontSize: "12px",
        color: "#8a8886",
        fontStyle: "italic",
    },
    sectionHeader: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    sectionSubtitle: {
        fontSize: "11px",
        color: "#8a8886",
    },
    statusSummaryRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "8px",
        flexWrap: "wrap",
    },
    statusSummaryMain: {
        fontSize: "13px",
        color: "#f3f2f1",
    },
    statusStillOpen: {
        fontSize: "13px",
        fontWeight: 700,
        color: "#e8746c",
        whiteSpace: "nowrap",
    },
    statusTrack: {
        display: "flex",
        width: "100%",
        height: "10px",
        borderRadius: "5px",
        overflow: "hidden",
        backgroundColor: "#3b3a39",
    },
    statusSummary: {
        fontSize: "12px",
        color: "#c8c6c4",
    },
    statusLegend: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "5px",
        fontSize: "12px",
        color: "#c8c6c4",
    },
    swatch: {
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "2px",
        marginRight: "3px",
    },
    legendSeparator: {
        color: "#605e5c",
    },
    severityCaption: {
        fontSize: "11px",
        color: "#8a8886",
        textAlign: "center",
    },
    severityRow: {
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
    },
    severityChip: {
        flex: "1 1 80px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 6px",
        borderRadius: "6px",
        border: "1px solid",
    },
    severityCount: {
        fontSize: "18px",
        fontWeight: 700,
    },
    severityPercent: {
        fontSize: "10px",
        opacity: 0.85,
    },
    severityLabelText: {
        fontSize: "11px",
    },
    originPanel: {
        display: "flex",
        borderRadius: "6px",
        overflow: "hidden",
        border: "1px solid #3b3a39",
    },
    originLabel: {
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "26px",
        padding: "6px 0",
        fontSize: "11px",
        fontWeight: 700,
        writingMode: "vertical-rl",
        transform: "rotate(180deg)",
        whiteSpace: "nowrap",
    },
    originBody: {
        flex: 1,
        display: "flex",
        gap: "6px",
        padding: "8px",
    },
    originSuiteGrid: {
        flex: "2 1 0",
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "6px",
        alignContent: "start",
    },
    originTotals: {
        flex: "1 1 0",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    originTile: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2px",
        padding: "8px 4px",
        borderRadius: "6px",
        backgroundColor: "#2d2d2d",
        textAlign: "center",
        minHeight: "44px",
    },
    originValue: {
        fontSize: "17px",
        fontWeight: 700,
        color: "#3aa0f3",
    },
    originCaption: {
        fontSize: "9px",
        color: "#c8c6c4",
        lineHeight: 1.2,
    },
});

export interface StatusReportCardProps {
    headerTitle: string;
    headerSubtitle: string;
    suiteGroups: SuiteProgressGroup[];
    report: SprintDefectReport;
    alertText: string;
    actionsText: string;
    dashboardUrl?: string;
    dashboardLinkRef?: RefObject<HTMLAnchorElement | null>;
    // Off by default - the Test Factory/Test Agenti/Business breakdown is
    // still being validated, so existing report sends stay unaffected
    // unless someone opts in for a given card.
    showOriginBreakdown?: boolean;
    // On by default (bugs are tracked in DSI org-wide) - Plurifond has no
    // DSI-sourced bugs yet, so its report sets this to false to keep the
    // subtitle from claiming a source that doesn't apply.
    includeDsiSource?: boolean;
}

export const StatusReportCard = forwardRef<
    HTMLDivElement,
    StatusReportCardProps
>(function StatusReportCard(
    {
        headerTitle,
        headerSubtitle,
        suiteGroups,
        report,
        alertText,
        actionsText,
        dashboardUrl,
        dashboardLinkRef,
        showOriginBreakdown = false,
        includeDsiSource = true,
    },
    ref
) {
    const { t } = useTranslation();
    const styles = useStyles();

    // Fixed to when the card first mounts rather than recomputed every
    // render, so it reads as "generated at" and doesn't visibly tick
    // forward while editing the alert/actions text below.
    const { datePart, timePart } = useMemo(
        () => formatUpdatedTimestamp(new Date()),
        []
    );

    const totalTestCases = suiteGroups.reduce(
        (sum, group) => sum + group.totalTestCases,
        0
    );

    // Pass rate = Passed / everything except NotApplicable - matches the
    // per-suite pass rate shown in SuiteProgressBar. NotApplicable is
    // excluded because those cases were never meant to run; every other
    // outcome (including NotRun/Blocked/InProgress) still counts against
    // the rate since it isn't a pass yet.
    const totalPassed = suiteGroups.reduce(
        (sum, group) => sum + group.outcomeCounts.Passed,
        0
    );
    const totalNotApplicable = suiteGroups.reduce(
        (sum, group) => sum + group.outcomeCounts.NotApplicable,
        0
    );
    const totalDecided = totalTestCases - totalNotApplicable;
    const passRate = totalDecided
        ? Math.round((totalPassed / totalDecided) * 100)
        : 0;
    const notApplicableRate = totalTestCases
        ? Math.round((totalNotApplicable / totalTestCases) * 100)
        : 0;

    // Bug status covers ALL detected bugs (including out-of-scope ones -
    // they still need to be tracked to closure), so this and "still open"
    // are measured against report.total via byStatusAll, not effectiveCount.
    const bugsClosed = report.byStatusAll.Closed ?? 0;
    const bugsClosedPct = report.total
        ? Math.round((bugsClosed / report.total) * 100)
        : 0;
    const stillOpen = report.total - bugsClosed;

    const reopenedPct = report.total
        ? Math.round((report.reopenedCount / report.total) * 1000) / 10
        : 0;
    // Always shown as a number, even when there's no closed bug yet to
    // compute a real average from - a blank/"N/A" tile reads as broken on
    // the exported card, 0 reads as "nothing to report yet".
    const avgClosureDays = Math.round(report.mttrDays ?? 0);

    // Only non-closed bugs count here - a closed critical bug isn't
    // something the reader still needs to act on.
    const criticalCount = report.effectiveDefects.filter(
        (bug) => bug.state !== "Closed" && severityRank(bug.severity ?? "") === 1
    ).length;

    // Closed/Resolved/In Progress/New are scoped to effective (in-scope)
    // bugs via byStatus - out-of-scope bugs are pulled into their own "Not
    // Applicable" bucket instead, so the two together still sum to
    // report.total like byStatusAll used to.
    const statusEntries = STATUS_ORDER.map((name) => [
        name,
        name === "Not Applicable"
            ? report.outOfScopeCount
            : report.byStatus[name] ?? 0,
    ] as const).filter(([, count]) => count > 0);

    // Severity distribution stays scoped to effective (in-scope) bugs only,
    // matching the caption under the chips. Always shows all three known
    // severities (defaulting missing ones to 0) rather than only the
    // severities present in the data, so e.g. "Critical" doesn't just
    // disappear from the row when there happen to be zero critical bugs.
    const severityTotal = Object.values(report.bySeverity).reduce(
        (sum, count) => sum + count,
        0
    );
    const severityEntries = SEVERITY_KEYS.map(
        (key) => [key, report.bySeverity[key] ?? 0] as const
    );

    // Same idea as severityEntries above, but scoped to effective bugs that
    // are still open - lets the card show whether the remaining open work
    // skews critical/high even after most bugs have been closed out.
    const openSeverityCounts = report.effectiveDefects.reduce<
        Record<string, number>
    >((acc, bug) => {
        if (bug.state === "Closed") {
            return acc;
        }

        const key = bug.severity ?? "Unspecified";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
    }, {});
    const openSeverityTotal = Object.values(openSeverityCounts).reduce(
        (sum, count) => sum + count,
        0
    );
    const openSeverityEntries = SEVERITY_KEYS.map(
        (key) => [key, openSeverityCounts[key] ?? 0] as const
    );

    const actionParagraphs = actionsText
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

    const bugSources = [
        ...suiteGroups.map((group) => group.label),
        ...(includeDsiSource ? ["DSI"] : []),
    ].join(", ");

    const originPanels = [
        {
            origin: "Test Factory",
            labelKey: "defectManagementPage.sprintReport.origin.testFactory",
            bySuite: report.testFactoryBySuite,
            labelBg: "#1f3d1f",
            labelText: "#6bcf6b",
        },
        {
            origin: "Test Agenti",
            labelKey: "defectManagementPage.sprintReport.origin.testAgenti",
            bySuite: report.testAgentiBySuite,
            labelBg: "#1f2f4d",
            labelText: "#5b9bd5",
        },
        {
            origin: "Business",
            labelKey: "defectManagementPage.sprintReport.origin.business",
            bySuite: report.testBusinessBySuite,
            labelBg: "#3d3319",
            labelText: "#f2b134",
        },
    ].map((panel) => ({
        ...panel,
        suiteEntries: Object.entries(panel.bySuite).sort(([a], [b]) =>
            a.localeCompare(b)
        ),
        detected: report.byOriginDetected[panel.origin] ?? 0,
        accepted: report.byOrigin[panel.origin] ?? 0,
    }));

    return (
        <div ref={ref} className={styles.card}>
            <div className={styles.header}>
                <div className={styles.headerTitleGroup}>
                    <span className={styles.headerTitle}>{headerTitle}</span>
                    <span className={styles.headerSubtitle}>
                        {headerSubtitle}
                    </span>
                </div>
                <span className={styles.headerTimestamp}>
                    {t(
                        "defectManagementPage.sprintReport.statusCard.updatedAt",
                        { date: datePart, time: timePart }
                    )}
                </span>
            </div>

            <div className={styles.body}>
            {alertText && (
                <div className={styles.alertBanner}>
                    <span>⚠️</span>
                    <span>{alertText}</span>
                </div>
            )}

            <div className={styles.kpiGrid}>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#3aa0f3" }}>
                        {totalTestCases}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.totalTestCases"
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#6bcf6b" }}>
                        {passRate}%
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.passRate"
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#f2b134" }}>
                        {bugsClosed}/{report.total}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.bugsClosed",
                            { percent: bugsClosedPct }
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#ff6b6b" }}>
                        {criticalCount}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.criticalBugs"
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#3aa0f3" }}>
                        {report.reopenedCount}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs",
                            { percent: reopenedPct }
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#6bcf6b" }}>
                        {t("defectManagementPage.stats.days", {
                            value: avgClosureDays,
                        })}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime"
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#b180d7" }}>
                        {report.effectiveCount}/{report.total}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected"
                        )}
                    </span>
                </div>
                {report.outOfScopeCount > 0 && (
                    <div className={styles.kpiTile}>
                        <span className={styles.kpiValue} style={{ color: "#9e9e9e" }}>
                            {report.outOfScopeCount}/{report.total}
                        </span>
                        <span className={styles.kpiLabel}>
                            {t(
                                "defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected"
                            )}
                        </span>
                    </div>
                )}
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#8a8886" }}>
                        {report.withoutResolutionDateCount}
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate"
                        )}
                    </span>
                </div>
                <div className={styles.kpiTile}>
                    <span className={styles.kpiValue} style={{ color: "#8a8886" }}>
                        {notApplicableRate}%
                    </span>
                    <span className={styles.kpiLabel}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.kpis.notApplicableRate"
                        )}
                    </span>
                </div>
            </div>

            {dashboardUrl && (
                <a
                    ref={dashboardLinkRef}
                    href={dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.dashboardButton}
                >
                    {t(
                        "defectManagementPage.sprintReport.statusCard.openDashboard"
                    )}
                </a>
            )}

            {actionParagraphs.length > 0 && (
                <div className={styles.section}>
                    <span className={styles.sectionTitle}>
                        📌{" "}
                        {t(
                            "defectManagementPage.sprintReport.statusCard.actionsTitle"
                        )}
                    </span>
                    {actionParagraphs.map((paragraph, index) => {
                        const palette =
                            ACTION_PALETTE[index % ACTION_PALETTE.length];
                        const { lead, rest } = splitActionLeadIn(paragraph);

                        return (
                            <div
                                key={index}
                                className={styles.actionsBox}
                                style={{
                                    backgroundColor: palette.bg,
                                    borderLeftColor: palette.border,
                                }}
                            >
                                {lead && <strong>{lead} </strong>}
                                {rest}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className={styles.section}>
                <span className={styles.sectionTitle}>
                    📈{" "}
                    {t(
                        "defectManagementPage.sprintReport.statusCard.suiteProgressTitle"
                    )}
                </span>

                {suiteGroups.length > 0 ? (
                    suiteGroups.map((group) => (
                        <SuiteProgressBar
                            key={group.label}
                            suiteName={group.label}
                            totalTestCases={group.totalTestCases}
                            outcomeCounts={group.outcomeCounts}
                        />
                    ))
                ) : (
                    <span className={styles.emptyNote}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.noPlanSelected"
                        )}
                    </span>
                )}
            </div>

            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                        🐛{" "}
                        {t(
                            "defectManagementPage.sprintReport.statusCard.bugStatusTitle"
                        )}
                    </span>
                    <span className={styles.sectionSubtitle}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.bugStatusSubtitle",
                            { sources: bugSources }
                        )}
                    </span>
                </div>

                <div className={styles.statusSummaryRow}>
                    <span className={styles.statusSummaryMain}>
                        <strong>
                            {t(
                                "defectManagementPage.sprintReport.statusCard.bugsDetected",
                                { count: report.total }
                            )}
                        </strong>{" "}
                        –{" "}
                        {t(
                            "defectManagementPage.sprintReport.statusCard.bugStatusSummary",
                            {
                                effective: report.effectiveCount,
                                outOfScope: report.outOfScopeCount,
                            }
                        )}
                    </span>
                    <span className={styles.statusStillOpen}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.stillOpen",
                            { count: stillOpen }
                        )}
                    </span>
                </div>

                <div className={styles.statusTrack}>
                    {statusEntries.map(([name, count]) => (
                        <div
                            key={name}
                            style={{
                                width: `${(count / report.total) * 100}%`,
                                backgroundColor: STATUS_COLORS[name],
                            }}
                        />
                    ))}
                </div>

                <span className={styles.statusLegend}>
                    {statusEntries.map(([name, count], index) => (
                        <span key={name}>
                            {index > 0 && (
                                <span className={styles.legendSeparator}>
                                    {" | "}
                                </span>
                            )}
                            <span
                                className={styles.swatch}
                                style={{ backgroundColor: STATUS_COLORS[name] }}
                            />
                            {count}{" "}
                            {t(
                                `defectManagementPage.sprintReport.statusCard.statusLabels.${STATUS_LABEL_KEYS[name]}`
                            )}
                        </span>
                    ))}
                </span>

                <div className={styles.severityRow}>
                    {severityEntries.map(([raw, count]) => {
                        const rank = severityRank(raw);
                        const palette =
                            SEVERITY_PALETTE[rank - 1] ?? SEVERITY_FALLBACK;
                        const percent = severityTotal
                            ? Math.round((count / severityTotal) * 100)
                            : 0;

                        return (
                            <div
                                key={raw}
                                className={styles.severityChip}
                                style={{
                                    backgroundColor: palette.bg,
                                    borderColor: palette.border,
                                }}
                            >
                                <span
                                    className={styles.severityCount}
                                    style={{ color: palette.text }}
                                >
                                    {count}
                                </span>
                                <span
                                    className={styles.severityPercent}
                                    style={{ color: palette.text }}
                                >
                                    {percent}%
                                </span>
                                <span
                                    className={styles.severityLabelText}
                                    style={{ color: palette.text }}
                                >
                                    {severityLabel(raw)}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <span className={styles.severityCaption}>
                    {t(
                        "defectManagementPage.sprintReport.statusCard.severityCaption",
                        { count: report.effectiveCount }
                    )}
                </span>

                <div className={styles.severityRow}>
                    {openSeverityEntries.map(([raw, count]) => {
                        const rank = severityRank(raw);
                        const palette =
                            SEVERITY_PALETTE[rank - 1] ?? SEVERITY_FALLBACK;
                        const percent = openSeverityTotal
                            ? Math.round((count / openSeverityTotal) * 100)
                            : 0;

                        return (
                            <div
                                key={raw}
                                className={styles.severityChip}
                                style={{
                                    backgroundColor: palette.bg,
                                    borderColor: palette.border,
                                }}
                            >
                                <span
                                    className={styles.severityCount}
                                    style={{ color: palette.text }}
                                >
                                    {count}
                                </span>
                                <span
                                    className={styles.severityPercent}
                                    style={{ color: palette.text }}
                                >
                                    {percent}%
                                </span>
                                <span
                                    className={styles.severityLabelText}
                                    style={{ color: palette.text }}
                                >
                                    {severityLabel(raw)}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <span className={styles.severityCaption}>
                    {t(
                        "defectManagementPage.sprintReport.statusCard.openSeverityCaption",
                        { count: openSeverityTotal }
                    )}
                </span>
            </div>

            {showOriginBreakdown &&
                originPanels.some((panel) => panel.suiteEntries.length > 0) && (
                <div className={styles.section}>
                    <span className={styles.sectionTitle}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.originBreakdown.title"
                        )}
                    </span>

                    {originPanels
                        .filter((panel) => panel.suiteEntries.length > 0)
                        .map((panel) => (
                            <div key={panel.origin} className={styles.originPanel}>
                                <span
                                    className={styles.originLabel}
                                    style={{
                                        backgroundColor: panel.labelBg,
                                        color: panel.labelText,
                                    }}
                                >
                                    {t(panel.labelKey)}
                                </span>

                                <div className={styles.originBody}>
                                    <div className={styles.originSuiteGrid}>
                                        {panel.suiteEntries.map(([suite, count]) => (
                                            <div
                                                key={suite}
                                                className={styles.originTile}
                                            >
                                                <span className={styles.originValue}>
                                                    {count}
                                                </span>
                                                <span className={styles.originCaption}>
                                                    {suite === UNMATCHED_SUITE_KEY
                                                        ? t(
                                                              "defectManagementPage.sprintReport.statusCard.originBreakdown.unmatched"
                                                          )
                                                        : t(
                                                              "defectManagementPage.sprintReport.statusCard.originBreakdown.bugsInSuite",
                                                              { suite }
                                                          )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <div className={styles.originTotals}>
                                        <div className={styles.originTile}>
                                            <span className={styles.originValue}>
                                                {panel.detected}
                                            </span>
                                            <span className={styles.originCaption}>
                                                {t(
                                                    "defectManagementPage.sprintReport.statusCard.originBreakdown.detected"
                                                )}
                                            </span>
                                        </div>
                                        <div className={styles.originTile}>
                                            <span className={styles.originValue}>
                                                {panel.accepted}
                                            </span>
                                            <span className={styles.originCaption}>
                                                {t(
                                                    "defectManagementPage.sprintReport.statusCard.originBreakdown.accepted"
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                </div>
            )}
            </div>
        </div>
    );
});
