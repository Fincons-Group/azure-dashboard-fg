import { Text, Title3, makeStyles, tokens } from "@fluentui/react-components";
import { PlayCircleRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { RunCard } from "../types";

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
    passRate: {
        fontWeight: tokens.fontWeightSemibold,
    },
});

export function RunCardItem({ run }: { run: RunCard }) {
    const styles = useStyles();
    const { t, i18n } = useTranslation();

    return (
        <a
            href={run.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.card}
        >
            <Title3 as="h3" className={styles.title}>
                <PlayCircleRegular aria-hidden="true" />
                {run.name}
            </Title3>

            <Text>{t("runCard.state", { state: run.state })}</Text>

            <Text>
                {t("runCard.completed", {
                    date: run.completedDate
                        ? new Date(run.completedDate).toLocaleString(
                              i18n.language
                          )
                        : t("runCard.completedNA"),
                })}
            </Text>

            <Text>{t("runCard.total", { count: run.total })}</Text>

            <Text>
                {t("runCard.summary", {
                    passed: run.counts.Passed,
                    failed: run.counts.Failed,
                    blocked: run.counts.Blocked,
                    notApplicable: run.counts.NotApplicable,
                    notRun: run.counts.NotRun,
                })}
            </Text>

            <Text className={styles.passRate}>
                {t("runCard.passRate", { rate: run.passRate })}
            </Text>
        </a>
    );
}
