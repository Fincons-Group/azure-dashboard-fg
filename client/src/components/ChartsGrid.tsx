import type { ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
});

export function ChartsGrid({ children }: { children: ReactNode }) {
    const styles = useStyles();

    return <div className={styles.grid}>{children}</div>;
}
