import { Link } from "react-router-dom";
import { Text, Title3, makeStyles, tokens } from "@fluentui/react-components";
import { FolderRegular, BugRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { SuiteStat } from "../types";

const useStyles = makeStyles({
    card: {
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        textDecorationLine: "none",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        ":hover": {
            boxShadow: tokens.shadow8,
        },
    },
    title: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
    },
    row: {
        display: "flex",
        gap: tokens.spacingHorizontalS,
        flexWrap: "wrap",
    },
    bugs: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        color: tokens.colorPaletteRedForeground1,
    },
    passRate: {
        fontWeight: tokens.fontWeightSemibold,
    },
});

export function SuiteCard({
    suiteName,
    stat,
}: {
    suiteName: string;
    stat: SuiteStat;
}) {
    const styles = useStyles();
    const { t } = useTranslation();

    const passRate = stat.total
        ? Math.round((stat.passed / stat.total) * 1000) / 10
        : 0;

    return (
        <Link
            to={`/dashboard?suite=${encodeURIComponent(suiteName)}`}
            className={styles.card}
        >
            <Title3 as="h3" className={styles.title}>
                <FolderRegular aria-hidden="true" />
                {suiteName}
            </Title3>

            <Text>{t("suiteCard.total", { count: stat.total })}</Text>

            <Text className={styles.row}>
                {t("suiteCard.summary", {
                    passed: stat.passed,
                    failed: stat.failed,
                    blocked: stat.blocked,
                    notApplicable: stat.notApplicable,
                    notRun: stat.notRun,
                })}
            </Text>

            <Text className={styles.bugs}>
                <BugRegular aria-hidden="true" />
                {t("suiteCard.openBugs", { count: stat.openBugs })}
            </Text>

            <Text className={styles.passRate}>
                {t("suiteCard.passRate", { rate: passRate })}
            </Text>
        </Link>
    );
}
