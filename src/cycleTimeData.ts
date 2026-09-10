import {
    getEpicIds,
    getWorkItems,
    getWorkItemRevisions,
    extractChildWorkItemIds,
    buildWorkItemUrl,
} from "./azdo.js";
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";
import { DONE_STATES } from "./coverageData.js";
import type {
    AutomationTaskStatus,
    CycleTimeResponse,
    CycleTimeTask,
    CycleTimeTrendPoint,
    ThroughputPoint,
} from "./types.js";

// "In Progress" is the common Agile/Scrum/CMMI name for active work; "Doing"
// is Basic process's equivalent - covers both without needing to know which
// template a given project uses. DONE_STATES (imported) is the exact same
// "finished" definition the Coverage Roadmap uses, so a task's cycle-time
// clock and its coverage roll-up never disagree about what counts as done.
const START_STATES = new Set(["In Progress", "Doing"]);

const REVISION_FETCH_CONCURRENCY = 8;

// Same Monday-start ISO week bucketing as defectData.ts's computeTrend, for
// the same reason: a stable, sortable string key any chart can group by.
function weekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;

    d.setUTCDate(d.getUTCDate() - diff);

    return d.toISOString().slice(0, 10);
}

// Walks one work item's revision history for the *first* entry into a
// START_STATES state, then the *first* entry into a DONE_STATES state that
// happens afterwards. A task that bounced back to New/To Do and was redone
// still only measures first-start -> first-subsequent-done, matching how a
// team would answer "how long did this actually take" rather than crediting
// every rework loop as its own cycle.
function findCycle(
    revisions: any[]
): { startDate: string; doneDate: string } | null {
    let startDate: string | null = null;

    for (const revision of revisions) {
        const state = revision.fields?.["System.State"];
        const changedDate = revision.fields?.["System.ChangedDate"];

        if (!state || !changedDate) {
            continue;
        }

        if (startDate === null && START_STATES.has(state)) {
            startDate = changedDate;
            continue;
        }

        if (startDate !== null && DONE_STATES.has(state)) {
            return { startDate, doneDate: changedDate };
        }
    }

    return null;
}

function median(sortedValues: number[]): number | null {
    if (sortedValues.length === 0) {
        return null;
    }

    const mid = Math.floor(sortedValues.length / 2);

    return sortedValues.length % 2 === 1
        ? sortedValues[mid]
        : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

// Only the Epic's direct children are measured, same scope as the Coverage
// Roadmap (see the equivalent note in coverageData.ts) - if Test Factory
// nests automation work a level deeper, both features need updating together.
export async function buildCycleTimeReport(
    project?: string
): Promise<CycleTimeResponse> {
    const epicIds = await getEpicIds(project);

    if (epicIds.length === 0) {
        return {
            tasks: [],
            allTasks: [],
            throughput: [],
            cycleTimeTrend: [],
            overallAvgCycleTimeDays: null,
            overallMedianCycleTimeDays: null,
        };
    }

    const epicItems = await getWorkItems(epicIds, undefined, project, {
        expand: "all",
    });

    const taskRefs = epicItems.flatMap((epic: any) =>
        extractChildWorkItemIds(epic.relations).map((id) => ({
            id,
            epicId: epic.id,
            epicTitle: epic.fields["System.Title"] as string,
        }))
    );

    const taskItems = await getWorkItems(
        taskRefs.map((ref) => ref.id),
        ["System.Id", "System.Title", "System.State"],
        project
    );
    const titleById = new Map<number, string>(
        taskItems.map((item: any) => [item.id, item.fields["System.Title"]])
    );
    const stateById = new Map<number, string>(
        taskItems.map((item: any) => [item.id, item.fields["System.State"]])
    );

    // Every automation task's *current* state, regardless of whether its
    // history yielded a measurable start->done cycle - this is what lets the
    // page show "N still open" (and per-epic, once filtered) - and which
    // ones - alongside the completed-cycle stats below.
    const allTasks: AutomationTaskStatus[] = taskRefs.map((ref) => ({
        id: ref.id,
        title: titleById.get(ref.id) ?? String(ref.id),
        url: buildWorkItemUrl(ref.id, project),
        epicId: ref.epicId,
        epicTitle: ref.epicTitle,
        state: stateById.get(ref.id) ?? "",
        isDone: DONE_STATES.has(stateById.get(ref.id) ?? ""),
    }));

    const computed = await mapWithConcurrency(
        taskRefs,
        REVISION_FETCH_CONCURRENCY,
        async (ref): Promise<CycleTimeTask | null> => {
            const revisions = await getWorkItemRevisions(ref.id, project);
            const cycle = findCycle(revisions);

            if (!cycle) {
                return null;
            }

            const cycleTimeDays =
                (new Date(cycle.doneDate).getTime() -
                    new Date(cycle.startDate).getTime()) /
                86_400_000;

            // A negative duration would mean the "done" transition was
            // found before "start" chronologically, which findCycle's
            // ordered scan already prevents - guarded anyway since a
            // template with unusual state reuse could otherwise skew
            // the aggregates below.
            if (cycleTimeDays < 0) {
                return null;
            }

            return {
                id: ref.id,
                title: titleById.get(ref.id) ?? String(ref.id),
                url: buildWorkItemUrl(ref.id, project),
                epicId: ref.epicId,
                epicTitle: ref.epicTitle,
                startDate: cycle.startDate,
                doneDate: cycle.doneDate,
                cycleTimeDays: round1(cycleTimeDays),
            };
        }
    );

    const tasks = computed
        .filter((task): task is CycleTimeTask => task !== null)
        .sort((a, b) => a.doneDate.localeCompare(b.doneDate));

    const buckets = new Map<string, { count: number; totalDays: number }>();

    for (const task of tasks) {
        const week = weekStart(new Date(task.doneDate));
        const bucket = buckets.get(week) ?? { count: 0, totalDays: 0 };

        bucket.count += 1;
        bucket.totalDays += task.cycleTimeDays;
        buckets.set(week, bucket);
    }

    const sortedWeeks = [...buckets.keys()].sort((a, b) => a.localeCompare(b));

    const throughput: ThroughputPoint[] = sortedWeeks.map((week) => ({
        weekStart: week,
        completedCount: buckets.get(week)!.count,
    }));

    const cycleTimeTrend: CycleTimeTrendPoint[] = sortedWeeks.map((week) => {
        const bucket = buckets.get(week)!;

        return {
            weekStart: week,
            avgCycleTimeDays: round1(bucket.totalDays / bucket.count),
            completedCount: bucket.count,
        };
    });

    const durations = tasks.map((task) => task.cycleTimeDays);

    const overallAvgCycleTimeDays = durations.length
        ? round1(durations.reduce((sum, d) => sum + d, 0) / durations.length)
        : null;

    const overallMedianCycleTimeDays = median(
        [...durations].sort((a, b) => a - b)
    );

    return {
        tasks,
        allTasks,
        throughput,
        cycleTimeTrend,
        overallAvgCycleTimeDays,
        overallMedianCycleTimeDays:
            overallMedianCycleTimeDays != null
                ? round1(overallMedianCycleTimeDays)
                : null,
    };
}

const cache = new Map<
    string,
    { data: CycleTimeResponse; timestamp: number }
>();

const CACHE_DURATION_MS = 5 * 60 * 1000;

function resolveProjectKey(project?: string): string {
    return project ?? process.env.AZDO_PROJECT!;
}

export async function getCycleTimeReport(
    project?: string
): Promise<CycleTimeResponse> {
    const projectKey = resolveProjectKey(project);
    const cached = cache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    return dedupe(`cycleTime:${projectKey}`, async () => {
        const fresh = cache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const data = await buildCycleTimeReport(project);
        cache.set(projectKey, { data, timestamp: Date.now() });
        return data;
    });
}

export function clearCycleTimeCache(): void {
    cache.clear();
}
