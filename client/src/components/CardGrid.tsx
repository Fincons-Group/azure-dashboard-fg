import type { ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: tokens.spacingHorizontalM,

        "@media (max-width: 480px)": {
            gridTemplateColumns: "1fr",
        },
    },
});

export function CardGrid({ children }: { children: ReactNode }) {
    const styles = useStyles();

    return <div className={styles.grid}>{children}</div>;
}
