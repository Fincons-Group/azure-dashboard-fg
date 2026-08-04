import { useMutation } from "@tanstack/react-query";
import {
    Button,
    Text,
    Title1,
    Spinner,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { useMsal } from "@azure/msal-react";
import { NAV_HEIGHT, RAIL_BG, RAIL_FG, RAIL_FG_ACTIVE } from "../../layoutConstants";
import { postRefresh } from "../../api/client";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { TestGraphMailButton } from "../TestGraphMailButton";

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
    const { instance, accounts } = useMsal();
    const activeAccount = instance.getActiveAccount() ?? accounts[0];

    const refreshMutation = useMutation({
        mutationFn: postRefresh,
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

                {activeAccount && (
                    <Text className={styles.welcome}>
                        {t("nav.welcome", {
                            name: activeAccount.name ?? activeAccount.username,
                        })}
                    </Text>
                )}

                <TestGraphMailButton />

                <LanguageSwitcher />
                <ThemeSwitcher />
            </div>
        </div>
    );
}
