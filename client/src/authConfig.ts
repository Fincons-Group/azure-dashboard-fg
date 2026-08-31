import {
    LogLevel,
    type Configuration,
} from "@azure/msal-browser";

// Falls back to the current origin+base path (e.g. http://localhost:3000/ in
// dev, https://<org>.github.io/<repo>/ on GH Pages) so the same build works
// as a redirect target on any host without a per-environment env var - as
// long as that host's exact URL is also registered as an allowed redirect
// URI on the Entra app registration itself (Azure enforces its own
// allowlist regardless of what this app sends). VITE_ENTRA_REDIRECT_URI
// still overrides this when set, for hosts that need a fixed value.
const dynamicRedirectUri = `${window.location.origin}${import.meta.env.BASE_URL}`;

export const msalConfig: Configuration = {
    auth: {
        clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
        redirectUri: import.meta.env.VITE_ENTRA_REDIRECT_URI || dynamicRedirectUri,
    },
    cache: {
        cacheLocation: "sessionStorage",
    },
    system: {
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) {
                    return;
                }

                switch (level) {
                    case LogLevel.Error:
                        console.error(message);
                        return;
                    case LogLevel.Warning:
                        console.warn(message);
                        return;
                }
            },
        },
    },
};
