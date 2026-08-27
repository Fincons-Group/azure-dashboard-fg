import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventType } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import "./index.css";
import "./i18n";
import { msalInstance } from "./msalInstance";
import { ThemeModeProvider } from "./hooks/ThemeModeProvider";
import { ThemedFluentProvider } from "./components/ThemedFluentProvider";
import { ScopeProvider } from "./context/ScopeContext";
import App from "./App";

const authMode = import.meta.env.VITE_AUTH_MODE ?? "local";
const useSwaAuth = authMode === "swa";

// Every server-side data module caches for 5 minutes (see e.g.
// dashboardData.ts's CACHE_DURATION_MS), so refetching more often than that
// just replays the same server-cached response - it still costs a request,
// a JSON parse and a re-render on every page revisit. Without a staleTime,
// React Query's default (0) means navigating back to an already-visited
// page always shows a loading spinner while it refetches, even though the
// server was always going to hand back the same data. Matching this to the
// server's cache window lets an already-fetched page render instantly from
// memory; "Refresh Now" (TopBar.tsx) is the explicit way to force newer data
// in sooner.
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000,
        },
    },
});

// Every app registration in this project (dashboard sign-in, mailMsalInstance
// for the Test Graph Mail button, and MSAL's own silent-renewal iframe) shares
// this app's root as its redirect URI, so after a login MSAL's own popup /
// hidden iframe navigates back here too.
//
// In MSAL v5 the *opener* does NOT poll the popup's URL - it waits for the
// response on a same-origin BroadcastChannel. For that to arrive, the code
// that lands in the popup/iframe must run MSAL's redirect bridge
// (broadcastResponseToMainFrame), which parses the auth response out of the
// URL, posts it to the opener over that channel and then closes the window.
// This is the piece that must run here; booting the full SPA instead (which
// mounts MsalProvider/React Router and rewrites the URL) is what left the
// sign-in popup stuck showing the dashboard home instead of closing.
//
// Detecting that we're in an MSAL window is the tricky part: navigating
// through Microsoft's login is a cross-origin round-trip that can sever
// window.opener (COOP) and even reset window.name, so neither is reliable once
// the popup lands back here. The signal that always survives is the auth
// response itself - MSAL returns with `state` plus `code`/`id_token`/`error`
// in the URL fragment (or query). This app never does a full-page redirect
// sign-in (no sign-in wall; the only interactive flow is the mail button's
// loginPopup), so an auth response in the URL here means we're inside MSAL's
// popup/iframe, never the main app tab.
function hasMsalAuthResponse(): boolean {
    const check = (raw: string): boolean => {
        if (!raw || raw.length <= 1) {
            return false;
        }
        const params = new URLSearchParams(raw.replace(/^[#?]/, ""));
        return (
            params.has("state") &&
            (params.has("code") || params.has("id_token") || params.has("error"))
        );
    };

    return check(window.location.hash) || check(window.location.search);
}

// Popup/iframe detection is independent of VITE_AUTH_MODE - the mail button's
// loginPopup (mailMsalInstance) runs in every auth mode and shares this app's
// root as its redirect URI, so a popup can land back here regardless of
// whether the dashboard itself is using SWA or local auth. Gating this check
// behind useSwaAuth let a "local" mode popup fall through to booting the full
// SPA inside itself instead of closing, which then risked a second,
// nested loginPopup call from inside that popup.
const isPopup = Boolean(window.opener && window.opener !== window);
const isChildFrame = window.parent !== window;
const isMsalNamedWindow = window.name.startsWith("msal");

const isMsalAuthWindow =
    hasMsalAuthResponse() || isPopup || isMsalNamedWindow || isChildFrame;

if (isMsalAuthWindow) {
    document.title = "Microsoft Authentication";

    try {
        const { broadcastResponseToMainFrame } = await import(
            "@azure/msal-browser/redirect-bridge"
        );
        // Hands the auth response back to the opener over BroadcastChannel and
        // closes this popup / iframe. Never boot the SPA here - even if this
        // throws (e.g. no parseable response), rendering the dashboard inside
        // the sign-in popup is exactly the bug we're avoiding.
        await broadcastResponseToMainFrame();
    } catch (error) {
        console.error("Failed to hand MSAL auth response back to the opener", error);
    }
} else if (useSwaAuth) {
    await bootAppWithDashboardMsal();
} else {
    await bootApp();
}

function renderApp(children: ReactNode) {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            {children}
        </StrictMode>
    );
}

async function bootAppWithDashboardMsal() {
    msalInstance.addEventCallback((event) => {
        if (
            event.eventType === EventType.LOGIN_SUCCESS &&
            event.payload &&
            "account" in event.payload &&
            event.payload.account
        ) {
            msalInstance.setActiveAccount(event.payload.account);
        }
    });

    await msalInstance.initialize();

    // A stuck/mismatched redirect state (e.g. session storage cleared mid-flight
    // during the AAD redirect) makes MSAL throw here. It already clears its own
    // interaction_in_progress flag when that happens, so the safe recovery is to
    // swallow the error and boot normally rather than leave the app unrendered.
    let redirectResponse = null;
    try {
        redirectResponse = await msalInstance.handleRedirectPromise();
    } catch (error) {
        console.error("Failed to process MSAL redirect response", error);
    }

    if (redirectResponse?.account) {
        msalInstance.setActiveAccount(redirectResponse.account);
    } else if (!msalInstance.getActiveAccount()) {
        const [firstAccount] = msalInstance.getAllAccounts();

        if (firstAccount) {
            msalInstance.setActiveAccount(firstAccount);
        }
    }

    renderApp(
        <MsalProvider instance={msalInstance}>
            <ThemeModeProvider>
                <ThemedFluentProvider>
                    <QueryClientProvider client={queryClient}>
                        <ScopeProvider>
                            <BrowserRouter basename={import.meta.env.BASE_URL}>
                                <App />
                            </BrowserRouter>
                        </ScopeProvider>
                    </QueryClientProvider>
                </ThemedFluentProvider>
            </ThemeModeProvider>
        </MsalProvider>
    );
}

async function bootApp() {
    renderApp(
        <ThemeModeProvider>
            <ThemedFluentProvider>
                <QueryClientProvider client={queryClient}>
                    <ScopeProvider>
                        <BrowserRouter basename={import.meta.env.BASE_URL}>
                            <App />
                        </BrowserRouter>
                    </ScopeProvider>
                </QueryClientProvider>
            </ThemedFluentProvider>
        </ThemeModeProvider>
    );
}
