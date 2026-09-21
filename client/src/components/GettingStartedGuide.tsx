import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
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
import { NAV_ITEMS, EXPERIMENTAL_NAV_KEYS } from "../config/navItems";

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
    accordionHeaderContent: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
});

// Shown once automatically on first load (see App.tsx) and reachable anytime
// afterward via the Help button in TopBar.tsx. It lists every nav item,
// including ones still behind AppSettings.showExperimentalPages (badged
// "Experimental" below) - new functionality gets explained here the moment
// it ships, whether or not it's toggled on in the sidebar yet. modalType
// "alert" blocks Escape/backdrop dismissal so the first-load run can't be
// skipped without reading; see ONBOARDING_GUIDE_VERSION in App.tsx for how
// this guide is re-forced on everyone after a content update.
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
            modalType="alert"
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
                            <Text block>
                                {t("onboardingGuide.experimentalHint")}
                            </Text>
                            <Accordion collapsible>
                                {NAV_ITEMS.map((item) => (
                                    <AccordionItem
                                        key={item.key}
                                        value={item.key}
                                    >
                                        <AccordionHeader>
                                            <span
                                                className={
                                                    styles.accordionHeaderContent
                                                }
                                            >
                                                {t(item.labelKey)}
                                                {EXPERIMENTAL_NAV_KEYS.has(
                                                    item.key
                                                ) && (
                                                    <Badge
                                                        appearance="tint"
                                                        color="informative"
                                                    >
                                                        {t(
                                                            "onboardingGuide.experimentalBadge"
                                                        )}
                                                    </Badge>
                                                )}
                                            </span>
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
