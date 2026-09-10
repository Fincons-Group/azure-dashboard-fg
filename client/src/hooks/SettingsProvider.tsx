import { useState, type ReactNode } from "react";
import {
    SettingsContext,
    SETTINGS_STORAGE_KEY,
    DEFAULT_SETTINGS,
    type AppSettings,
} from "./settingsContext";

function getInitialSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);

        if (!raw) {
            return DEFAULT_SETTINGS;
        }

        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AppSettings>(getInitialSettings);

    const setSetting = <K extends keyof AppSettings>(
        key: K,
        value: AppSettings[K]
    ) => {
        setSettings((prev) => {
            const next = { ...prev, [key]: value };

            try {
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // localStorage unavailable - the setting just won't persist.
            }

            return next;
        });
    };

    return (
        <SettingsContext.Provider value={{ settings, setSetting }}>
            {children}
        </SettingsContext.Provider>
    );
}
