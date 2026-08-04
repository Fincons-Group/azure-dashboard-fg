import { useTranslation } from "react-i18next";
import { makeStyles } from "@fluentui/react-components";
import type { Outcome } from "../types";

// Fixed dark-card palette (not Fluent tokens) - this component only ever
// renders inside StatusReportCard, which must look the same regardless of
// the app's light/dark theme. NotApplicable and NotRun intentionally share
// the same neutral gray (matching the reference card, where both read as
// "not meaningfully executed" rather than getting their own colors).
const OUTCOME_COLORS: Record<Outcome, string> = {
    Passed: "#3fb950",
    Failed: "#d13438",
    Blocked: "#eda100",
    Paused: "#b180d7",
    InProgress: "#3aa0f3",
    NotApplicable: "#8a8886",
    NotRun: "#8a8886",
};

const SEGMENT_ORDER: Outcome[] = [
    "Passed",
    "Failed",
    "Blocked",
    "Paused",
    "InProgress",
    "NotApplicable",
    "NotRun",
];

// Same RAG thresholds as the executed-% text color: fully done reads green,
// badly behind reads red, in-between reads amber.
function executedColor(pct: number): string {
    if (pct >= 90) {
        return "#3fb950";
    }

    if (pct < 30) {
        return "#d13438";
    }

    return "#eda100";
}

const useStyles = makeStyles({
    row: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "8px",
    },
    suiteName: {
        fontWeight: 600,
        color: "#f3f2f1",
    },
    executedPct: {
        fontSize: "12px",
        fontWeight: 700,
        whiteSpace: "nowrap",
    },
    track: {
        display: "flex",
        width: "100%",
        height: "9px",
        borderRadius: "5px",
        overflow: "hidden",
        backgroundColor: "#3b3a39",
    },
    legend: {
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
    separator: {
        color: "#605e5c",
    },
    passRate: {
        fontWeight: 700,
        color: "#f3f2f1",
    },
});

export function SuiteProgressBar({
    suiteName,
    totalTestCases,
    outcomeCounts,
}: {
    suiteName: string;
    totalTestCases: number;
    outcomeCounts: Record<Outcome, number>;
}) {
    const { t } = useTranslation();
    const styles = useStyles();

    const executed = totalTestCases - outcomeCounts.NotRun;
    const executedPct = totalTestCases
        ? Math.round((executed / totalTestCases) * 100)
        : 0;

    // Pass rate = Passed / everything except NotApplicable - those cases
    // were never meant to run, so they're excluded; every other outcome
    // (NotRun/Blocked/InProgress included) still counts against the rate.
    const decided = totalTestCases - outcomeCounts.NotApplicable;
    const passRate = decided
        ? Math.round((outcomeCounts.Passed / decided) * 100)
        : 0;

    const legendEntries = SEGMENT_ORDER.filter(
        (outcome) => outcomeCounts[outcome] > 0
    );

    return (
        <div className={styles.row}>
            <div className={styles.header}>
                <span className={styles.suiteName}>
                    {suiteName} –{" "}
                    {t("defectManagementPage.sprintReport.statusCard.casesCount", {
                        count: totalTestCases,
                    })}
                </span>
                <span
                    className={styles.executedPct}
                    style={{ color: executedColor(executedPct) }}
                >
                    {executedPct}%{" "}
                    {t("defectManagementPage.sprintReport.statusCard.executed")}
                </span>
            </div>

            <div className={styles.track}>
                {legendEntries.map((outcome) => (
                    <div
                        key={outcome}
                        style={{
                            width: `${(outcomeCounts[outcome] / totalTestCases) * 100}%`,
                            backgroundColor: OUTCOME_COLORS[outcome],
                        }}
                    />
                ))}
            </div>

            <span className={styles.legend}>
                {legendEntries.map((outcome, index) => (
                    <span key={outcome}>
                        {index > 0 && (
                            <span className={styles.separator}>{" | "}</span>
                        )}
                        <span
                            className={styles.swatch}
                            style={{ backgroundColor: OUTCOME_COLORS[outcome] }}
                        />
                        {outcomeCounts[outcome]} {t(`outcome.${outcome}`)}
                    </span>
                ))}
                <span className={styles.separator}>{" | "}</span>
                <span className={styles.passRate}>
                    {t("defectManagementPage.sprintReport.statusCard.passRate")}:{" "}
                    {passRate}%
                </span>
            </span>
        </div>
    );
}
