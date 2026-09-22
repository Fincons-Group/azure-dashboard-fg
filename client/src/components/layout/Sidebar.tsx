import { NavLink } from "react-router-dom";
import {
    Button,
    Text,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import {
    DocumentTextRegular,
    DocumentTableRegular,
    TableRegular,
    ArrowTrendingRegular,
    FlashAutoRegular,
    BeakerRegular,
    AppsListRegular,
    ClipboardTaskListLtrRegular,
    BoardRegular,
    GaugeRegular,
    BugRegular,
    PulseRegular,
    ChevronLeftRegular,
    ChevronRightRegular,
    type FluentIcon,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import {
    SIDEBAR_WIDTH,
    SIDEBAR_COLLAPSED_WIDTH,
    RAIL_BG,
    RAIL_FG,
    RAIL_FG_ACTIVE,
    RAIL_ACCENT,
} from "../../layoutConstants";
import { EXPERIMENTAL_NAV_KEYS } from "../../config/navItems";
import { useSettings } from "../../hooks/useSettings";

const useStyles = makeStyles({
    sidebar: {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        backgroundColor: RAIL_BG,
        overflowY: "auto",
        overflowX: "hidden",
        transitionProperty: "width",
        transitionDuration: tokens.durationSlow,
        transitionTimingFunction: tokens.curveEasyEase,
    },
    expanded: {
        width: SIDEBAR_WIDTH,
    },
    collapsed: {
        width: SIDEBAR_COLLAPSED_WIDTH,
    },
    brand: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        padding: tokens.spacingVerticalM,
        flexShrink: 0,
    },
    logoBadge: {
        backgroundColor: "#ffffff",
        borderRadius: "10px",
        boxShadow: tokens.shadow4,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        overflow: "hidden",
        boxSizing: "border-box",
    },
    // Collapsed rail has no room for the full "TEST FACTORY" wordmark logo -
    // pin the badge to a square matching the icon-only logo-mark.svg instead
    // of letting the full-width logo get clipped mid-wordmark.
    logoBadgeCollapsed: {
        width: "32px",
        height: "32px",
        padding: "4px",
        justifyContent: "center",
    },
    logo: {
        height: "24px",
        width: "auto",
        display: "block",
    },
    logoCollapsed: {
        height: "100%",
        width: "100%",
    },
    nav: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalS,
        flexGrow: 1,
        overflowY: "auto",
        // Default browser scrollbars are light-on-white by design and look
        // broken sitting directly on the dark rail - a slim, semi-transparent
        // thumb with no visible track reads as intentional instead.
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(255, 255, 255, 0.18) transparent",
        "::-webkit-scrollbar": {
            width: "6px",
        },
        "::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
        },
        "::-webkit-scrollbar-thumb": {
            backgroundColor: "rgba(255, 255, 255, 0.18)",
            borderRadius: tokens.borderRadiusCircular,
        },
    },
    navGroup: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
    navGroupLabel: {
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        color: RAIL_FG,
        opacity: 0.6,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        padding: `0 ${tokens.spacingHorizontalS}`,
        marginBottom: "2px",
    },
    navItem: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusMedium,
        color: RAIL_FG,
        textDecorationLine: "none",
        fontSize: tokens.fontSizeBase300,
        cursor: "pointer",
        border: "none",
        backgroundColor: "transparent",
        width: "100%",
        textAlign: "left",
        boxSizing: "border-box",
        ":hover": {
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            color: RAIL_FG_ACTIVE,
        },
    },
    navItemActive: {
        color: RAIL_FG_ACTIVE,
        backgroundColor: "rgba(14, 165, 160, 0.14)",
    },
    navIndicator: {
        position: "absolute",
        left: "-2px",
        top: "50%",
        transform: "translateY(-50%)",
        width: "5px",
        height: "5px",
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: "transparent",
    },
    navIndicatorActive: {
        backgroundColor: RAIL_ACCENT,
    },
    navIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: "20px",
    },
    navLabel: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexGrow: 1,
    },
    footer: {
        padding: tokens.spacingHorizontalS,
        flexShrink: 0,
    },
    version: {
        display: "block",
        textAlign: "center",
        color: RAIL_FG,
        opacity: 0.6,
        fontSize: tokens.fontSizeBase100,
        whiteSpace: "nowrap",
        paddingBottom: tokens.spacingVerticalXS,
    },
    collapseButton: {
        color: RAIL_FG,
        width: "100%",
        justifyContent: "center",
        ":hover": {
            color: RAIL_FG_ACTIVE,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
        },
    },
});

type NavItem = {
    key: string;
    labelKey: string;
    to: string;
    end?: boolean;
    icon: FluentIcon;
};

type NavGroup = {
    key: string;
    labelKey: string;
    items: NavItem[];
};

// This branch ships the Sprint Report, the multi-scope Excel Export page,
// the Test Factory Coverage Roadmap, its Cycle Time report, its real
// test-case Automation KPIs, E2E History, the NRT/A11Y/Security Test Suites
// hub, and the Bugs page. Items in EXPERIMENTAL_NAV_KEYS (config/navItems.ts)
// are filtered out below unless AppSettings.showExperimentalPages is on.
const NAV_GROUPS: NavGroup[] = [
    {
        key: "overview",
        labelKey: "nav.group.overview",
        items: [
            {
                key: "qa-control-center",
                labelKey: "nav.qaControlCenter",
                to: "/qa-control-center",
                icon: GaugeRegular,
            },
            {
                key: "quality-pulse",
                labelKey: "nav.qualityPulse",
                to: "/quality-pulse",
                icon: PulseRegular,
            },
        ],
    },
    {
        key: "reports",
        labelKey: "nav.group.reports",
        items: [
            {
                key: "dynamic-sprint-report",
                labelKey: "nav.dynamicSprintReport",
                to: "/dynamic-sprint-report",
                icon: DocumentTextRegular,
            },
            {
                key: "excel-export",
                labelKey: "nav.excelExport",
                to: "/excel-export",
                icon: DocumentTableRegular,
            },
            {
                key: "coverage-roadmap",
                labelKey: "nav.coverageRoadmap",
                to: "/coverage-roadmap",
                icon: TableRegular,
            },
            {
                key: "cycle-time",
                labelKey: "nav.cycleTime",
                to: "/cycle-time",
                icon: ArrowTrendingRegular,
            },
            {
                key: "automation-kpis",
                labelKey: "nav.automationKpis",
                to: "/automation-kpis",
                icon: FlashAutoRegular,
            },
            {
                key: "e2e-history",
                labelKey: "nav.e2eHistory",
                to: "/e2e-history",
                icon: BeakerRegular,
            },
        ],
    },
    {
        key: "quality",
        labelKey: "nav.group.quality",
        items: [
            {
                key: "test-suites",
                labelKey: "nav.testSuites",
                to: "/test-suites",
                icon: AppsListRegular,
            },
            {
                key: "bugs",
                labelKey: "nav.bugs",
                to: "/bugs",
                icon: BugRegular,
            },
        ],
    },
    {
        key: "team",
        labelKey: "nav.group.team",
        items: [
            {
                key: "test-plans",
                labelKey: "nav.testPlans",
                to: "/test-plans",
                icon: ClipboardTaskListLtrRegular,
            },
            {
                key: "team-dashboard",
                labelKey: "nav.teamDashboard",
                to: "/team-dashboard",
                icon: BoardRegular,
            },
        ],
    },
];

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const Icon = item.icon;
    const label = t(item.labelKey);

    const row = (
        <NavLink
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
                mergeClasses(styles.navItem, isActive && styles.navItemActive)
            }
        >
            {({ isActive }) => (
                <>
                    <span
                        className={mergeClasses(
                            styles.navIndicator,
                            isActive && styles.navIndicatorActive
                        )}
                    />
                    <span className={styles.navIcon}>
                        <Icon />
                    </span>
                    {!collapsed && (
                        <span className={styles.navLabel}>{label}</span>
                    )}
                </>
            )}
        </NavLink>
    );

    if (!collapsed) {
        return row;
    }

    return (
        <Tooltip content={label} relationship="label" positioning="after">
            {row}
        </Tooltip>
    );
}

export function Sidebar({
    collapsed,
    onToggleCollapse,
}: {
    collapsed: boolean;
    onToggleCollapse: () => void;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const { settings } = useSettings();
    const visibleNavGroups = NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
            (item) => settings.showExperimentalPages || !EXPERIMENTAL_NAV_KEYS.has(item.key)
        ),
    })).filter((group) => group.items.length > 0);

    return (
        <nav
            className={mergeClasses(
                styles.sidebar,
                collapsed ? styles.collapsed : styles.expanded
            )}
            aria-label={t("nav.primary")}
        >
            <NavLink
                to="/dynamic-sprint-report"
                className={styles.brand}
                aria-label={t("nav.home")}
            >
                <span
                    className={mergeClasses(
                        styles.logoBadge,
                        collapsed && styles.logoBadgeCollapsed
                    )}
                >
                    <img
                        src={`${import.meta.env.BASE_URL}${collapsed ? "logo-mark.svg" : "logo.svg"}`}
                        alt={t("nav.home")}
                        className={mergeClasses(
                            styles.logo,
                            collapsed && styles.logoCollapsed
                        )}
                    />
                </span>
                {!collapsed && (
                    <Text weight="semibold" style={{ color: RAIL_FG_ACTIVE }}>
                        {t("common.title")}
                    </Text>
                )}
            </NavLink>

            <div className={styles.nav}>
                {visibleNavGroups.map((group) => (
                    <div key={group.key} className={styles.navGroup}>
                        {!collapsed && (
                            <span className={styles.navGroupLabel}>{t(group.labelKey)}</span>
                        )}
                        {group.items.map((item) => (
                            <NavRow key={item.key} item={item} collapsed={collapsed} />
                        ))}
                    </div>
                ))}
            </div>

            <div className={styles.footer}>
                <Text as="span" className={styles.version}>
                    {t("common.version", { version: __APP_VERSION__ })}
                </Text>
                <Tooltip
                    content={t(
                        collapsed ? "nav.expandSidebar" : "nav.collapseSidebar"
                    )}
                    relationship="label"
                    positioning="after"
                >
                    <Button
                        appearance="transparent"
                        className={styles.collapseButton}
                        icon={
                            collapsed ? (
                                <ChevronRightRegular />
                            ) : (
                                <ChevronLeftRegular />
                            )
                        }
                        aria-label={t(
                            collapsed ? "nav.expandSidebar" : "nav.collapseSidebar"
                        )}
                        onClick={onToggleCollapse}
                    />
                </Tooltip>
            </div>
        </nav>
    );
}
