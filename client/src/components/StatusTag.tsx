import type { ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { STATUS_TONE_COLOR, type StatusTone } from "./statusTone";

const useStyles = makeStyles({
    tag: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground2,
    },
    dot: {
        width: "6px",
        height: "6px",
        borderRadius: tokens.borderRadiusCircular,
        flexShrink: 0,
    },
});

export function StatusTag({ tone, children }: { tone: StatusTone; children: ReactNode }) {
    const styles = useStyles();

    return (
        <span className={styles.tag}>
            <span className={styles.dot} style={{ backgroundColor: STATUS_TONE_COLOR[tone] }} />
            {children}
        </span>
    );
}
