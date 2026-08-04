import type { ReactNode } from "react";
import { Card, Text, Title3, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    card: {
        padding: tokens.spacingHorizontalM,
        minWidth: "140px",
        flex: "1 1 160px",
    },
    label: {
        color: tokens.colorNeutralForeground3,
    },
});

export function StatCard({
    label,
    value,
    icon,
}: {
    label: string;
    value: ReactNode;
    icon?: ReactNode;
}) {
    const styles = useStyles();

    return (
        <Card className={styles.card}>
            <Text className={styles.label} weight="semibold">
                {label}
            </Text>
            <Title3 style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS }}>
                {icon}
                {value}
            </Title3>
        </Card>
    );
}
