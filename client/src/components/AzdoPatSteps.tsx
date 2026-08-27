import { makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
    steps: {
        margin: 0,
        paddingLeft: tokens.spacingHorizontalL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
});

// Condensed version of the setup steps in README.en.md / .env.example -
// shared between the first-load guide (GettingStartedGuide.tsx) and the
// "can't reach Azure DevOps" screen (AzdoConnectionError.tsx) so the copy
// is written once.
export function AzdoPatSteps() {
    const { t } = useTranslation();
    const styles = useStyles();

    return (
        <ol className={styles.steps}>
            <li>{t("azdoPatSteps.step1")}</li>
            <li>{t("azdoPatSteps.step2")}</li>
            <li>{t("azdoPatSteps.step3")}</li>
            <li>{t("azdoPatSteps.step4")}</li>
            <li>{t("azdoPatSteps.step5")}</li>
        </ol>
    );
}
