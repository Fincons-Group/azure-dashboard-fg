import {
    getTestPlans,
    getSuites,
    getTestCases,
    getTestPoints,
    getWorkItem,
    getWorkItems,
    extractWorkItemIds,
    buildWorkItemUrl,
    buildTestRunUrl,
} from "./azdo.js";
import type {
    TestCaseRow,
    Outcome,
    TestPlanSummary,
} from "./types.js";

// Keyed by resolved project rather than a single global entry, so scoping
// to a different project doesn't evict/clobber the default project's cache.
const dashboardCache = new Map<
    string,
    { data: TestCaseRow[]; timestamp: number }
>();

const CACHE_DURATION_MS = 5 * 60 * 1000;

function resolveProjectKey(project?: string): string {
    return project ?? process.env.AZDO_PROJECT!;
}

// A test point's `results.outcome` can carry a stale/interim verdict (e.g.
// "passed") left over from a prior completed run even while the point's
// *current* result is still open - `results.lastResultState` is what
// actually reflects whether that latest result is finished, so it takes
// priority: only a "completed" result's outcome is trustworthy as
// Passed/Failed/etc, everything else maps to the in-limbo states below
// (verified against Azure's own Test Plans UI numbers for a suite where the
// two had diverged - see the "Test Agenti" suiteId/InProgress/Paused
// investigation this was added for).
export function resolveTestPointStatus(point: any): string {
    const lastResultState = point.results?.lastResultState;

    if (lastResultState == null) {
        return "notrun";
    }

    const normalized = String(lastResultState).toLowerCase();

    if (normalized === "completed") {
        return String(point.results?.outcome ?? "none").toLowerCase();
    }

    if (normalized === "pending") {
        return "inprogress";
    }

    // "inProgress" and "paused" (and any other in-limbo state Azure adds)
    // pass through as-is, to be matched by resolveOutcome() below.
    return normalized;
}

export function resolveOutcome(
    outcomes: string[]
): Outcome {
    const normalized = outcomes.map((o) =>
        o.toLowerCase()
    );

    if (normalized.length === 0) {
        return "NotRun";
    }

    if (normalized.includes("failed")) {
        return "Failed";
    }

    if (normalized.includes("blocked")) {
        return "Blocked";
    }

    if (normalized.includes("paused")) {
        return "Paused";
    }

    if (normalized.includes("inprogress")) {
        return "InProgress";
    }

    if (normalized.every((o) => o === "notapplicable")) {
        return "NotApplicable";
    }

    if (normalized.every((o) => o === "passed")) {
        return "Passed";
    }

    return "NotRun";
}

export async function buildTestCaseRow(
    tc: any,
    planName: string,
    suiteName: string,
    suiteId: number,
    outcomesByTestCase: Record<number, string[]>,
    lastRunByTestCase: Record<number, number>,
    planIteration?: string,
    project?: string
): Promise<TestCaseRow> {
    const workItem = await getWorkItem(
        tc.workItem.id,
        project
    );

    const linkedIds = extractWorkItemIds(
        workItem.relations
    );

    const linkedItems = await getWorkItems(
        linkedIds,
        undefined,
        project
    );

    const bugs = linkedItems.filter(
        (item: any) =>
            item.fields[
            "System.WorkItemType"
            ] === "Bug"
    );

    const openBugs = bugs.filter(
        (b: any) =>
            b.fields["System.State"] !==
            "Closed"
    );

    const lastRunId =
        lastRunByTestCase[tc.workItem.id];

    return {
        planName,
        areaPath:
            workItem.fields[
            "System.AreaPath"
            ],
        iteration: planIteration,
        suiteName,
        suiteId,
        testCaseId: tc.workItem.id,
        testCaseTitle: tc.workItem.name,
        testCaseUrl:
            workItem._links?.html?.href,
        priority:
            workItem.fields[
            "Microsoft.VSTS.Common.Priority"
            ] ?? 4,
        hasOpenBugs: openBugs.length > 0,
        outcome: resolveOutcome(
            outcomesByTestCase[
            tc.workItem.id
            ] ?? []
        ),
        bugs: bugs.map((b: any) => ({
            id: b.id,
            title: b.fields["System.Title"],
            state: b.fields["System.State"],
            url: buildWorkItemUrl(b.id, project),
            creator: b.fields["System.CreatedBy"]?.displayName,
            assignee: b.fields["System.AssignedTo"]
                ? {
                    displayName:
                        b.fields["System.AssignedTo"].displayName,
                    uniqueName:
                        b.fields["System.AssignedTo"].uniqueName,
                }
                : undefined,
        })),
        lastRunId,
        lastRunUrl: lastRunId
            ? buildTestRunUrl(lastRunId, project)
            : undefined,
    };
}

interface SuiteTestPointIndex {
    outcomesByTestCase: Record<number, string[]>;
    lastRunByTestCase: Record<number, number>;
}

// Reduces a suite's raw test points down to, per test case: every recorded
// outcome (for pass/fail history) and the run ID of its most recently
// completed result (ties broken by dateCompleted, since a test case can be
// re-run and points don't come back in run order).
function indexSuiteTestPoints(testPoints: any[]): SuiteTestPointIndex {
    const outcomesByTestCase: Record<number, string[]> = {};
    const lastRunByTestCase: Record<number, number> = {};
    const lastRunDateByTestCase: Record<number, number> = {};

    for (const point of testPoints) {
        const tcId = point.testCaseReference?.id;

        if (tcId == null) {
            continue;
        }

        if (!outcomesByTestCase[tcId]) {
            outcomesByTestCase[tcId] = [];
        }

        outcomesByTestCase[tcId].push(
            resolveTestPointStatus(point)
        );

        const runId = point.results?.lastTestRunId;

        if (runId == null) {
            continue;
        }

        const completedDate = new Date(
            point.results?.lastResultDetails
                ?.dateCompleted ?? 0
        ).getTime();

        if (
            completedDate >=
            (lastRunDateByTestCase[tcId] ?? -1)
        ) {
            lastRunDateByTestCase[tcId] = completedDate;
            lastRunByTestCase[tcId] = runId;
        }
    }

    return { outcomesByTestCase, lastRunByTestCase };
}

export async function buildDashboard(project?: string): Promise<
    TestCaseRow[]
> {
    const plans = await getTestPlans(project);

    const allTestCases: TestCaseRow[] = [];

    for (const plan of plans) {
        const suites = await getSuites(plan.id, project);

        for (const suite of suites) {
            const testCases = await getTestCases(
                plan.id,
                suite.id,
                project
            );

            const testPoints = await getTestPoints(
                plan.id,
                suite.id,
                project
            );

            const { outcomesByTestCase, lastRunByTestCase } =
                indexSuiteTestPoints(testPoints);

            const rows = await Promise.all(
                testCases.map((tc: any) =>
                    buildTestCaseRow(
                        tc,
                        plan.name,
                        suite.name,
                        suite.id,
                        outcomesByTestCase,
                        lastRunByTestCase,
                        plan.iteration,
                        project
                    )
                )
            );

            allTestCases.push(...rows);
        }
    }

    return allTestCases;
}

export async function getDashboardData(project?: string): Promise<
    TestCaseRow[]
> {
    const projectKey = resolveProjectKey(project);
    const now = Date.now();
    const cached = dashboardCache.get(projectKey);

    if (cached && now - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    const data = await buildDashboard(project);

    dashboardCache.set(projectKey, { data, timestamp: now });

    return data;
}

export function clearDashboardCache(): void {
    dashboardCache.clear();
}

// Plan descriptions are used as a place to hand-paste that sprint's report
// link (e.g. plan 6177's description holds the link to its saved report),
// authored through Azure DevOps' rich-text editor - which renders a pasted
// link as Markdown ("[label](https://...)") rather than HTML. Markdown is
// checked first since a bare-URL match on that same text would otherwise
// swallow the link's closing ")" as part of the URL; HTML/plain-text is
// still checked after for descriptions written by hand.
export function extractReportUrlFromDescription(
    description?: string
): string | undefined {
    if (!description) {
        return undefined;
    }

    const markdownMatch = /]\((https?:\/\/[^)\s]+)\)/i.exec(description);
    if (markdownMatch) {
        return markdownMatch[1];
    }

    const hrefMatch = /href=["'](https?:\/\/[^"']+)["']/i.exec(description);
    if (hrefMatch) {
        return hrefMatch[1];
    }

    const bareMatch = /https?:\/\/[^\s"'<>]+/i.exec(description);
    return bareMatch ? stripTrailingPunctuation(bareMatch[0]) : undefined;
}

// Written as a plain loop rather than a trailing-punctuation regex
// (`/[)\].,;:]+$/`) - that pattern flags as super-linear on static analysis,
// and a bounded loop is just as clear for "trim a few trailing chars".
function stripTrailingPunctuation(url: string): string {
    const trailing = new Set([")", "]", ".", ",", ";", ":"]);
    let end = url.length;

    while (end > 0 && trailing.has(url[end - 1])) {
        end--;
    }

    return url.slice(0, end);
}

export async function computeTestPlans(project?: string): Promise<
    TestPlanSummary[]
> {
    const plans = await getTestPlans(project);

    const org = process.env.AZDO_ORG;
    const encodedProject = encodeURIComponent(
        project ?? process.env.AZDO_PROJECT!
    );

    return plans.map((plan: any): TestPlanSummary => ({
        id: plan.id,
        name: plan.name,
        url: `https://dev.azure.com/${org}/${encodedProject}/_testPlans/define?planId=${plan.id}&suiteId=${plan.rootSuite?.id ?? plan.id}`,
        areaPath: plan.areaPath,
        iteration: plan.iteration,
        state: plan.state,
        owner: plan.owner?.displayName,
    }));
}

