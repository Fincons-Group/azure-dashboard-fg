import axios, { type AxiosInstance } from "axios";
import "dotenv/config";

const auth = Buffer.from(
    `:${process.env.AZDO_PAT}`
).toString("base64");

export const azdo = axios.create({
    baseURL: `https://dev.azure.com/${process.env.AZDO_ORG}/${encodeURIComponent(
        process.env.AZDO_PROJECT!
    )}/_apis`,
    headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
    },
});

// Some APIs (Favorites, Notification Subscriptions) are organization-scoped
// rather than project-scoped, so they can't go through the `azdo` client above.
export const azdoOrg = axios.create({
    baseURL: `https://dev.azure.com/${process.env.AZDO_ORG}/_apis`,
    headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
    },
});

// The Test Plan Progress Report's hierarchy/rollup data isn't exposed by the
// `_apis` REST surface above - it's only available through the Analytics
// OData feed, which lives on a different host (analytics.dev.azure.com, not
// dev.azure.com) and isn't part of the public REST API.
export const azdoOdata = axios.create({
    baseURL: `https://analytics.dev.azure.com/${process.env.AZDO_ORG}/${encodeURIComponent(
        process.env.AZDO_PROJECT!
    )}/_odata/v4.0-preview`,
    headers: {
        Authorization: `Basic ${auth}`,
    },
});

// When AZDO_PAT is expired/revoked (or lacks the scope/conditional-access
// needed for a given API), Azure DevOps doesn't reliably answer with a clean
// 401 - it can instead serve its interactive HTML sign-in page while tagging
// the response with an unrelated status such as 503. Detect that shape here
// so callers get one specific, actionable error instead of a generic
// "Request failed with status code 503".
export class AzdoAuthError extends Error {
    constructor(originalStatus: number) {
        super(
            `Azure DevOps returned its sign-in page instead of data (HTTP ${originalStatus}). ` +
                "The shared AZDO_PAT access token has likely expired, been revoked, or lost the " +
                "required permissions. Ask an administrator to generate a new PAT and update the " +
                "server's AZDO_PAT configuration."
        );
        this.name = "AzdoAuthError";
    }
}

function isHtmlSignInResponse(error: unknown): error is {
    response: { status: number; headers: Record<string, unknown> };
} {
    return (
        axios.isAxiosError(error) &&
        !!error.response &&
        String(error.response.headers?.["content-type"] ?? "").includes(
            "text/html"
        )
    );
}

function attachAuthErrorInterceptor(instance: AxiosInstance): void {
    instance.interceptors.response.use(undefined, (error: unknown) => {
        if (isHtmlSignInResponse(error)) {
            return Promise.reject(
                new AzdoAuthError(error.response.status)
            );
        }

        return Promise.reject(error);
    });
}

for (const instance of [azdo, azdoOrg, azdoOdata]) {
    attachAuthErrorInterceptor(instance);
}

export async function getTestSuiteHierarchy(planId: number) {
    const apply =
        `filter(( TestPlanId eq ${planId} ) and ( IdLevel3 ne null ))` +
        `/groupby((IdLevel1,IdLevel2,IdLevel3,TestPlanTitle,TitleLevel2,TitleLevel3,TestPlanId))`;

    const response = await azdoOdata.get(
        `/TestSuites?$apply=${encodeURIComponent(apply)}`
    );

    return response.data.value;
}

export async function getTestSuiteCurrentCounts(
    planId: number,
    dateSK: number
) {
    const apply =
        `filter(( TestPlanId eq ${planId} ) and ( DateSK eq ${dateSK} ))` +
        `/groupby((TestSuite/IdLevel3,DateSK), aggregate(` +
        `$count as TotalCount, ` +
        `cast(ResultOutcome eq 'Passed', Edm.Int32) with sum as Passed, ` +
        `cast(ResultOutcome eq 'Failed', Edm.Int32) with sum as Failed, ` +
        `cast(ResultOutcome eq 'Blocked', Edm.Int32) with sum as Blocked, ` +
        `cast(ResultOutcome eq 'NotApplicable', Edm.Int32) with sum as NotApplicable, ` +
        `cast(ResultOutcome eq 'None', Edm.Int32) with sum as NotExecuted, ` +
        `cast(ResultOutcome ne 'None', Edm.Int32) with sum as Executed))`;

    const response = await azdoOdata.get(
        `/TestPointHistorySnapshot?$apply=${encodeURIComponent(apply)}`
    );

    return response.data.value;
}

export async function getTestPlans() {
    const response = await azdo.get(
        "/testplan/plans?api-version=7.1"
    );

    return response.data.value;
}

export async function getSuites(planId: number) {
    const response = await azdo.get(
        `/testplan/plans/${planId}/suites?api-version=7.1`
    );

    return response.data.value;
}

export async function getTestCases(
    planId: number,
    suiteId: number
) {
    const response = await azdo.get(
        `/testplan/plans/${planId}/suites/${suiteId}/testcase?api-version=7.1`
    );

    return response.data.value;
}

export async function deleteTestCase(
    id: number
): Promise<void> {
    await azdo.delete(
        `/test/testcases/${id}?api-version=7.1`
    );
}

// Deleting the test case work item (deleteTestCase above) doesn't reliably
// clear its membership in the suite it was viewed in - Azure DevOps can keep
// serving the suite/testcase association for a while after the work item
// itself is gone. Explicitly unlinking from the suite first is what actually
// makes it disappear from the suite tree the UI renders.
export async function deleteTestCasesFromSuite(
    planId: number,
    suiteId: number,
    testCaseIds: number[]
): Promise<void> {
    await azdo.delete(
        `/testplan/plans/${planId}/suites/${suiteId}/testcase` +
        `?testIds=${testCaseIds.join(",")}&api-version=7.1`
    );
}

export async function getTestPoints(
    planId: number,
    suiteId: number
) {
    const response = await azdo.get(
        `/testplan/plans/${planId}/suites/${suiteId}/testpoint?api-version=7.1`
    );

    return response.data.value;
}

// The runs list endpoint returns runs in ascending creation order with no
// $orderby support, so a single capped page (e.g. $top=50) only ever returns
// the oldest runs project-wide - newer runs past that page silently never
// show up. Paging with $skip until a short page comes back is what actually
// gets the full (and therefore most recent) set.
const TEST_RUNS_PAGE_SIZE = 200;

export async function getTestRuns() {
    try {
        const runs: any[] = [];
        let skip = 0;

        while (true) {
            const response = await azdo.get(
                `/test/runs?api-version=7.1&$top=${TEST_RUNS_PAGE_SIZE}&$skip=${skip}&includeRunDetails=true`
            );

            const page = response.data.value;
            runs.push(...page);

            if (page.length < TEST_RUNS_PAGE_SIZE) {
                break;
            }

            skip += TEST_RUNS_PAGE_SIZE;
        }

        return runs;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            return [];
        }

        throw error;
    }
}

// Azure DevOps' `/test/runs` list endpoint can keep returning a run after
// it's been deleted (the run detail lookup then 404s with "does not exist
// in this project. It may have been deleted."). Returning null here (rather
// than an empty stats array) lets callers tell "run exists, no stats yet"
// apart from "run doesn't exist anymore" and drop the latter entirely.
export async function getTestRunStatistics(
    runId: number
): Promise<any[] | null> {
    try {
        const response = await azdo.get(
            `/test/runs/${runId}/statistics?api-version=7.1`
        );

        return response.data.runStatistics;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            return null;
        }

        throw error;
    }
}

export async function getTestRunResults(
    runId: number
) {
    const response = await azdo.get(
        `/test/Runs/${runId}/results?api-version=7.1`
    );

    return response.data.value;
}

export async function getActiveBugIds(): Promise<number[]> {
    const response = await azdo.post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] = 'Bug'
      `,
        }
    );

    return response.data.workItems.map(
        (w: { id: number }) => w.id
    );
}

export async function getWorkItem(id: number) {
    const response = await azdo.get(
        `/wit/workitems/${id}?$expand=relations&api-version=7.1`
    );

    return response.data;
}

export async function getWorkItems(
    ids: number[],
    fields?: string[]
) {
    if (!ids.length) {
        return [];
    }

    const chunks: number[][] = [];

    for (let i = 0; i < ids.length; i += 200) {
        chunks.push(ids.slice(i, i + 200));
    }

    const fieldsParam = fields?.length
        ? `&fields=${fields.join(",")}`
        : "";

    const fetchChunk = async (
        chunk: number[]
    ): Promise<any[]> => {
        try {
            const response = await azdo.get(
                `/wit/workitems?ids=${chunk.join(
                    ","
                )}${fieldsParam}&api-version=7.1`
            );

            return response.data.value;
        } catch (error) {
            if (
                axios.isAxiosError(error) &&
                error.response?.status === 404 &&
                chunk.length > 1
            ) {
                // Azure DevOps 404s the whole batch if even one id in it no
                // longer exists (e.g. a followed/mentioned work item was
                // deleted), rather than just omitting that id. Fall back to
                // fetching this chunk one id at a time so the still-valid
                // ids aren't lost too.
                const singles = await Promise.all(
                    chunk.map((id) => fetchChunk([id]))
                );

                return singles.flat();
            }

            if (
                axios.isAxiosError(error) &&
                error.response?.status === 404
            ) {
                return [];
            }

            throw error;
        }
    };

    const results = await Promise.all(
        chunks.map(fetchChunk)
    );

    return results.flat();
}

const BUG_FIELDS = [
    "System.Id",
    "System.Title",
    "System.State",
    "System.Reason",
    "System.AreaPath",
    "System.IterationPath",
    "System.CreatedDate",
    "System.CreatedBy",
    "System.AssignedTo",
    "System.ChangedDate",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.Severity",
    "Microsoft.VSTS.Common.ClosedDate",
    "Microsoft.VSTS.Build.FoundIn",
    "System.Tags",
    "Custom.Suite",
    "Custom.EstimatedResolutionDate",
];

export async function getAllBugFields(): Promise<any[]> {
    const ids = await getActiveBugIds();

    return getWorkItems(ids, BUG_FIELDS);
}

const STORY_FIELDS = [
    "System.Id",
    "System.AreaPath",
    "Microsoft.VSTS.Scheduling.StoryPoints",
];

export async function getStoriesWithFields(): Promise<any[]> {
    const response = await azdo.post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('User Story', 'Product Backlog Item', 'Requirement')
      `,
        }
    );

    const ids = response.data.workItems.map(
        (w: { id: number }) => w.id
    );

    return getWorkItems(ids, STORY_FIELDS);
}

export async function getWorkItemRevisions(
    id: number
): Promise<any[]> {
    const response = await azdo.get(
        `/wit/workitems/${id}/revisions?api-version=7.1`
    );

    return response.data.value;
}

export async function getStoryCount(): Promise<number> {
    const response = await azdo.post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('User Story', 'Product Backlog Item', 'Requirement')
      `,
        }
    );

    return response.data.workItems.length;
}

// @Me is deliberately not used in the normal (logged-in) path: this client
// authenticates to Azure DevOps with a shared PAT (see top of file), so @Me
// would resolve to the PAT's identity for every caller, not the signed-in
// user. Callers must filter by the real user's identity themselves once
// System.AssignedTo is returned. The one exception is SKIP_AUTH dev mode,
// where there is no signed-in user to filter by and the PAT genuinely is the
// one developer's own personal token, so @Me correctly means "me".
export async function getActiveWorkItemIds(): Promise<
    number[]
> {
    const assignedToMe =
        process.env.SKIP_AUTH === "true"
            ? "AND [System.AssignedTo] = @Me\n          "
            : "";

    const response = await azdo.post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.State] <> 'Removed'
          ${assignedToMe}
        ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC
      `,
        }
    );

    return response.data.workItems.map(
        (w: { id: number }) => w.id
    );
}

// Same @Me caveat as getActiveWorkItemIds above: only narrowed server-side in
// SKIP_AUTH dev mode, where the PAT genuinely belongs to the one developer.
// Otherwise callers must filter by the real user's identity themselves once
// System.CreatedBy is returned.
export async function getCreatedWorkItemIds(): Promise<number[]> {
    const createdByMe =
        process.env.SKIP_AUTH === "true"
            ? "AND [System.CreatedBy] = @Me\n          "
            : "";

    const response = await azdo.post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.State] <> 'Removed'
          ${createdByMe}
        ORDER BY [System.CreatedDate] DESC
      `,
        }
    );

    return response.data.workItems.map(
        (w: { id: number }) => w.id
    );
}

// Bounds the candidate set for comment-mention scanning, since each candidate
// requires its own /comments request and scanning every work item in the
// project would be far too slow.
export async function getRecentlyChangedWorkItemIds(
    days: number
): Promise<number[]> {
    const response = await azdo.post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.State] <> 'Removed'
          AND [System.ChangedDate] >= @Today - ${days}
        ORDER BY [System.ChangedDate] DESC
      `,
        }
    );

    return response.data.workItems.map(
        (w: { id: number }) => w.id
    );
}

// Mentions render in comment HTML as `<a ... data-vss-mention="...">@Display
// Name</a>`. There's no WIQL field to query comment text directly, so each
// candidate work item's comments must be fetched and scanned individually.
export async function getCommentMentions(
    workItemId: number
): Promise<string[]> {
    const response = await azdo.get(
        `/wit/workitems/${workItemId}/comments?api-version=7.1-preview.4`
    );

    const mentionPattern = /data-vss-mention="[^"]*">@([^<]+)</g;
    const names = new Set<string>();

    for (const comment of response.data.value ?? []) {
        const text: string = comment.text ?? "";

        for (const match of text.matchAll(mentionPattern)) {
            names.add(match[1].trim());
        }
    }

    return [...names];
}

// "Following" a work item creates an organization-scoped notification
// subscription with an Artifact filter (see Subscriptions - Create REST API).
// Like @Me above, omitting targetId scopes this to the calling PAT identity,
// so in normal (non-SKIP_AUTH) mode this reflects the shared PAT's follows,
// not the signed-in user's. There's no per-work-item "followed by" field to
// filter on client-side the way assignee is filtered, so unlike the
// Task/Bug @Me case, this limitation can't be worked around once OAuth
// pass-through isn't available.
export async function getFollowedWorkItemIds(): Promise<
    number[]
> {
    const response = await azdoOrg.get(
        "/notification/subscriptions?api-version=7.1"
    );

    return (response.data.value ?? [])
        .filter(
            (sub: any) =>
                sub.filter?.type === "Artifact" &&
                sub.filter?.artifactType === "WorkItem"
        )
        .map((sub: any) =>
            Number.parseInt(sub.filter.artifactId, 10)
        )
        .filter((id: number) => Number.isInteger(id));
}

export async function getBugWorkItemTypeStates(): Promise<
    { name: string; color: string; category: string }[]
> {
    const response = await azdo.get(
        "/wit/workitemtypes/Bug/states?api-version=7.1"
    );

    return response.data.value;
}

export interface IterationNode {
    id: string;
    name: string;
    path: string;
    startDate: string | null;
    finishDate: string | null;
}

// Flattens the classification-nodes tree (project root -> area/iteration
// children, recursively) into one row per node. `parentPath` seeds the walk
// so the resulting `path` includes the project-name root segment, matching
// the full path Azure DevOps actually puts in a work item's
// System.IterationPath / a test plan's `iteration` field (confirmed against
// live data: both are e.g. "Nuova Frontiera\Front Office Auto\Sprint 2", not
// "Front Office Auto\Sprint 2").
function flattenIterationTree(
    node: any,
    parentPath: string
): IterationNode[] {
    const path = parentPath ? `${parentPath}\\${node.name}` : node.name;

    const self: IterationNode = {
        id: String(node.identifier ?? node.id),
        name: node.name,
        path,
        startDate: node.attributes?.startDate ?? null,
        finishDate: node.attributes?.finishDate ?? null,
    };

    const children = (node.children ?? []).flatMap((child: any) =>
        flattenIterationTree(child, path)
    );

    return [self, ...children];
}

// Real Azure DevOps iterations (sprints), independent of what's actually
// been used on a bug so far - unlike DefectFilterOptions.iterations (derived
// from System.IterationPath values seen on fetched bugs), this includes
// empty/future sprints too. Same path format as DefectFilterOptions though,
// so either can be used to filter the same iterationPath/iteration fields.
export async function getIterations(): Promise<IterationNode[]> {
    const response = await azdo.get(
        "/wit/classificationnodes/iterations?$depth=20&api-version=7.1"
    );

    // The root node itself is just the project name, not a real iteration -
    // only its children are actual sprints - but its name still seeds every
    // child's path (see flattenIterationTree).
    return (response.data.children ?? []).flatMap((child: any) =>
        flattenIterationTree(child, response.data.name ?? "")
    );
}

export function buildWorkItemUrl(id: number): string {
    const org = process.env.AZDO_ORG;
    const encodedProject = encodeURIComponent(
        process.env.AZDO_PROJECT!
    );

    return `https://dev.azure.com/${org}/${encodedProject}/_workitems/edit/${id}`;
}

export function buildTestRunUrl(runId: number): string {
    const org = process.env.AZDO_ORG;
    const project = encodeURIComponent(
        process.env.AZDO_PROJECT!
    );

    return `https://dev.azure.com/${org}/${project}/_TestManagement/Runs?runId=${runId}&_a=runCharts`;
}

export function extractWorkItemIds(
    relations: any[] = []
): number[] {
    return relations
        .filter(
            (r) =>
                typeof r.url === "string" &&
                r.url.includes("/workItems/")
        )
        .map((r) => {
            const match =
                r.url.match(/workItems\/(\d+)$/);

            return match
                ? Number.parseInt(match[1], 10)
                : null;
        })
        .filter(
            (id): id is number =>
                id !== null && Number.isInteger(id)
        );
}