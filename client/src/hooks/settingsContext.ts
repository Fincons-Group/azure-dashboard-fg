import { createContext } from "react";

export const SETTINGS_STORAGE_KEY = "azureDashboardSettings";

export interface AppSettings {
    // Whether the Sprint Report's "KPI aggiuntivi" section (first-execution
    // pass rate, avg fix time, critical/high bug %, test plan correctness,
    // duplicate Not Applicable) shows on-screen in StatusReportCard AND is
    // included in every export of it (emailed HTML, PDF, PPTX) - see
    // SprintDefectReportTab.tsx's emailExtraKpis. A global, persisted
    // setting (unlike showOriginBreakdown, which is per-report local state)
    // because it's meant to apply the same way across every report send,
    // not be re-decided each time.
    showExtraKpis: boolean;
    // Whether the nav pages listed in EXPERIMENTAL_NAV_KEYS
    // (config/navItems.ts) show in the Sidebar and the Getting Started
    // guide - Cycle Time, E2E History, Automation KPIs, Team Dashboard, QA
    // Control Center. Off by default: these ship on main but aren't ready
    // for everyone yet, and this per-browser toggle (not an env var) lets
    // anyone opt in locally to preview them without a separate deploy.
    showExperimentalPages: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
    showExtraKpis: false,
    showExperimentalPages: false,
};

export const SettingsContext = createContext<{
    settings: AppSettings;
    setSetting: <K extends keyof AppSettings>(
        key: K,
        value: AppSettings[K]
    ) => void;
} | null>(null);
