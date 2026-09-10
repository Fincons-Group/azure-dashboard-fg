import { useTranslation } from "react-i18next";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Switch,
} from "@fluentui/react-components";
import { useSettings } from "../hooks/useSettings";

// Persisted app-wide (see SettingsProvider.tsx) rather than a per-report
// toggle - unlike SprintDefectReportTab.tsx's showOriginBreakdown, this is
// meant to apply the same way across every report a user builds/sends, so
// it lives here instead of on the report tab itself.
export function SettingsDialog({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const { settings, setSetting } = useSettings();

    return (
        <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{t("settingsDialog.title")}</DialogTitle>
                    <DialogContent>
                        <Field
                            hint={t("settingsDialog.showExtraKpisHint")}
                        >
                            <Switch
                                checked={settings.showExtraKpis}
                                onChange={(_, data) =>
                                    setSetting("showExtraKpis", data.checked)
                                }
                                label={t("settingsDialog.showExtraKpisLabel")}
                            />
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={onClose}>
                            {t("settingsDialog.close")}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
