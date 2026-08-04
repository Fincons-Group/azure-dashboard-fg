import type { ReactNode } from "react";
import { Card, Title3, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    card: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        minWidth: "0",
    },
});

export function ChartCard({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    const styles = useStyles();

    return (
        <Card className={styles.card}>
            <Title3 as="h3">{title}</Title3>
            {children}
        </Card>
    );
}
