import { useState, type ReactNode } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Sidebar } from "./layout/Sidebar";
import { TopBar } from "./layout/TopBar";
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "../layoutConstants";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebarCollapsed";

const useStyles = makeStyles({
    page: {
        minHeight: "100vh",
        backgroundColor: tokens.colorNeutralBackground2,
    },
    main: {
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        transitionProperty: "margin-left",
        transitionDuration: tokens.durationSlow,
        transitionTimingFunction: tokens.curveEasyEase,
    },
    mainExpanded: {
        marginLeft: SIDEBAR_WIDTH,
    },
    mainCollapsed: {
        marginLeft: SIDEBAR_COLLAPSED_WIDTH,
    },
    content: {
        maxWidth: "1200px",
        width: "100%",
        margin: "0 auto",
        padding: tokens.spacingHorizontalL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
        boxSizing: "border-box",
    },
});

function getInitialCollapsed(): boolean {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function PageLayout({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    const styles = useStyles();
    const [collapsed, setCollapsed] = useState(getInitialCollapsed);

    const toggleCollapsed = () => {
        setCollapsed((current) => {
            const next = !current;
            localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
            return next;
        });
    };

    return (
        <div className={styles.page}>
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />

            <div
                className={mergeClasses(
                    styles.main,
                    collapsed ? styles.mainCollapsed : styles.mainExpanded
                )}
            >
                <TopBar title={title} />

                <div className={styles.content}>{children}</div>
            </div>
        </div>
    );
}
