import { useTranslation } from "react-i18next";
import { Button, Card, Text, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { BoardRegular, OpenRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { CARD_RADIUS } from "../layoutConstants";

// Azure DevOps sends X-Frame-Options: SAMEORIGIN on _dashboards pages (and
// everything else under dev.azure.com), so the browser refuses to render it
// inside our iframe no matter what we pass in the src - there's no query
// param or client-side workaround since it's enforced by that response
// header on Microsoft's own server. Opening it in a new tab is the only
// thing that actually works without standing up a same-origin proxy.
const DASHBOARD_URL =
    "https://dev.azure.com/ItasMutua/Nuova%20Frontiera/_dashboards/dashboard/35eb4b44-32a8-4cbf-8bb1-4dd229f5a9be";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    card: {
        padding: tokens.spacingHorizontalXXL,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: tokens.spacingVerticalM,
        maxWidth: "520px",
        margin: "0 auto",
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
    },
    icon: {
        fontSize: "40px",
        color: tokens.colorBrandForeground1,
    },
    body: {
        color: tokens.colorNeutralForeground3,
        maxWidth: "440px",
    },
});

export function TeamDashboardPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    return (
        <PageLayout title={t("teamDashboardPage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>{t("teamDashboardPage.subtitle")}</Text>

            <Card className={styles.card}>
                <BoardRegular className={styles.icon} />
                <Title2 as="h2">{t("teamDashboardPage.cardTitle")}</Title2>
                <Text className={styles.body}>{t("teamDashboardPage.cardBody")}</Text>
                <Button
                    as="a"
                    href={DASHBOARD_URL}
                    target="_blank"
                    rel="noreferrer"
                    appearance="primary"
                    icon={<OpenRegular />}
                >
                    {t("teamDashboardPage.openButton")}
                </Button>
            </Card>
        </PageLayout>
    );
}
