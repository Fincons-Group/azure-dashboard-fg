import type { FluentIcon } from "@fluentui/react-icons";
import { DocumentTextRegular } from "@fluentui/react-icons";

export interface NavItemConfig {
    key: string;
    labelKey: string;
    icon: FluentIcon;
    descriptionKey: string;
}

// This branch only ships the Sprint Report (see App.tsx/Sidebar.tsx), so the
// Getting Started guide's nav accordion (GettingStartedGuide.tsx) has just
// the one section to describe.
export const NAV_ITEMS: NavItemConfig[] = [
    {
        key: "dynamic-sprint-report",
        labelKey: "nav.dynamicSprintReport",
        icon: DocumentTextRegular,
        descriptionKey: "onboardingGuide.navSections.dynamic-sprint-report",
    },
];
