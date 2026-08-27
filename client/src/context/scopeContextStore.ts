import { createContext } from "react";

export interface Scope {
    project: string;
    areaPath: string;
    sprint: string;
    setProject: (project: string) => void;
    setAreaPath: (areaPath: string) => void;
    setSprint: (sprint: string) => void;
    // The one hard requirement before any page fires a query - matches how
    // every page already treats iteration/area as optional filters (empty
    // string = no filter). Not tied to any signed-in account: this is a
    // single shared localStorage key, independent of which MSAL account (if
    // any) is currently signed in.
    isComplete: boolean;
}

export const ScopeContext = createContext<Scope | null>(null);
