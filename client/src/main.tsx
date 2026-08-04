import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventType } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import "./i18n";
import { msalInstance } from "./msalInstance";
import { ThemeModeProvider } from "./hooks/ThemeModeProvider";
import { ThemedFluentProvider } from "./components/ThemedFluentProvider";
import App from "./App";

const queryClient = new QueryClient();

// Every app registration in this project (dashboard sign-in, mailMsalInstance
// for the Test Graph Mail button, and MSAL's own silent-renewal iframe) shares
// this app's root as its redirect URI. When MSAL opens a login popup or a
// hidden iframe for token renewal, that window navigates back here too - if
// left alone it would boot the *full* app (mounting a different MSAL
// instance, routing, etc.) instead of running MSAL's bridge script, so the
// opener never receives its response and the popup never closes (see
// @azure/msal-browser's redirect_bridge module, which is what's actually
// meant to run in that window). Hand off to the bridge before doing anything
// else whenever we're inside one of those windows.
const isPopupOrIframe = (window.opener && window.opener !== window) || window.parent !== window;

if (isPopupOrIframe) {
    try {
        const { broadcastResponseToMainFrame } = await import("@azure/msal-browser/redirect-bridge");
        await broadcastResponseToMainFrame();
    } catch {
        // Not actually an MSAL auth response landing here (e.g. embedded in an
        // iframe for an unrelated reason) - fall back to a normal app boot.
        await bootApp();
    }
} else {
    await bootApp();
}

async function bootApp() {
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

    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <MsalProvider instance={msalInstance}>
                <ThemeModeProvider>
                    <ThemedFluentProvider>
                        <QueryClientProvider client={queryClient}>
                            <BrowserRouter basename={import.meta.env.BASE_URL}>
                                <App />
                            </BrowserRouter>
                        </QueryClientProvider>
                    </ThemedFluentProvider>
                </ThemeModeProvider>
            </MsalProvider>
        </StrictMode>
    );
}
