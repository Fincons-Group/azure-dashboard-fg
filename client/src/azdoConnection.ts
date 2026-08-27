import { useState } from "react";

export interface AzdoConnection {
    pat: string;
    org: string;
}

const AZDO_CONNECTION_STORAGE_KEY = "azureDashboardAzdoConnection";

export function loadStoredAzdoConnection(): AzdoConnection | null {
    try {
        const raw = localStorage.getItem(AZDO_CONNECTION_STORAGE_KEY);

        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        const pat = typeof parsed.pat === "string" ? parsed.pat.trim() : "";
        const org = typeof parsed.org === "string" ? parsed.org.trim() : "";

        if (!pat || !org) {
            return null;
        }

        return { pat, org };
    } catch {
        return null;
    }
}

export function saveStoredAzdoConnection(connection: AzdoConnection): void {
    localStorage.setItem(
        AZDO_CONNECTION_STORAGE_KEY,
        JSON.stringify({
            pat: connection.pat.trim(),
            org: connection.org.trim(),
        })
    );
}

export function clearStoredAzdoConnection(): void {
    localStorage.removeItem(AZDO_CONNECTION_STORAGE_KEY);
}

export function useAzdoConnection() {
    const [connection, setConnection] = useState<AzdoConnection | null>(
        () => loadStoredAzdoConnection()
    );

    const saveConnection = (nextConnection: AzdoConnection) => {
        saveStoredAzdoConnection(nextConnection);
        setConnection(nextConnection);
    };

    const clearConnection = () => {
        clearStoredAzdoConnection();
        setConnection(null);
    };

    return {
        connection,
        saveConnection,
        clearConnection,
    };
}
