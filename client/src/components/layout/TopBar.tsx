import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Text,
    Title1,
    Spinner,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import {
    ArrowSyncRegular,
    QuestionCircleRegular,
    SettingsRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { NAV_HEIGHT, RAIL_BG, RAIL_FG, RAIL_FG_ACTIVE } from "../../layoutConstants";
import { postRefresh } from "../../api/client";
import { clearStoredAzdoConnection } from "../../azdoConnection";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { TestGraphMailButton } from "../TestGraphMailButton";
import { GettingStartedGuide } from "../GettingStartedGuide";
import { SettingsDialog } from "../SettingsDialog";

// Colors are hardcoded (not theme tokens) to match the Sidebar rail, which
// is also always dark regardless of the light/dark content theme - see
// RAIL_BG's doc comment in layoutConstants.ts. Fluent's token-driven
// components (Button, Title1, Text) default to the outer theme's colors, so
// they need explicit overrides here rather than a nested FluentProvider -
// that was tried first but broke Tooltip/Menu popovers, which portal
// outside this subtree and don't inherit a nested theme's CSS variables.
const useStyles = makeStyles({
    bar: {
        position: "sticky",
        top: 0,
        zIndex: 10,
        minHeight: NAV_HEIGHT,
        boxSizing: "border-box",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "rgba(255, 255, 255, 0.08)",
        backgroundColor: RAIL_BG,
        color: RAIL_FG_ACTIVE,
    },
    titleGroup: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },
    title: {
        margin: 0,
        color: RAIL_FG_ACTIVE,
    },
    liveDot: {
        width: "7px",
        height: "7px",
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: "#3DD68C",
        boxShadow: "0 0 0 3px rgba(61, 214, 140, 0.2)",
        flexShrink: 0,
    },
    syncedLabel: {
        fontSize: tokens.fontSizeBase200,
        color: RAIL_FG,
        whiteSpace: "nowrap",
    },
    controls: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        flexWrap: "wrap",
    },
    error: {
        color: "#ff9b93",
    },
    welcome: {
        color: RAIL_FG,
    },
    refreshButton: {
        color: RAIL_FG_ACTIVE,
        borderRadius: "9px",
        ":hover": {
            color: RAIL_FG_ACTIVE,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
        },
    },
});

// Below one minute we show "just now" rather than "0m ago", which reads oddly.
function minutesAgo(fromMs: number, nowMs: number): number {
    return Math.max(0, Math.floor((nowMs - fromMs) / 60000));
}

export function TopBar({ title }: { title: string }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [helpOpen, setHelpOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const refreshMutation = useMutation({
        mutationFn: postRefresh,
        onSuccess: (result) => {
            // Only the server clearing its caches means there's anything new
            // to show - a throttled ("already up to date") response leaves
            // every page's data exactly as it was, so refetching would just
            // replay the same server-cached values for nothing.
            if (result.refreshed) {
                void queryClient.invalidateQueries();
            }
        },
    });

    // Ticks once a minute purely to keep the "synced Xm ago" label fresh -
    // the timestamp itself comes straight from the mutation, no extra state.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(id);
    }, []);

    const syncedMinutesAgo =
        refreshMutation.isSuccess && refreshMutation.submittedAt
            ? minutesAgo(refreshMutation.submittedAt, now)
            : null;

    return (
        <div className={styles.bar}>
            <div className={styles.titleGroup}>
                <Title1 as="h1" className={styles.title}>
                    {title}
                </Title1>
                {syncedMinutesAgo != null && (
                    <>
                        <span className={styles.liveDot} aria-hidden="true" />
                        <Text as="span" className={styles.syncedLabel}>
                            {syncedMinutesAgo === 0
                                ? t("nav.syncedJustNow")
                                : t("nav.syncedAgo", { minutes: syncedMinutesAgo })}
                        </Text>
                    </>
                )}
            </div>

            <div className={styles.controls}>
                {refreshMutation.isError && (
                    <Text className={styles.error} role="alert">
                        {t("nav.refreshFailed", {
                            message: refreshMutation.error.message,
                        })}
                    </Text>
                )}

                {refreshMutation.isSuccess &&
                    !refreshMutation.data.refreshed && (
                        <Text className={styles.welcome}>
                            {t("nav.refreshUpToDate", {
                                minutes: Math.ceil(
                                    (refreshMutation.data.retryAfterMs ?? 0) /
                                        60000
                                ),
                            })}
                        </Text>
                    )}

                <Button
                    appearance="subtle"
                    className={styles.refreshButton}
                    icon={
                        refreshMutation.isPending ? (
                            <Spinner size="tiny" />
                        ) : (
                            <ArrowSyncRegular />
                        )
                    }
                    disabled={refreshMutation.isPending}
                    onClick={() => refreshMutation.mutate()}
                >
                    {t(
                        refreshMutation.isPending
                            ? "nav.refreshing"
                            : "nav.refresh"
                    )}
                </Button>

                <TestGraphMailButton />

                <Button
                    appearance="subtle"
                    className={styles.refreshButton}
                    onClick={() => {
                        clearStoredAzdoConnection();
                        localStorage.removeItem("azureDashboardScope");
                        window.location.reload();
                    }}
                >
                    {t("nav.changePat")}
                </Button>

                <Button
                    appearance="subtle"
                    className={styles.refreshButton}
                    icon={<QuestionCircleRegular />}
                    onClick={() => setHelpOpen(true)}
                >
                    {t("nav.help")}
                </Button>

                <Button
                    appearance="subtle"
                    className={styles.refreshButton}
                    icon={<SettingsRegular />}
                    onClick={() => setSettingsOpen(true)}
                >
                    {t("nav.settings")}
                </Button>

                <LanguageSwitcher />
                <ThemeSwitcher />
            </div>

            <GettingStartedGuide
                open={helpOpen}
                onClose={() => setHelpOpen(false)}
            />

            <SettingsDialog
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </div>
    );
}
