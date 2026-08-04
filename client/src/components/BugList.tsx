import { Link, Text, mergeClasses, makeStyles, tokens } from "@fluentui/react-components";
import { BugFilled, CheckmarkCircleFilled } from "@fluentui/react-icons";
import type { BugInfo } from "../types";
import { compareByState } from "../utils/bugState";

const useStyles = makeStyles({
    list: {
        marginTop: tokens.spacingVerticalXS,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
    bug: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        marginLeft: tokens.spacingHorizontalL,
        fontSize: tokens.fontSizeBase200,
    },
    active: {
        color: tokens.colorPaletteRedForeground1,
    },
    closed: {
        color: tokens.colorPaletteGreenForeground1,
    },
});

export function BugList({ bugs }: { bugs: BugInfo[] }) {
    const styles = useStyles();
    const sortedBugs = [...bugs].sort(compareByState);

    return (
        <div className={styles.list}>
            {sortedBugs.map((bug) => {
                const isActive = bug.state !== "Closed";
                const icon = isActive ? (
                    <BugFilled aria-hidden="true" />
                ) : (
                    <CheckmarkCircleFilled aria-hidden="true" />
                );
                const base =
                    bug.priority != null
                        ? `P${bug.priority} · ${bug.id} - ${bug.title} (${bug.state})`
                        : `${bug.id} - ${bug.title} (${bug.state})`;
                const label = bug.creator
                    ? `${base} · ${bug.creator}`
                    : base;

                return (
                    <Text
                        key={bug.id}
                        className={mergeClasses(
                            styles.bug,
                            isActive ? styles.active : styles.closed
                        )}
                    >
                        {icon}
                        {bug.url ? (
                            <Link href={bug.url} target="_blank" rel="noreferrer">
                                {label}
                            </Link>
                        ) : (
                            label
                        )}
                    </Text>
                );
            })}
        </div>
    );
}
