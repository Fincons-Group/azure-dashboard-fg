import type { Configuration } from "@azure/msal-browser";

// Config for the separate app registration used only by the "Test Graph
// Mail" button (delegated Mail.Send, sent directly from the browser - no
// backend involved). Deliberately independent of authConfig.ts, which is
// for the dashboard's own sign-in.
//
// redirectUri falls back to the current origin+base path (see authConfig.ts)
// so it works on any host the app is served from without a per-environment
// env var - the Entra app registration still needs that exact host URL
// registered as an allowed redirect URI.
const dynamicRedirectUri = `${window.location.origin}${import.meta.env.BASE_URL}`;

export const mailMsalConfig: Configuration = {
    auth: {
        clientId: import.meta.env.VITE_MAIL_ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_MAIL_ENTRA_TENANT_ID}`,
        redirectUri: import.meta.env.VITE_ENTRA_REDIRECT_URI || dynamicRedirectUri,
    },
    cache: {
        cacheLocation: "sessionStorage",
    },
};

export const mailLoginRequest = {
    scopes: ["User.Read", "Mail.Send"],
};
