import type { Configuration } from "@azure/msal-browser";

// Config for the separate app registration used only by the "Test Graph
// Mail" button (delegated Mail.Send, sent directly from the browser - no
// backend involved). Deliberately independent of authConfig.ts, which is
// for the dashboard's own sign-in.
export const mailMsalConfig: Configuration = {
    auth: {
        clientId: import.meta.env.VITE_MAIL_ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_MAIL_ENTRA_TENANT_ID}`,
        redirectUri: import.meta.env.VITE_ENTRA_REDIRECT_URI,
    },
    cache: {
        cacheLocation: "sessionStorage",
    },
};

export const mailLoginRequest = {
    scopes: ["User.Read", "Mail.Send"],
};
