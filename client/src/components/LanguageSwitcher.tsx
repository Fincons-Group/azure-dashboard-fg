import {
    Menu,
    MenuTrigger,
    MenuPopover,
    MenuList,
    MenuItemRadio,
    Button,
    Tooltip,
    makeStyles,
    type MenuCheckedValueChangeData,
} from "@fluentui/react-components";
import { GlobeRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { RAIL_FG_ACTIVE } from "../layoutConstants";

const languages: { code: string; labelKey: "english" | "italian" }[] = [
    { code: "en", labelKey: "english" },
    { code: "it", labelKey: "italian" },
];

// Only ever rendered on the (always-dark) TopBar rail - see RAIL_BG's doc
// comment in layoutConstants.ts - so it's safe to hardcode light-on-dark
// colors for the trigger button here instead of following the subtle
// button's light-theme default. The MenuPopover itself is left alone: it
// portals to the document root and correctly follows the app's chosen
// light/dark content theme instead.
const useStyles = makeStyles({
    button: {
        color: RAIL_FG_ACTIVE,
        ":hover": {
            color: RAIL_FG_ACTIVE,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
        },
    },
});

export function LanguageSwitcher() {
    const { t, i18n } = useTranslation();
    const styles = useStyles();

    const currentCode = i18n.language.startsWith("it") ? "it" : "en";

    const handleCheckedValueChange = (
        _: unknown,
        data: MenuCheckedValueChangeData
    ) => {
        const next = data.checkedItems[0];

        if (next) {
            i18n.changeLanguage(next);
        }
    };

    return (
        <Menu
            checkedValues={{ language: [currentCode] }}
            onCheckedValueChange={handleCheckedValueChange}
        >
            <MenuTrigger disableButtonEnhancement>
                <Tooltip content={t("languageSwitcher.label")} relationship="label">
                    <Button
                        appearance="subtle"
                        className={styles.button}
                        icon={<GlobeRegular />}
                        aria-label={t("languageSwitcher.label")}
                    >
                        {currentCode.toUpperCase()}
                    </Button>
                </Tooltip>
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    {languages.map((lang) => (
                        <MenuItemRadio key={lang.code} name="language" value={lang.code}>
                            {t(`languageSwitcher.${lang.labelKey}`)}
                        </MenuItemRadio>
                    ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
