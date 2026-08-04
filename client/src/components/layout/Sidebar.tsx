import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useIsRestrictedOwner } from "../../hooks/useIsRestrictedOwner";
import {
    Button,
    Text,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import {
    FolderRegular,
    GridRegular,
    HistoryRegular,
    ClipboardTaskListLtrRegular,
    DocumentBulletListRegular,
    ArrowTrendingRegular,
    RocketRegular,
    GaugeRegular,
    ErrorCircleRegular,
    PlayRegular,
    BugRegular,
    DocumentTextRegular,
    PersonRegular,
    DeleteRegular,
    FlagRegular,
    ChevronLeftRegular,
    ChevronRightRegular,
    ChevronDownRegular,
    type FluentIcon,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { fetchNavBadges } from "../../api/client";
import {
    SIDEBAR_WIDTH,
    SIDEBAR_COLLAPSED_WIDTH,
    RAIL_BG,
    RAIL_FG,
    RAIL_FG_ACTIVE,
} from "../../layoutConstants";

const ACTIVE_ACCENT = "#0EA5A0";
const BADGE_COLOR = "#E5484D";

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
        borderRadius: tokens.borderRadiusMedium,
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
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingHorizontalS,
        flexGrow: 1,
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
        backgroundColor: "rgba(14, 165, 160, 0.12)",
    },
    navIndicator: {
        position: "absolute",
        left: 0,
        top: "4px",
        bottom: "4px",
        width: "3px",
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: "transparent",
    },
    navIndicatorActive: {
        backgroundColor: ACTIVE_ACCENT,
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
    groupChildren: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
        paddingLeft: tokens.spacingHorizontalXL,
    },
    groupChevron: {
        display: "flex",
        alignItems: "center",
        transitionProperty: "transform",
        transitionDuration: tokens.durationFast,
    },
    groupChevronOpen: {
        transform: "rotate(0deg)",
    },
    groupChevronClosed: {
        transform: "rotate(-90deg)",
    },
    badge: {
        flexShrink: 0,
        minWidth: "18px",
        height: "18px",
        borderRadius: "9px",
        backgroundColor: BADGE_COLOR,
        color: "#ffffff",
        fontSize: "11px",
        fontWeight: tokens.fontWeightSemibold,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 5px",
        boxSizing: "border-box",
    },
    badgeDot: {
        flexShrink: 0,
        width: "8px",
        height: "8px",
        borderRadius: "4px",
        backgroundColor: BADGE_COLOR,
        position: "absolute",
        top: "6px",
        right: "6px",
    },
    footer: {
        padding: tokens.spacingHorizontalS,
        flexShrink: 0,
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

const MAIN_ITEMS: NavItem[] = [
    { key: "suites", labelKey: "nav.suites", to: "/", end: true, icon: FolderRegular },
    { key: "dashboard", labelKey: "nav.dashboard", to: "/dashboard", icon: GridRegular },
    { key: "runs", labelKey: "nav.runs", to: "/last-10-runs", icon: HistoryRegular },
    { key: "plans", labelKey: "nav.plans", to: "/plans", icon: ClipboardTaskListLtrRegular },
    { key: "plan-overview", labelKey: "nav.planOverview", to: "/plan-overview", icon: DocumentBulletListRegular },
    { key: "plan-progress", labelKey: "nav.planProgress", to: "/plan-progress", icon: ArrowTrendingRegular },
    { key: "execution", labelKey: "nav.execution", to: "/test-execution", icon: PlayRegular },
    { key: "defects", labelKey: "nav.defects", to: "/defects", icon: BugRegular },
    { key: "sprint-report", labelKey: "nav.sprintReport", to: "/sprint-report", icon: DocumentTextRegular },
    { key: "plurifond-sprint-report", labelKey: "nav.plurifondSprintReport", to: "/plurifond-sprint-report", icon: DocumentTextRegular },
    { key: "my-work-items", labelKey: "nav.myWorkItems", to: "/my-work-items", icon: PersonRegular },
    { key: "remove-test-cases", labelKey: "nav.removeTestCases", to: "/remove-test-cases", icon: DeleteRegular },
];

const AUTOMATION_ITEMS: NavItem[] = [
    { key: "automation-dashboard", labelKey: "nav.automationDashboard", to: "/automation-dashboard", icon: GaugeRegular },
    { key: "common-errors", labelKey: "nav.commonErrors", to: "/common-errors", icon: ErrorCircleRegular },
];

const AUTOMATION_PATHS = AUTOMATION_ITEMS.map((item) => item.to);

const RESTRICTED_ITEM_KEYS = new Set(["plan-progress", "remove-test-cases"]);

const releaseReadinessEnabled =
    import.meta.env.VITE_ENABLE_RELEASE_READINESS === "true";
// Mirrors the route restriction in App.tsx - when set, only the nav items for
// pages that actually still have a route are shown.
const showOnlyDefectAndRelease =
    import.meta.env.VITE_SHOW_ONLY_DEFECT_AND_RELEASE === "true";

function NavRow({
    item,
    collapsed,
    badgeCount,
}: {
    item: NavItem;
    collapsed: boolean;
    badgeCount?: number;
}) {
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
                    {!collapsed && !!badgeCount && (
                        <span className={styles.badge}>{badgeCount}</span>
                    )}
                    {collapsed && !!badgeCount && (
                        <span className={styles.badgeDot} />
                    )}
                </>
            )}
        </NavLink>
    );

    if (!collapsed) {
        return row;
    }

    return (
        <Tooltip
            content={
                badgeCount
                    ? `${label} (${badgeCount})`
                    : label
            }
            relationship="label"
            positioning="after"
        >
            {row}
        </Tooltip>
    );
}

// A native <button> rather than Fluent's <Button> - Button brings its own
// root padding/min-height/line-height that fought .navItem's sizing and
// made this row render smaller/misaligned next to the NavLink-based rows
// above it, since .navItem is a full CSS reset built to stand on its own.
function AutomationToggle({
    collapsed,
    active,
    open,
    onToggle,
}: {
    collapsed: boolean;
    active: boolean;
    open: boolean;
    onToggle: () => void;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const label = t("nav.automation");

    const row = (
        <button
            type="button"
            className={mergeClasses(styles.navItem, active && styles.navItemActive)}
            onClick={onToggle}
            aria-expanded={open}
        >
            <span
                className={mergeClasses(
                    styles.navIndicator,
                    active && styles.navIndicatorActive
                )}
            />
            <span className={styles.navIcon}>
                <RocketRegular />
            </span>
            {!collapsed && (
                <>
                    <span className={styles.navLabel}>{label}</span>
                    <span
                        className={mergeClasses(
                            styles.groupChevron,
                            open ? styles.groupChevronOpen : styles.groupChevronClosed
                        )}
                    >
                        <ChevronDownRegular />
                    </span>
                </>
            )}
        </button>
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
    const location = useLocation();
    const isRestrictedOwner = useIsRestrictedOwner();
    const visibleMainItems = MAIN_ITEMS.filter(
        (item) => isRestrictedOwner || !RESTRICTED_ITEM_KEYS.has(item.key)
    );
    const [automationOpen, setAutomationOpen] = useState(
        AUTOMATION_PATHS.includes(location.pathname)
    );

    const { data: badges } = useQuery({
        queryKey: ["nav-badges"],
        queryFn: fetchNavBadges,
        staleTime: 5 * 60 * 1000,
    });

    const defectBadgeCount = badges?.openCriticalHighDefects ?? 0;

    return (
        <nav
            className={mergeClasses(
                styles.sidebar,
                collapsed ? styles.collapsed : styles.expanded
            )}
            aria-label={t("nav.primary")}
        >
            <NavLink to="/" className={styles.brand} aria-label={t("nav.home")}>
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
                {showOnlyDefectAndRelease ? (
                    <>
                        <NavRow
                            item={MAIN_ITEMS.find((item) => item.key === "defects")!}
                            collapsed={collapsed}
                            badgeCount={defectBadgeCount}
                        />
                        <NavRow
                            item={
                                MAIN_ITEMS.find(
                                    (item) => item.key === "sprint-report"
                                )!
                            }
                            collapsed={collapsed}
                        />
                        <NavRow
                            item={
                                MAIN_ITEMS.find(
                                    (item) => item.key === "plurifond-sprint-report"
                                )!
                            }
                            collapsed={collapsed}
                        />
                    </>
                ) : (
                    <>
                        {visibleMainItems.map((item) => (
                            <NavRow
                                key={item.key}
                                item={item}
                                collapsed={collapsed}
                                badgeCount={
                                    item.key === "defects"
                                        ? defectBadgeCount
                                        : undefined
                                }
                            />
                        ))}

                        <AutomationToggle
                            collapsed={collapsed}
                            active={AUTOMATION_PATHS.includes(location.pathname)}
                            open={automationOpen}
                            onToggle={() => setAutomationOpen((open) => !open)}
                        />

                        {!collapsed && automationOpen && (
                            <div className={styles.groupChildren}>
                                {AUTOMATION_ITEMS.map((item) => (
                                    <NavRow
                                        key={item.key}
                                        item={item}
                                        collapsed={collapsed}
                                    />
                                ))}
                            </div>
                        )}

                        {collapsed &&
                            AUTOMATION_ITEMS.map((item) => (
                                <NavRow
                                    key={item.key}
                                    item={item}
                                    collapsed={collapsed}
                                />
                            ))}
                    </>
                )}

                {releaseReadinessEnabled && (
                    <NavRow
                        item={{
                            key: "release-readiness",
                            labelKey: "nav.releaseReadiness",
                            to: "/release-readiness",
                            icon: FlagRegular,
                        }}
                        collapsed={collapsed}
                    />
                )}
            </div>

            <div className={styles.footer}>
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
