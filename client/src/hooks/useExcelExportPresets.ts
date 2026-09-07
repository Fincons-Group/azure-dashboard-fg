import { useEffect, useState } from "react";

const STORAGE_KEY = "azureDashboardExcelExportPresets";
const STORAGE_VERSION = 1;

// A saved report scope for the Excel Export page. Unlike the single global
// ScopeContext triple, several of these can be exported together (or all at
// once via "Tutto") - each carries its own project/area/sprint plus the test
// plan IDs that feed its report.
export interface ExcelExportPreset {
    id: string;
    name: string;
    project: string;
    // Full classification-node paths (same format the sidebar/scope use),
    // "" for areaPath = whole project.
    areaPath: string;
    sprint: string;
    planIds: number[];
}

interface StoredShape {
    version: number;
    presets: ExcelExportPreset[];
}

// Best-effort starting points seeded only on the very first visit (key
// absent). The area/iteration leaf structure is discovered at runtime from
// Azure DevOps, so these can't be fully resolved here - the user finishes
// each one (sprint + plans) in the editor, which is the source of truth.
function seedPresets(): ExcelExportPreset[] {
    const project = "Nuova Frontiera";

    return [
        {
            id: crypto.randomUUID(),
            name: "Plurifonds",
            project,
            areaPath: "Nuova Frontiera\\Plurifond",
            sprint: "",
            planIds: [],
        },
        {
            id: crypto.randomUUID(),
            name: "Auto Sprint 1",
            project,
            areaPath: "Nuova Frontiera\\Front Office Auto\\Sprint 1",
            sprint: "",
            planIds: [],
        },
        {
            id: crypto.randomUUID(),
            name: "Auto Sprint 2",
            project,
            areaPath: "Nuova Frontiera\\Front Office Auto\\Sprint 2",
            sprint: "",
            planIds: [],
        },
    ];
}

function loadPresets(): ExcelExportPreset[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (raw === null) {
            const seeded = seedPresets();

            savePresets(seeded);

            return seeded;
        }

        const parsed = JSON.parse(raw) as Partial<StoredShape>;

        return Array.isArray(parsed.presets) ? parsed.presets : [];
    } catch {
        return [];
    }
}

function savePresets(presets: ExcelExportPreset[]) {
    try {
        const payload: StoredShape = { version: STORAGE_VERSION, presets };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // localStorage unavailable - presets just won't persist.
    }
}

// Persists the Excel Export page's scope presets in localStorage. Structural
// twin of useCheckedTestPlans: initial read is render-safe, writes happen in
// an effect, and every access is wrapped in try/catch.
export function useExcelExportPresets(): {
    presets: ExcelExportPreset[];
    addPreset: (preset: Omit<ExcelExportPreset, "id">) => string;
    updatePreset: (id: string, patch: Partial<Omit<ExcelExportPreset, "id">>) => void;
    deletePreset: (id: string) => void;
} {
    const [presets, setPresets] = useState<ExcelExportPreset[]>(loadPresets);

    useEffect(() => {
        savePresets(presets);
    }, [presets]);

    const addPreset = (preset: Omit<ExcelExportPreset, "id">) => {
        const id = crypto.randomUUID();

        setPresets((prev) => [...prev, { ...preset, id }]);

        return id;
    };

    const updatePreset = (
        id: string,
        patch: Partial<Omit<ExcelExportPreset, "id">>
    ) => {
        setPresets((prev) =>
            prev.map((preset) =>
                preset.id === id ? { ...preset, ...patch } : preset
            )
        );
    };

    const deletePreset = (id: string) => {
        setPresets((prev) => prev.filter((preset) => preset.id !== id));
    };

    return { presets, addPreset, updatePreset, deletePreset };
}

// A preset can only be exported once it has a sprint and at least one plan -
// the report queries need both.
export function isPresetComplete(preset: ExcelExportPreset): boolean {
    return (
        !!preset.project &&
        !!preset.sprint &&
        preset.planIds.length > 0
    );
}
