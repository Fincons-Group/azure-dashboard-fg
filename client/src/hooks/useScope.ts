import { useContext } from "react";
import { ScopeContext, type Scope } from "../context/scopeContextStore";

export function useScope(): Scope {
    const scope = useContext(ScopeContext);

    if (!scope) {
        throw new Error("useScope must be used within a ScopeProvider");
    }

    return scope;
}
