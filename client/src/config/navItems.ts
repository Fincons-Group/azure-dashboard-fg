import type { FluentIcon } from "@fluentui/react-icons";
import { DocumentTableRegular, DocumentTextRegular } from "@fluentui/react-icons";

export interface NavItemConfig {
    key: string;
    labelKey: string;
    icon: FluentIcon;
    descriptionKey: string;
}

// This branch ships the Sprint Report and the multi-scope Excel Export page
// (see App.tsx/Sidebar.tsx), so the Getting Started guide's nav accordion
// (GettingStartedGuide.tsx) describes those two sections.
export const NAV_ITEMS: NavItemConfig[] = [
    {
        key: "dynamic-sprint-report",
        labelKey: "nav.dynamicSprintReport",
        icon: DocumentTextRegular,
        descriptionKey: "onboardingGuide.navSections.dynamic-sprint-report",
    },
    {
        key: "excel-export",
        labelKey: "nav.excelExport",
        icon: DocumentTableRegular,
        descriptionKey: "onboardingGuide.navSections.excel-export",
    },
];
