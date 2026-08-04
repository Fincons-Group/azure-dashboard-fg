import { Button, Tooltip, makeStyles } from "@fluentui/react-components";
import { WeatherMoonRegular, WeatherSunnyRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { useThemeMode } from "../hooks/useThemeMode";
import { RAIL_FG_ACTIVE } from "../layoutConstants";

// Only ever rendered on the (always-dark) TopBar rail - see RAIL_BG's doc
// comment in layoutConstants.ts - so it's safe to hardcode light-on-dark
// colors here instead of following the subtle button's light-theme default.
const useStyles = makeStyles({
    button: {
        color: RAIL_FG_ACTIVE,
        ":hover": {
            color: RAIL_FG_ACTIVE,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
        },
    },
});

export function ThemeSwitcher() {
    const { t } = useTranslation();
    const styles = useStyles();
    const { mode, setMode } = useThemeMode();

    const isDark = mode === "dark";
    const label = t(`themeSwitcher.${isDark ? "light" : "dark"}`);

    return (
        <Tooltip content={label} relationship="label">
            <Button
                appearance="subtle"
                className={styles.button}
                icon={isDark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
                aria-label={label}
                onClick={() => setMode(isDark ? "light" : "dark")}
            />
        </Tooltip>
    );
}
