import { makeStyles, mergeClasses } from "@fluentui/react-components";
import { WeatherMoonRegular, WeatherSunnyRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { useThemeMode } from "../hooks/useThemeMode";
import { PILL_RADIUS, RAIL_ACCENT, RAIL_FG, RAIL_FG_ACTIVE } from "../layoutConstants";

// Only ever rendered on the (always-dark) TopBar rail - see RAIL_BG's doc
// comment in layoutConstants.ts - so it's safe to hardcode light-on-dark
// colors here instead of following the subtle button's light-theme default.
const useStyles = makeStyles({
    pill: {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "3px",
        borderRadius: PILL_RADIUS,
        backgroundColor: "rgba(255, 255, 255, 0.08)",
    },
    button: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "24px",
        height: "24px",
        padding: 0,
        border: "none",
        borderRadius: "50%",
        cursor: "pointer",
        backgroundColor: "transparent",
        color: RAIL_FG,
        fontSize: "13px",
    },
    buttonActive: {
        backgroundColor: RAIL_ACCENT,
        color: RAIL_FG_ACTIVE,
    },
});

export function ThemeSwitcher() {
    const { t } = useTranslation();
    const styles = useStyles();
    const { mode, setMode } = useThemeMode();

    return (
        <div className={styles.pill} role="group" aria-label={t("themeSwitcher.groupLabel")}>
            <button
                type="button"
                className={mergeClasses(styles.button, mode === "light" && styles.buttonActive)}
                aria-pressed={mode === "light"}
                aria-label={t("themeSwitcher.light")}
                onClick={() => setMode("light")}
            >
                <WeatherSunnyRegular fontSize={13} />
            </button>
            <button
                type="button"
                className={mergeClasses(styles.button, mode === "dark" && styles.buttonActive)}
                aria-pressed={mode === "dark"}
                aria-label={t("themeSwitcher.dark")}
                onClick={() => setMode("dark")}
            >
                <WeatherMoonRegular fontSize={13} />
            </button>
        </div>
    );
}
