import { useState, type ReactNode } from "react";
import {
    ThemeModeContext,
    THEME_MODE_STORAGE_KEY,
    type ThemeMode,
} from "./themeModeContext";

function getInitialMode(): ThemeMode {
    const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY);

    if (stored === "light" || stored === "dark") {
        return stored;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
    const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

    const setMode = (next: ThemeMode) => {
        localStorage.setItem(THEME_MODE_STORAGE_KEY, next);
        setModeState(next);
    };

    return (
        <ThemeModeContext.Provider value={{ mode, setMode }}>
            {children}
        </ThemeModeContext.Provider>
    );
}
