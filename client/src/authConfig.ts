import {
    LogLevel,
    type Configuration,
} from "@azure/msal-browser";

export const msalConfig: Configuration = {
    auth: {
        clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
        redirectUri: import.meta.env.VITE_ENTRA_REDIRECT_URI,
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

export const loginRequest = {
    scopes: [import.meta.env.VITE_ENTRA_API_SCOPE],
};
