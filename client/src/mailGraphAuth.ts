import {
    InteractionRequiredAuthError,
    type AuthenticationResult,
} from "@azure/msal-browser";
import { mailMsalInstance, ensureMailMsalInitialized } from "./mailMsalInstance";
import { mailLoginRequest } from "./mailAuthConfig";

// Shared by every frontend-delegated Graph mail sender (TestGraphMailButton,
// the report "Send by email" button) - all authenticate against the same
// app registration (see mailAuthConfig.ts) via an interactive popup, since
// this app's SMTP is blocked outbound on the network it runs on.
//
// Both buttons can call this within the same tick (e.g. the user clicking
// one right after the other). MSAL throws interaction_in_progress if a
// second loginPopup starts before the first resolves, and the stuck flag it
// leaves in sessionStorage then blocks every future call until the tab is
// closed - so concurrent calls share one in-flight request instead of each
// opening their own popup.
let inFlight: Promise<AuthenticationResult> | null = null;

export function acquireMailToken(): Promise<AuthenticationResult> {
    if (!inFlight) {
        inFlight = acquireMailTokenUncached().finally(() => {
            inFlight = null;
        });
    }

    return inFlight;
}

async function acquireMailTokenUncached(): Promise<AuthenticationResult> {
    await ensureMailMsalInitialized();

    const account =
        mailMsalInstance.getActiveAccount() ??
        mailMsalInstance.getAllAccounts()[0];

    if (account) {
        try {
            const result = await mailMsalInstance.acquireTokenSilent({
                ...mailLoginRequest,
                account,
            });
            mailMsalInstance.setActiveAccount(result.account);

            return result;
        } catch (error) {
            if (!(error instanceof InteractionRequiredAuthError)) {
                throw error;
            }
        }
    }

    const loginResponse = await mailMsalInstance.loginPopup(mailLoginRequest);
    mailMsalInstance.setActiveAccount(loginResponse.account);

    return loginResponse;
}

export function getSignedInMailAccount() {
    return (
        mailMsalInstance.getActiveAccount() ??
        mailMsalInstance.getAllAccounts()[0] ??
        null
    );
}

// Full sign-out (popup navigates to the identity provider's end_session
// endpoint) rather than just clearing the local MSAL cache - so a
// subsequent Login doesn't silently SSO back in via the browser's existing
// Microsoft session.
export async function signOutOfMail(): Promise<void> {
    await ensureMailMsalInitialized();

    const account = getSignedInMailAccount();

    if (!account) {
        return;
    }

    await mailMsalInstance.logoutPopup({ account });
}
