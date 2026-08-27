import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Text,
    Title1,
    Spinner,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { ArrowSyncRegular, QuestionCircleRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { NAV_HEIGHT, RAIL_BG, RAIL_FG, RAIL_FG_ACTIVE } from "../../layoutConstants";
import { postRefresh } from "../../api/client";
import { clearStoredAzdoConnection } from "../../azdoConnection";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { TestGraphMailButton } from "../TestGraphMailButton";
import { GettingStartedGuide } from "../GettingStartedGuide";

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
    title: {
        margin: 0,
        color: RAIL_FG_ACTIVE,
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
        ":hover": {
            color: RAIL_FG_ACTIVE,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
        },
    },
});

export function TopBar({ title }: { title: string }) {
    const styles = useStyles();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [helpOpen, setHelpOpen] = useState(false);

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

    return (
        <div className={styles.bar}>
            <Title1 as="h1" className={styles.title}>
                {title}
            </Title1>

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

                <LanguageSwitcher />
                <ThemeSwitcher />
            </div>

            <GettingStartedGuide
                open={helpOpen}
                onClose={() => setHelpOpen(false)}
            />
        </div>
    );
}
