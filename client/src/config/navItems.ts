import type { FluentIcon } from "@fluentui/react-icons";
import {
    DocumentTableRegular,
    DocumentTextRegular,
    TableRegular,
    ArrowTrendingRegular,
    FlashAutoRegular,
    BeakerRegular,
    AppsListRegular,
    BugRegular,
} from "@fluentui/react-icons";

export interface NavItemConfig {
    key: string;
    labelKey: string;
    icon: FluentIcon;
    descriptionKey: string;
}

// This branch ships the Sprint Report, the multi-scope Excel Export page,
// the Test Factory Coverage Roadmap, its Cycle Time report, its Automation
// KPIs, E2E History, the Test Suites hub, and the Bugs page (see
// App.tsx/Sidebar.tsx), so the Getting Started guide's nav accordion
// (GettingStartedGuide.tsx) describes each of those sections.
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
    {
        key: "coverage-roadmap",
        labelKey: "nav.coverageRoadmap",
        icon: TableRegular,
        descriptionKey: "onboardingGuide.navSections.coverage-roadmap",
    },
    {
        key: "cycle-time",
        labelKey: "nav.cycleTime",
        icon: ArrowTrendingRegular,
        descriptionKey: "onboardingGuide.navSections.cycle-time",
    },
    {
        key: "automation-kpis",
        labelKey: "nav.automationKpis",
        icon: FlashAutoRegular,
        descriptionKey: "onboardingGuide.navSections.automation-kpis",
    },
    {
        key: "e2e-history",
        labelKey: "nav.e2eHistory",
        icon: BeakerRegular,
        descriptionKey: "onboardingGuide.navSections.e2e-history",
    },
    {
        key: "test-suites",
        labelKey: "nav.testSuites",
        icon: AppsListRegular,
        descriptionKey: "onboardingGuide.navSections.test-suites",
    },
    {
        key: "bugs",
        labelKey: "nav.bugs",
        icon: BugRegular,
        descriptionKey: "onboardingGuide.navSections.bugs",
    },
];
