import {
    Menu,
    MenuTrigger,
    MenuPopover,
    MenuList,
    MenuItem,
    Button,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

export type ExportFormat = "pdf" | "csv" | "excel" | "email";

const emailReportEnabled =
    import.meta.env.VITE_ENABLE_EMAIL_REPORT === "true";

export function ExportMenu({
    onExport,
    disabled,
    emailDisabled,
}: {
    onExport: (format: ExportFormat) => void;
    disabled?: boolean;
    emailDisabled?: boolean;
}) {
    const { t } = useTranslation();

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    appearance="secondary"
                    icon={<ArrowDownloadRegular />}
                    disabled={disabled}
                >
                    {t("exportMenu.label")}
                </Button>
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <MenuItem onClick={() => onExport("pdf")}>
                        {t("exportMenu.pdf")}
                    </MenuItem>
                    <MenuItem onClick={() => onExport("csv")}>
                        {t("exportMenu.csv")}
                    </MenuItem>
                    <MenuItem onClick={() => onExport("excel")}>
                        {t("exportMenu.excel")}
                    </MenuItem>
                    {emailReportEnabled && (
                        <MenuItem
                            disabled={emailDisabled}
                            onClick={() => onExport("email")}
                        >
                            {t("exportMenu.email")}
                        </MenuItem>
                    )}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
