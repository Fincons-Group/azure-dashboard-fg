import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

export interface RunHistoryPoint {
    outcome: string;
    date: string;
    detail?: string;
}

const useStyles = makeStyles({
    strip: {
        display: "flex",
        gap: "4px",
        flexWrap: "wrap",
    },
    dot: {
        width: "10px",
        height: "10px",
        borderRadius: tokens.borderRadiusCircular,
        flexShrink: 0,
    },
});

// "Blocked"/"NotApplicable"/etc. all fall back to neutral - only pass/fail
// need their own color for this strip to read at a glance.
function dotColor(outcome: string): string {
    const normalized = outcome.toLowerCase();
    if (normalized === "passed") return tokens.colorPaletteGreenForeground1;
    if (normalized === "failed") return tokens.colorPaletteRedForeground1;
    return tokens.colorNeutralForeground3;
}

// Renders a small left-to-right (oldest-to-newest) strip of colored dots, one
// per run, hover-titled with outcome/detail/date. `points` is expected
// newest-first (the convention every run/history list already uses in this
// app) and reversed internally so the strip reads chronologically.
export function RunHistoryStrip({ points, className }: { points: RunHistoryPoint[]; className?: string }) {
    const styles = useStyles();

    if (points.length === 0) return <>—</>;

    return (
        <div className={mergeClasses(styles.strip, className)}>
            {[...points].reverse().map((point, i) => (
                <span
                    key={i}
                    className={styles.dot}
                    style={{ backgroundColor: dotColor(point.outcome) }}
                    title={`${point.outcome}${point.detail ? ` (${point.detail})` : ""} - ${new Date(point.date).toLocaleString()}`}
                />
            ))}
        </div>
    );
}
