import {
    Button,
    Card,
    Text,
    Title2,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ArrowSyncRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { AzdoPatSteps } from "./AzdoPatSteps";

const useStyles = makeStyles({
    wrapper: {
        display: "flex",
        justifyContent: "center",
        padding: "48px 24px",
    },
    card: {
        maxWidth: "560px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalL,
    },
    heading: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    icon: {
        fontSize: "24px",
        color: tokens.colorPaletteRedForeground1,
    },
});

// Rendered in place of the whole app when the initial Azure DevOps probe fails
// (see App.tsx). In local CLI mode that usually means the saved PAT/org is
// missing or invalid; in legacy server mode it can still be the server's env.
export function AzdoConnectionError({
    onRetry,
    onChangeConnection,
}: {
    onRetry: () => void;
    onChangeConnection: () => void;
}) {
    const { t } = useTranslation();
    const styles = useStyles();

    return (
        <div className={styles.wrapper}>
            <Card className={styles.card}>
                <div className={styles.heading}>
                    <ErrorCircleRegular className={styles.icon} />
                    <Title2 as="h1">{t("azdoConnectionError.title")}</Title2>
                </div>

                <Text block>{t("azdoConnectionError.message")}</Text>

                <AzdoPatSteps />

                <div style={{ display: "flex", gap: tokens.spacingHorizontalS }}>
                    <Button
                        appearance="primary"
                        icon={<ArrowSyncRegular />}
                        onClick={onRetry}
                    >
                        {t("azdoConnectionError.retry")}
                    </Button>
                    <Button appearance="secondary" onClick={onChangeConnection}>
                        {t("azdoConnectionError.changePat")}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
