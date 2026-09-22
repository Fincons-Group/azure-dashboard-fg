import { useEffect, useRef, useState, type ReactNode } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Sidebar } from "./layout/Sidebar";
import { TopBar } from "./layout/TopBar";
import { ScopeBar } from "./ScopeBar/ScopeBar";
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
    // Full-bleed pages own the whole viewport below the top bars and manage
    // their own scrolling (e.g. the embedded spreadsheet on the Excel Export
    // page), so the outer frame must not scroll or add a centered column.
    mainFullBleed: {
        height: "100vh",
        minHeight: 0,
        overflow: "hidden",
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
    contentWide: {
        // Report page: ReportSidebar takes real horizontal space alongside
        // the report content, so the usual 1200px column feels cramped.
        maxWidth: "1600px",
    },
    contentFullBleed: {
        flex: "1 1 auto",
        minHeight: 0,
        maxWidth: "none",
        width: "100%",
        margin: 0,
        padding: 0,
        gap: 0,
        overflow: "hidden",
    },
});

function getInitialCollapsed(): boolean {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function PageLayout({
    title,
    children,
    hideAreaSprintScope = false,
    wide = false,
    fullBleed = false,
}: {
    title: string;
    children: ReactNode;
    hideAreaSprintScope?: boolean;
    wide?: boolean;
    fullBleed?: boolean;
}) {
    const styles = useStyles();
    const [collapsed, setCollapsed] = useState(getInitialCollapsed);
    const headerRef = useRef<HTMLDivElement>(null);

    const toggleCollapsed = () => {
        setCollapsed((current) => {
            const next = !current;
            localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
            return next;
        });
    };

    // TopBar + ScopeBar's combined rendered height varies (wrapping project
    // chip/title, longer branch names, etc.), so a page that stacks its own
    // sticky bar beneath them can't safely hardcode a pixel offset - it did
    // once (TestSuitesPage) and drifted out of sync. Measuring the real
    // height here and exposing it as a CSS var lets any page's sticky bar
    // anchor to `var(--app-header-height)` instead of guessing.
    //
    // The wrapper below is `display: contents` deliberately - it must NOT
    // introduce a real box. TopBar and ScopeBar are themselves
    // `position: sticky`, which only stays stuck for as long as its
    // containing block (its parent's content box) still spans the
    // viewport; a plain wrapper div is only as tall as these two bars, so
    // once scrolled past that ~140px the bars would run out of box to
    // stick within and scroll away instead of staying pinned. `display:
    // contents` keeps them direct children of `.main` (which is as tall as
    // the whole page) for sticky purposes, while still giving us a DOM
    // node to hang the ResizeObserver measurement off.
    useEffect(() => {
        const wrapper = headerRef.current;
        const target = wrapper?.parentElement;
        const scopeBarEl = wrapper?.lastElementChild as HTMLElement | null;
        if (!target || !scopeBarEl) return;

        const observer = new ResizeObserver(() => {
            const height = Math.ceil(scopeBarEl.getBoundingClientRect().bottom);
            target.style.setProperty("--app-header-height", `${height}px`);
        });
        observer.observe(scopeBarEl);
        return () => observer.disconnect();
    }, []);

    return (
        <div className={styles.page}>
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />

            <div
                className={mergeClasses(
                    styles.main,
                    collapsed ? styles.mainCollapsed : styles.mainExpanded,
                    fullBleed && styles.mainFullBleed
                )}
            >
                <div ref={headerRef} style={{ display: "contents" }}>
                    <TopBar title={title} />
                    <ScopeBar hideAreaSprint={hideAreaSprintScope} />
                </div>

                <div
                    className={mergeClasses(
                        styles.content,
                        wide && styles.contentWide,
                        fullBleed && styles.contentFullBleed
                    )}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
