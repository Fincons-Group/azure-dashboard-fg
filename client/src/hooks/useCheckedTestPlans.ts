import { useEffect, useState } from "react";

const STORAGE_KEY = "azureDashboardCheckedTestPlans";

interface ScopeEntry {
    seen: number[];
    checked: number[];
}

type StoredEntries = Record<string, ScopeEntry>;

interface TestPlanScope {
    project: string;
    areaPath: string;
    sprint: string;
}

function scopeKeyOf(scope: TestPlanScope): string | null {
    if (!scope.project || !scope.sprint) {
        return null;
    }

    return `${scope.project}|${scope.areaPath}|${scope.sprint}`;
}

function loadStoredEntries(): StoredEntries {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveEntry(scopeKey: string, entry: ScopeEntry) {
    try {
        const all = loadStoredEntries();

        all[scopeKey] = entry;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // localStorage unavailable - selection just won't persist.
    }
}

// Persists which test plans a user has checked for a given
// project+areaPath+sprint scope, and tracks which plan IDs have ever been
// seen for that scope. The very first time a scope is ever visited there's
// nothing to protect yet, so every plan present at that moment is checked
// by default. From then on, a plan that shows up later - one genuinely new
// to an already-reviewed sprint - defaults to unchecked ("waiting for
// green light") instead of being auto-selected, while every previously-seen
// plan restores its checked state across reloads.
export function useCheckedTestPlans(
    scope: TestPlanScope,
    planIds: number[] | undefined
): {
    checkedPlanIds: number[];
    setCheckedPlanIds: (ids: number[]) => void;
    newPlanIds: Set<number>;
} {
    const scopeKey = scopeKeyOf(scope);
    const [checkedPlanIds, setCheckedPlanIdsState] = useState<number[]>([]);
    const [newPlanIds, setNewPlanIds] = useState<Set<number>>(new Set());
    const [reconciledFor, setReconciledFor] = useState<{
        scopeKey: string | null;
        planIds: number[] | undefined;
    }>({ scopeKey: null, planIds: undefined });

    // Render-time state adjustment ("Adjusting state when a prop changes"
    // in the React docs) rather than an effect - the restored/new plan
    // sets need to be settled before this render commits, and this way
    // there's no extra render/flash of the stale empty state first. Tracks
    // "previous" via state (not a ref) since refs can't be read/written
    // during render.
    if (
        scopeKey &&
        planIds &&
        (reconciledFor.scopeKey !== scopeKey ||
            reconciledFor.planIds !== planIds)
    ) {
        setReconciledFor({ scopeKey, planIds });

        const stored = loadStoredEntries()[scopeKey] ?? {
            seen: [],
            checked: [],
        };
        const isFirstVisit = stored.seen.length === 0;
        const seenSet = new Set(stored.seen);
        const freshlySeen = isFirstVisit
            ? []
            : planIds.filter((id) => !seenSet.has(id));
        const restoredChecked = isFirstVisit
            ? [...planIds]
            : stored.checked.filter((id) => planIds.includes(id));

        setCheckedPlanIdsState(restoredChecked);
        setNewPlanIds(new Set(freshlySeen));
    }

    // Persists the reconciled seen/checked sets. Runs after every commit
    // where checkedPlanIds changed - whether that's the render-time
    // reconciliation above settling in, or the user toggling a checkbox -
    // so this is the only place that writes to localStorage.
    useEffect(() => {
        if (!scopeKey || !planIds) {
            return;
        }

        const stored = loadStoredEntries()[scopeKey] ?? {
            seen: [],
            checked: [],
        };
        const updatedSeen = [...new Set([...stored.seen, ...planIds])];

        saveEntry(scopeKey, { seen: updatedSeen, checked: checkedPlanIds });
    }, [scopeKey, planIds, checkedPlanIds]);

    const setCheckedPlanIds = (ids: number[]) => {
        setCheckedPlanIdsState(ids);
        setNewPlanIds((prev) => {
            const next = new Set(prev);

            ids.forEach((id) => next.delete(id));

            return next;
        });
    };

    return { checkedPlanIds, setCheckedPlanIds, newPlanIds };
}
