import { useMsal } from "@azure/msal-react";
import { Button, Title1, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { loginRequest } from "../authConfig";

const useStyles = makeStyles({
    page: {
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: tokens.spacingVerticalL,
        backgroundColor: tokens.colorNeutralBackground2,
    },
});

export function SignInPage() {
    const styles = useStyles();
    const { instance } = useMsal();
    const { t } = useTranslation();

    return (
        <div className={styles.page}>
            <Title1 as="h1">{t("signInPage.title")}</Title1>
            <Text>{t("signInPage.subtitle")}</Text>
            <Button
                appearance="primary"
                onClick={() => instance.loginRedirect(loginRequest)}
            >
                {t("signInPage.signIn")}
            </Button>
        </div>
    );
}
