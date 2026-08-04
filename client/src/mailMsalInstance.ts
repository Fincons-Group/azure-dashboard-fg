import { PublicClientApplication } from "@azure/msal-browser";
import { mailMsalConfig } from "./mailAuthConfig";

// Kept separate from msalInstance.ts (and outside the app's <MsalProvider>)
// since it authenticates against a different app registration - mixing the
// two under one MsalProvider/useMsal() context would conflate their accounts
// and scopes.
export const mailMsalInstance = new PublicClientApplication(mailMsalConfig);

let initialization: Promise<void> | null = null;

export function ensureMailMsalInitialized(): Promise<void> {
    if (!initialization) {
        initialization = mailMsalInstance.initialize();
    }

    return initialization;
}
