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
import { mapWithConcurrency } from "./concurrency.js";
import { dedupe } from "./inflight.js";
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
            description: htmlToPlainText(
                b.fields["System.Description"] ||
                    b.fields["Microsoft.VSTS.TCM.ReproSteps"]
            ),
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
            createdDate: b.fields["System.CreatedDate"],
            changedDate: b.fields["System.ChangedDate"],
            closedDate: b.fields["Microsoft.VSTS.Common.ClosedDate"],
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
export function indexSuiteTestPoints(testPoints: any[]): SuiteTestPointIndex {
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

// Reference (unbatched) build - kept only so compare-optimized.ts can diff
// it against buildDashboardOptimized(). The live path (getDashboardData)
// uses the optimized build.
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
    const cached = dashboardCache.get(projectKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    // dedupe: getTestCaseLookups() and getAllSuiteNames() both call this, and
    // the Excel Export page fires several project queries at once - without
    // this they'd each kick off a full (cache-missing) rebuild in parallel.
    return dedupe(`dashboard:${projectKey}`, async () => {
        const fresh = dashboardCache.get(projectKey);
        if (fresh && Date.now() - fresh.timestamp < CACHE_DURATION_MS) {
            return fresh.data;
        }

        const data = await buildDashboardOptimized(project);
        dashboardCache.set(projectKey, { data, timestamp: Date.now() });
        return data;
    });
}

export function clearDashboardCache(): void {
    dashboardCache.clear();
}

/* ================================================================== */
/* Optimized (batched) dashboard build - the live path (getDashboardData */
/* calls this). Instead of 2 HTTP calls per test case it does a        */
/* handful of batched getWorkItems() calls. buildDashboard() above is  */
/* kept only as the reference for src/scripts/compare-optimized.ts.    */
/* ================================================================== */

// The pure tail of buildTestCaseRow(): everything after its two awaits,
// working off pre-fetched `workItem` (with .relations) and `linkedItems`.
export function assembleTestCaseRow(
    tc: any,
    planName: string,
    suiteName: string,
    suiteId: number,
    workItem: any,
    linkedItems: any[],
    outcomesByTestCase: Record<number, string[]>,
    lastRunByTestCase: Record<number, number>,
    planIteration: string | undefined,
    project: string | undefined
): TestCaseRow {
    const bugs = linkedItems.filter(
        (item: any) => item.fields["System.WorkItemType"] === "Bug"
    );

    const openBugs = bugs.filter(
        (b: any) => b.fields["System.State"] !== "Closed"
    );

    const lastRunId = lastRunByTestCase[tc.workItem.id];

    return {
        planName,
        areaPath: workItem.fields["System.AreaPath"],
        iteration: planIteration,
        suiteName,
        suiteId,
        testCaseId: tc.workItem.id,
        testCaseTitle: tc.workItem.name,
        testCaseUrl: workItem._links?.html?.href,
        priority:
            workItem.fields["Microsoft.VSTS.Common.Priority"] ?? 4,
        hasOpenBugs: openBugs.length > 0,
        outcome: resolveOutcome(
            outcomesByTestCase[tc.workItem.id] ?? []
        ),
        bugs: bugs.map((b: any) => ({
            id: b.id,
            title: b.fields["System.Title"],
            state: b.fields["System.State"],
            description: htmlToPlainText(
                b.fields["System.Description"] ||
                    b.fields["Microsoft.VSTS.TCM.ReproSteps"]
            ),
            url: buildWorkItemUrl(b.id, project),
            creator: b.fields["System.CreatedBy"]?.displayName,
            assignee: b.fields["System.AssignedTo"]
                ? {
                      displayName: b.fields["System.AssignedTo"].displayName,
                      uniqueName: b.fields["System.AssignedTo"].uniqueName,
                  }
                : undefined,
            createdDate: b.fields["System.CreatedDate"],
            changedDate: b.fields["System.ChangedDate"],
            closedDate: b.fields["Microsoft.VSTS.Common.ClosedDate"],
        })),
        lastRunId,
        lastRunUrl: lastRunId
            ? buildTestRunUrl(lastRunId, project)
            : undefined,
    };
}

const PLAN_FETCH_CONCURRENCY = 6;
const SUITE_FETCH_CONCURRENCY = 12;

export async function buildDashboardOptimized(
    project?: string
): Promise<TestCaseRow[]> {
    const plans = await getTestPlans(project);

    // (plan, suite) pairs in the exact order buildDashboard() walks them -
    // getTestCaseLookups() relies on that order (first-seen wins for a test
    // case's iteration / resolved suite). getSuites runs concurrency-limited
    // but the results are stitched back in plan order.
    const suitesPerPlan = await mapWithConcurrency(
        plans,
        PLAN_FETCH_CONCURRENCY,
        (plan: any) => getSuites(plan.id, project)
    );
    const planSuites: { plan: any; suite: any }[] = [];
    plans.forEach((plan: any, i: number) => {
        for (const suite of suitesPerPlan[i]) {
            planSuites.push({ plan, suite });
        }
    });

    // testcases + points per suite, concurrency-limited, results kept in order.
    const suiteData = await mapWithConcurrency(
        planSuites,
        SUITE_FETCH_CONCURRENCY,
        async ({ plan, suite }) => {
            const [testCases, testPoints] = await Promise.all([
                getTestCases(plan.id, suite.id, project),
                getTestPoints(plan.id, suite.id, project),
            ]);
            return {
                plan,
                suite,
                testCases,
                index: indexSuiteTestPoints(testPoints),
            };
        }
    );

    // One batched relations fetch for every test case work item, then one
    // batched fetch for every linked work item.
    const allTcIds = [
        ...new Set(
            suiteData.flatMap((s) =>
                s.testCases.map((tc: any) => tc.workItem.id)
            )
        ),
    ];
    // `all` (not just `relations`) so the batch response carries `_links`
    // too - the batch endpoint omits it under `$expand=relations`, and
    // buildTestCaseRow reads `workItem._links.html.href` for testCaseUrl.
    const tcItems = await getWorkItems(allTcIds, undefined, project, {
        expand: "all",
    });
    const tcItemById = new Map<number, any>(
        tcItems.map((i: any) => [i.id, i])
    );

    const allLinkedIds = [
        ...new Set(
            tcItems.flatMap((i: any) => extractWorkItemIds(i.relations))
        ),
    ];
    const linkedItems = await getWorkItems(allLinkedIds, undefined, project);
    const linkedById = new Map<number, any>(
        linkedItems.map((i: any) => [i.id, i])
    );

    const rows: TestCaseRow[] = [];
    for (const { plan, suite, testCases, index } of suiteData) {
        for (const tc of testCases) {
            const workItem = tcItemById.get(tc.workItem.id);
            if (!workItem) {
                // buildTestCaseRow() would have thrown on a deleted TC work
                // item; healthy plans never hit this.
                continue;
            }
            // dedupe ids: Azure's ?ids= batch collapses duplicates, so
            // getWorkItems() in the original path already did; a test case
            // can reference the same bug via two relation types.
            const linked = [
                ...new Set(extractWorkItemIds(workItem.relations)),
            ]
                .map((id) => linkedById.get(id))
                .filter((x): x is any => x != null);
            rows.push(
                assembleTestCaseRow(
                    tc,
                    plan.name,
                    suite.name,
                    suite.id,
                    workItem,
                    linked,
                    index.outcomesByTestCase,
                    index.lastRunByTestCase,
                    plan.iteration,
                    project
                )
            );
        }
    }

    return rows;
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

// Azure DevOps stores a bug's Description / Repro Steps as rich HTML. The Excel
// report only needs a short readable summary, so this flattens the markup to
// plain text (keeping paragraph breaks), decodes the common entities, and caps
// the length to keep the /api/plans/:id/overview payload from ballooning.
const DESCRIPTION_MAX_LENGTH = 600;

export function htmlToPlainText(html?: string): string | undefined {
    if (!html) {
        return undefined;
    }

    const text = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\r/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!text) {
        return undefined;
    }

    return text.length > DESCRIPTION_MAX_LENGTH
        ? `${text.slice(0, DESCRIPTION_MAX_LENGTH - 1)}…`
        : text;
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

