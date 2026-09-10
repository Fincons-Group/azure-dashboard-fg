import { useTranslation } from "react-i18next";
import { Card, Text, makeStyles, tokens } from "@fluentui/react-components";
import { WrenchRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    placeholderCard: {
        padding: tokens.spacingHorizontalXXL,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: tokens.spacingVerticalS,
    },
    placeholderIcon: {
        fontSize: "32px",
        color: tokens.colorNeutralForeground3,
    },
    placeholderBody: {
        color: tokens.colorNeutralForeground3,
        maxWidth: "480px",
    },
});

export function E2eHistoryPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    return (
        <PageLayout title={t("e2eHistoryPage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>
                {t("e2eHistoryPage.subtitle")}
            </Text>

            <Card className={styles.placeholderCard}>
                <WrenchRegular className={styles.placeholderIcon} />
                <Text weight="semibold">
                    {t("e2eHistoryPage.underConstructionTitle")}
                </Text>
                <Text className={styles.placeholderBody}>
                    {t("e2eHistoryPage.underConstructionBody")}
                </Text>
            </Card>
        </PageLayout>
    );
}
