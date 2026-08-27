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
} from "../../layoutConstants";

const ACTIVE_ACCENT = "#0EA5A0";

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

// This branch ships only the Sprint Report, so the sidebar has exactly one
// destination - no per-user visibility toggle, no automation group, no
// badge query (that queried defect counts, which have no page to link to
// here).
const SPRINT_REPORT_ITEM: NavItem = {
    key: "dynamic-sprint-report",
    labelKey: "nav.dynamicSprintReport",
    to: "/dynamic-sprint-report",
    icon: DocumentTextRegular,
};

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
                <NavRow item={SPRINT_REPORT_ITEM} collapsed={collapsed} />
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
