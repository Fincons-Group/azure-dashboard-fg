import {
    getEpicIds,
    getWorkItems,
    extractChildWorkItemIds,
    buildWorkItemUrl,
} from "./azdo.js";
import { dedupe } from "./inflight.js";
import type { CoverageArea, CoverageStatus, CoverageTask } from "./types.js";

// The org sets this per-Epic goal however it likes (a custom field, or a
// repurposed existing one) - there's no standard Azure DevOps field for
// "target automation coverage %", so the field reference name is
// configurable rather than guessed. An Epic missing this field just reports
// targetPct: null.
const TARGET_FIELD =
    process.env.AZDO_EPIC_TARGET_FIELD?.trim() || "Custom.TargetCoverage";

// Work item states that count as "automated" for an epic's child task -
// covers the common process templates (Agile/Scrum/Basic/CMMI) without
// needing to know which one the project uses.
const DONE_STATES = new Set(["Closed", "Done", "Completed", "Resolved"]);

// Below this fraction of target reached, with a due date already in view,
// an area reads as at risk rather than merely in progress - a rough
// "unlikely to make it in time" heuristic (no start date/velocity data is
// available to forecast this properly), not a precise prediction. Tune here
// if it doesn't match the team's judgment once real data is in.
const AT_RISK_TARGET_RATIO = 0.4;

const coverageCache = new Map<
    string,
    { data: CoverageArea[]; timestamp: number }
>();

const CACHE_DURATION_MS = 5 * 60 * 1000;

function resolveProjectKey(project?: string): string {
    return project ?? process.env.AZDO_PROJECT!;
}

function isDoneState(state: string | undefined): boolean {
    return !!state && DONE_STATES.has(state);
}

function computeStatus(
    currentPct: number,
    targetPct: number | null,
    dueDate: string | null
): CoverageStatus {
    const effectiveTarget = targetPct ?? 100;

    if (currentPct >= effectiveTarget) {
        return "done";
    }

    if (dueDate && new Date(dueDate).getTime() < Date.now()) {
        return "at-risk";
    }

    if (
        targetPct != null &&
        targetPct > 0 &&
        currentPct / targetPct < AT_RISK_TARGET_RATIO
    ) {
        return "at-risk";
    }

    return "in-progress";
}

const CHILD_FIELDS = [
    "System.Id",
    "System.Title",
    "System.State",
    "System.WorkItemType",
    "System.AssignedTo",
];

// Only the Epic's direct children are treated as its automation tasks. If
// Test Factory nests automation work a level deeper (Epic > Story > Task),
// this will need to walk another level of extractChildWorkItemIds instead -
// left as direct-children-only for now since that's what "epics and issues"
// described.
export async function buildCoverageRoadmap(
    project?: string
): Promise<CoverageArea[]> {
    const epicIds = await getEpicIds(project);

    if (epicIds.length === 0) {
        return [];
    }

    // $expand=all (not just relations) so _links/html.href comes back too -
    // fields+$expand can't be combined in the same request (see getWorkItems).
    const epicItems = await getWorkItems(epicIds, undefined, project, {
        expand: "all",
    });

    const allChildIds = [
        ...new Set(
            epicItems.flatMap((epic: any) =>
                extractChildWorkItemIds(epic.relations)
            )
        ),
    ];

    const childItems = await getWorkItems(
        allChildIds,
        CHILD_FIELDS,
        project
    );
    const childById = new Map<number, any>(
        childItems.map((item: any) => [item.id, item])
    );

    const areas = epicItems.map((epic: any): CoverageArea => {
        const tasks: CoverageTask[] = extractChildWorkItemIds(epic.relations)
            .map((id) => childById.get(id))
            .filter((item): item is any => item != null)
            .map((item) => ({
                id: item.id,
                title: item.fields["System.Title"],
                url: buildWorkItemUrl(item.id, project),
                state: item.fields["System.State"],
                isDone: isDoneState(item.fields["System.State"]),
                assignee: item.fields["System.AssignedTo"]?.displayName,
            }));

        const doneCount = tasks.filter((task) => task.isDone).length;
        const currentPct = tasks.length
            ? Math.round((doneCount / tasks.length) * 100)
            : 0;

        const targetRaw = epic.fields[TARGET_FIELD];
        const targetPct =
            targetRaw != null && !Number.isNaN(Number(targetRaw))
                ? Number(targetRaw)
                : null;

        const dueDate =
            epic.fields["Microsoft.VSTS.Scheduling.TargetDate"] ?? null;

        return {
            id: epic.id,
            title: epic.fields["System.Title"],
            url: epic._links?.html?.href ?? buildWorkItemUrl(epic.id, project),
            owner: epic.fields["System.AssignedTo"]?.displayName ?? null,
            dueDate,
            currentPct,
            targetPct,
            status: computeStatus(currentPct, targetPct, dueDate),
            tasks,
        };
    });

    return areas.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getCoverageRoadmap(
    project?: string
): Promise<CoverageArea[]> {
    const projectKey = resolveProjectKey(project);
    const cached = coverageCache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`coverage:${projectKey}`, async () => {
        const fresh = coverageCache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const data = await buildCoverageRoadmap(project);
        coverageCache.set(projectKey, { data, timestamp: Date.now() });
        return data;
    });
}

export function clearCoverageCache(): void {
    coverageCache.clear();
}
