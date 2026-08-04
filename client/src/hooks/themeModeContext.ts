import { createContext } from "react";

export type ThemeMode = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "theme-mode";

export const ThemeModeContext = createContext<{
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
} | null>(null);
