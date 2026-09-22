import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ScopeContext, type Scope } from "./scopeContextStore";

const SCOPE_STORAGE_KEY = "azureDashboardScope";
const DEFAULT_SCOPE_KEY = "__default";

interface StoredScope {
    project: string;
    areaPath: string;
    sprint: string;
}

type ScopeMap = Record<string, StoredScope>;

const EMPTY_SCOPE: StoredScope = { project: "", areaPath: "", sprint: "" };

function isStoredScope(value: unknown): value is StoredScope {
    return (
        !!value &&
        typeof value === "object" &&
        typeof (value as StoredScope).project === "string"
    );
}

// Each page (keyed by its route pathname) remembers its own project/area/
// sprint selection independently - picking a project on Coverage Roadmap no
// longer changes it on Test Plans. Browsers that still carry the old
// single-scope format (a flat {project, areaPath, sprint} object, from
// before scope was per-page) get it seeded under DEFAULT_SCOPE_KEY, which
// acts as the starting value for any page that hasn't been given its own
// selection yet, so nobody loses their already-picked project on upgrade.
function loadScopeMap(): ScopeMap {
    try {
        const raw = localStorage.getItem(SCOPE_STORAGE_KEY);

        if (!raw) {
            return {};
        }

        const parsed: unknown = JSON.parse(raw);

        if (isStoredScope(parsed)) {
            return { [DEFAULT_SCOPE_KEY]: parsed };
        }

        if (parsed && typeof parsed === "object") {
            const map: ScopeMap = {};
            for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                if (isStoredScope(value)) {
                    map[key] = value;
                }
            }
            return map;
        }

        return {};
    } catch {
        return {};
    }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const [scopeMap, setScopeMap] = useState<ScopeMap>(loadScopeMap);

    useEffect(() => {
        localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scopeMap));
    }, [scopeMap]);

    const scope = scopeMap[pathname] ?? scopeMap[DEFAULT_SCOPE_KEY] ?? EMPTY_SCOPE;

    // Area/sprint belong to whichever project they were picked under -
    // switching project makes them stale, so they reset together.
    const setProject = (project: string) => {
        setScopeMap((prev) => ({
            ...prev,
            [pathname]: { project, areaPath: "", sprint: "" },
        }));
    };

    const setAreaPath = (areaPath: string) => {
        setScopeMap((prev) => ({
            ...prev,
            [pathname]: { ...(prev[pathname] ?? scope), areaPath },
        }));
    };

    const setSprint = (sprint: string) => {
        setScopeMap((prev) => ({
            ...prev,
            [pathname]: { ...(prev[pathname] ?? scope), sprint },
        }));
    };

    const value: Scope = {
        ...scope,
        setProject,
        setAreaPath,
        setSprint,
        isComplete: !!scope.project,
    };

    return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
