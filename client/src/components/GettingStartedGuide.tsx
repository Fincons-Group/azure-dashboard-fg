import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Text,
    Title3,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { AzdoPatSteps } from "./AzdoPatSteps";
import { NAV_ITEMS } from "../config/navItems";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
});

// Shown once automatically on first load (see App.tsx) and reachable anytime
// afterward via the Help button in TopBar.tsx - a first-load-only dialog is
// easy to dismiss without reading, so it stays available on demand too.
export function GettingStartedGuide({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const styles = useStyles();

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onClose();
                }
            }}
        >
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{t("onboardingGuide.title")}</DialogTitle>
                    <DialogContent className={styles.content}>
                        <Text block>{t("onboardingGuide.intro")}</Text>

                        <div className={styles.section}>
                            <Title3 as="h3">
                                {t("onboardingGuide.emailSection.title")}
                            </Title3>
                            <Text block>
                                {t(
                                    "onboardingGuide.emailSection.statusReport"
                                )}
                            </Text>
                        </div>

                        <div className={styles.section}>
                            <Title3 as="h3">
                                {t("onboardingGuide.azdoSection.title")}
                            </Title3>
                            <Text block>
                                {t("onboardingGuide.azdoSection.intro")}
                            </Text>
                            <AzdoPatSteps />
                        </div>

                        <div className={styles.section}>
                            <Title3 as="h3">
                                {t("onboardingGuide.navSectionTitle")}
                            </Title3>
                            <Accordion collapsible>
                                {NAV_ITEMS.map((item) => (
                                    <AccordionItem
                                        key={item.key}
                                        value={item.key}
                                    >
                                        <AccordionHeader>
                                            {t(item.labelKey)}
                                        </AccordionHeader>
                                        <AccordionPanel>
                                            <Text block>
                                                {t(item.descriptionKey)}
                                            </Text>
                                        </AccordionPanel>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={onClose}>
                            {t("onboardingGuide.gotIt")}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
