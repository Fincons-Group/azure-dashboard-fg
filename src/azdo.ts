import axios, { type AxiosInstance } from "axios";
import { AsyncLocalStorage } from "node:async_hooks";
import dns from "node:dns";
import "dotenv/config";

// On networks where IPv6 is advertised but not actually routable (common on
// corporate VPNs), Node's Happy-Eyeballs dual-stack connect can hang on the
// IPv6 attempt long enough to blow past the OS connect timeout before ever
// falling back to IPv4 - surfacing as an `AggregateError [ETIMEDOUT]` from
// `internalConnectMultiple` even though a plain IPv4 connection would have
// succeeded instantly. Preferring IPv4 resolution avoids that hang entirely.
dns.setDefaultResultOrder("ipv4first");

interface AzdoRuntimeConfig {
    pat?: string;
    org?: string;
    project?: string;
}

const azdoConfigStore = new AsyncLocalStorage<AzdoRuntimeConfig>();

export function runWithAzdoConfig<T>(
    config: AzdoRuntimeConfig,
    callback: () => T
): T {
    return azdoConfigStore.run(config, callback);
}

function resolveConfigValue(
    requestValue: string | undefined,
    envValue: string | undefined
): string | undefined {
    const value = requestValue?.trim() || envValue?.trim();
    return value ? value : undefined;
}

function getCurrentConfig(): Required<AzdoRuntimeConfig> {
    const requestConfig = azdoConfigStore.getStore();

    return {
        pat: resolveConfigValue(requestConfig?.pat, process.env.AZDO_PAT) ?? "",
        org: resolveConfigValue(requestConfig?.org, process.env.AZDO_ORG) ?? "",
        project:
            resolveConfigValue(
                requestConfig?.project,
                process.env.AZDO_PROJECT
            ) ?? "",
    };
}

export class AzdoConfigError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = "AzdoConfigError";
        this.statusCode = statusCode;
    }
}

function requirePat(): string {
    const { pat } = getCurrentConfig();

    if (!pat) {
        throw new AzdoConfigError(
            "Missing Azure DevOps PAT. Save your PAT in the app or set AZDO_PAT on the server.",
            401
        );
    }

    return pat;
}

function requireOrg(): string {
    const { org } = getCurrentConfig();

    if (!org) {
        throw new AzdoConfigError(
            "Missing Azure DevOps organization. Save your organization in the app or set AZDO_ORG on the server."
        );
    }

    return org;
}

function requireProject(project?: string): string {
    const resolvedProject = project?.trim() || getCurrentConfig().project;

    if (!resolvedProject) {
        throw new AzdoConfigError(
            "Missing Azure DevOps project. Select a project in the app or set AZDO_PROJECT on the server."
        );
    }

    return resolvedProject;
}

function buildAuthHeader(pat: string): string {
    return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

// Requests were previously left with no timeout at all (axios `timeout: 0`),
// so a connection that hung (see the IPv6 note above, or any other transient
// network blip) would stall forever instead of failing fast enough to retry.
const REQUEST_TIMEOUT_MS = 30_000;

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
                "The supplied Azure DevOps PAT has likely expired, been revoked, or lost the " +
                "required permissions. Update the PAT in the app setup or on the server."
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

// Transient, connection-level failures (dropped socket, connect timeout,
// temporary DNS hiccup) never reach the server at all, so they never get a
// `response` - retrying the same request a few times with backoff is enough
// to ride out a blip that would otherwise abort an entire dashboard/report
// build over a single flaky request.
const RETRYABLE_ERROR_CODES = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNABORTED",
    "ECONNREFUSED",
    "EAI_AGAIN",
]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

function isRetryableError(error: unknown): error is import("axios").AxiosError {
    return (
        axios.isAxiosError(error) &&
        !error.response &&
        !!error.code &&
        RETRYABLE_ERROR_CODES.has(error.code) &&
        !!error.config
    );
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachRetryInterceptor(instance: AxiosInstance): void {
    instance.interceptors.response.use(undefined, async (error: unknown) => {
        if (!isRetryableError(error)) {
            return Promise.reject(error);
        }

        const config = error.config as typeof error.config & {
            __retryCount?: number;
        };
        const retryCount = config.__retryCount ?? 0;

        if (retryCount >= MAX_RETRIES) {
            return Promise.reject(error);
        }

        config.__retryCount = retryCount + 1;
        await delay(RETRY_BASE_DELAY_MS * 2 ** retryCount);

        return instance.request(config);
    });
}

function attachInterceptors(instance: AxiosInstance): void {
    attachRetryInterceptor(instance);
    attachAuthErrorInterceptor(instance);
}

function createAzdoClient(
    baseURL: string,
    pat: string,
    includeJsonContentType: boolean
): AxiosInstance {
    const instance = axios.create({
        baseURL,
        timeout: REQUEST_TIMEOUT_MS,
        headers: includeJsonContentType
            ? {
                  Authorization: buildAuthHeader(pat),
                  "Content-Type": "application/json",
              }
            : {
                  Authorization: buildAuthHeader(pat),
              },
    });

    attachInterceptors(instance);
    return instance;
}

const projectClients = new Map<string, AxiosInstance>();
const odataProjectClients = new Map<string, AxiosInstance>();
const orgClients = new Map<string, AxiosInstance>();

function projectApiBaseUrl(project?: string): string {
    return `https://dev.azure.com/${requireOrg()}/${encodeURIComponent(
        requireProject(project)
    )}/_apis`;
}

function orgApiBaseUrl(): string {
    return `https://dev.azure.com/${requireOrg()}/_apis`;
}

function odataApiBaseUrl(project?: string): string {
    return `https://analytics.dev.azure.com/${requireOrg()}/${encodeURIComponent(
        requireProject(project)
    )}/_odata/v4.0-preview`;
}

function clientFor(project?: string): AxiosInstance {
    const pat = requirePat();
    const baseURL = projectApiBaseUrl(project);
    const cacheKey = `${baseURL}|${pat}`;
    let instance = projectClients.get(cacheKey);

    if (!instance) {
        instance = createAzdoClient(baseURL, pat, true);
        projectClients.set(cacheKey, instance);
    }

    return instance;
}

function orgClient(): AxiosInstance {
    const pat = requirePat();
    const baseURL = orgApiBaseUrl();
    const cacheKey = `${baseURL}|${pat}`;
    let instance = orgClients.get(cacheKey);

    if (!instance) {
        instance = createAzdoClient(baseURL, pat, true);
        orgClients.set(cacheKey, instance);
    }

    return instance;
}

function odataClientFor(project?: string): AxiosInstance {
    const pat = requirePat();
    const baseURL = odataApiBaseUrl(project);
    const cacheKey = `${baseURL}|${pat}`;
    let instance = odataProjectClients.get(cacheKey);

    if (!instance) {
        instance = createAzdoClient(baseURL, pat, false);
        odataProjectClients.set(cacheKey, instance);
    }

    return instance;
}

export interface ProjectSummary {
    id: string;
    name: string;
}

// Org-scoped (not per-project) - lists every project the shared PAT can see,
// which is what feeds the dynamic Sprint Report page's project picker.
export async function getProjects(): Promise<ProjectSummary[]> {
    const response = await orgClient().get(
        "/projects?api-version=7.1"
    );

    return (response.data.value ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
    }));
}

export async function getTestSuiteHierarchy(planId: number, project?: string) {
    const apply =
        `filter(( TestPlanId eq ${planId} ) and ( IdLevel3 ne null ))` +
        `/groupby((IdLevel1,IdLevel2,IdLevel3,TestPlanTitle,TitleLevel2,TitleLevel3,TestPlanId))`;

    const response = await odataClientFor(project).get(
        `/TestSuites?$apply=${encodeURIComponent(apply)}`
    );

    return response.data.value;
}

export async function getTestSuiteCurrentCounts(
    planId: number,
    dateSK: number,
    project?: string
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

    const response = await odataClientFor(project).get(
        `/TestPointHistorySnapshot?$apply=${encodeURIComponent(apply)}`
    );

    return response.data.value;
}

export async function getTestPlans(project?: string) {
    const response = await clientFor(project).get(
        "/testplan/plans?api-version=7.1"
    );

    return response.data.value;
}

// The list endpoint above omits several fields (description among them) -
// only "get by id" returns the full plan, including its description.
export async function getTestPlan(planId: number, project?: string) {
    const response = await clientFor(project).get(
        `/testplan/plans/${planId}?api-version=7.1`
    );

    return response.data;
}

export async function getSuites(planId: number, project?: string) {
    const response = await clientFor(project).get(
        `/testplan/plans/${planId}/suites?api-version=7.1`
    );

    return response.data.value;
}

export async function getTestCases(
    planId: number,
    suiteId: number,
    project?: string
) {
    const response = await clientFor(project).get(
        `/testplan/plans/${planId}/suites/${suiteId}/testcase?api-version=7.1`
    );

    return response.data.value;
}

export async function deleteTestCase(
    id: number,
    project?: string
): Promise<void> {
    await clientFor(project).delete(
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
    testCaseIds: number[],
    project?: string
): Promise<void> {
    await clientFor(project).delete(
        `/testplan/plans/${planId}/suites/${suiteId}/testcase` +
        `?testIds=${testCaseIds.join(",")}&api-version=7.1`
    );
}

export async function getTestPoints(
    planId: number,
    suiteId: number,
    project?: string
) {
    const response = await clientFor(project).get(
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

export async function getTestRuns(project?: string) {
    try {
        const runs: any[] = [];
        let skip = 0;

        while (true) {
            const response = await clientFor(project).get(
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
    runId: number,
    project?: string
): Promise<any[] | null> {
    try {
        const response = await clientFor(project).get(
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
    runId: number,
    project?: string
) {
    const response = await clientFor(project).get(
        `/test/Runs/${runId}/results?api-version=7.1`
    );

    return response.data.value;
}

export async function getActiveBugIds(project?: string): Promise<number[]> {
    // Azure DevOps' WIQL endpoint does NOT implicitly scope results to the
    // project in the request URL - without an explicit TeamProject clause it
    // silently returns org-wide results regardless of which project's client
    // posts the query (confirmed empirically: two different projects'
    // clients returned identical bug IDs until this clause was added).
    const response = await clientFor(project).post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] = 'Bug'
          AND [System.TeamProject] = @project
      `,
        }
    );

    return response.data.workItems.map(
        (w: { id: number }) => w.id
    );
}

export async function getWorkItem(id: number, project?: string) {
    const response = await clientFor(project).get(
        `/wit/workitems/${id}?$expand=relations&api-version=7.1`
    );

    return response.data;
}

export async function getWorkItems(
    ids: number[],
    fields?: string[],
    project?: string
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
            const response = await clientFor(project).get(
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

export async function getAllBugFields(project?: string): Promise<any[]> {
    const ids = await getActiveBugIds(project);

    return getWorkItems(ids, BUG_FIELDS, project);
}

const STORY_FIELDS = [
    "System.Id",
    "System.AreaPath",
    "Microsoft.VSTS.Scheduling.StoryPoints",
];

export async function getStoriesWithFields(project?: string): Promise<any[]> {
    const response = await clientFor(project).post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('User Story', 'Product Backlog Item', 'Requirement')
          AND [System.TeamProject] = @project
      `,
        }
    );

    const ids = response.data.workItems.map(
        (w: { id: number }) => w.id
    );

    return getWorkItems(ids, STORY_FIELDS, project);
}

export async function getWorkItemRevisions(
    id: number,
    project?: string
): Promise<any[]> {
    const response = await clientFor(project).get(
        `/wit/workitems/${id}/revisions?api-version=7.1`
    );

    return response.data.value;
}

export async function getStoryCount(project?: string): Promise<number> {
    const response = await clientFor(project).post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('User Story', 'Product Backlog Item', 'Requirement')
          AND [System.TeamProject] = @project
      `,
        }
    );

    return response.data.workItems.length;
}

// @Me is deliberately not used here: this client authenticates to Azure
// DevOps with a shared PAT (see top of file), so @Me would resolve to the
// PAT's identity for every caller, not the signed-in user. Callers must
// filter by the real user's identity themselves once System.AssignedTo is
// returned.
export async function getActiveWorkItemIds(project?: string): Promise<
    number[]
> {
    const response = await clientFor(project).post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.State] <> 'Removed'
          AND [System.TeamProject] = @project
        ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC
      `,
        }
    );

    return response.data.workItems.map(
        (w: { id: number }) => w.id
    );
}

// Same @Me caveat as getActiveWorkItemIds above: callers must filter by the
// real user's identity themselves once System.CreatedBy is returned.
export async function getCreatedWorkItemIds(project?: string): Promise<number[]> {
    const response = await clientFor(project).post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.State] <> 'Removed'
          AND [System.TeamProject] = @project
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
    days: number,
    project?: string
): Promise<number[]> {
    const response = await clientFor(project).post(
        "/wit/wiql?api-version=7.1",
        {
            query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.State] <> 'Removed'
          AND [System.TeamProject] = @project
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
    workItemId: number,
    project?: string
): Promise<string[]> {
    const response = await clientFor(project).get(
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
// so this reflects the shared PAT's follows, not the signed-in user's.
// There's no per-work-item "followed by" field to filter on client-side the
// way assignee is filtered, so unlike the Task/Bug @Me case, this limitation
// can't be worked around once OAuth pass-through isn't available.
export async function getFollowedWorkItemIds(): Promise<
    number[]
> {
    const response = await orgClient().get(
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

export async function getBugWorkItemTypeStates(project?: string): Promise<
    { name: string; color: string; category: string }[]
> {
    const response = await clientFor(project).get(
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
// Shared by getIterations/getAreaPaths - both classification-node trees
// (iterations, areas) have the same shape and need the same depth-first
// flatten into one path-qualified row per node.
function flattenClassificationTree(
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
        flattenClassificationTree(child, path)
    );

    return [self, ...children];
}

// Real Azure DevOps iterations (sprints), independent of what's actually
// been used on a bug so far - unlike DefectFilterOptions.iterations (derived
// from System.IterationPath values seen on fetched bugs), this includes
// empty/future sprints too. Same path format as DefectFilterOptions though,
// so either can be used to filter the same iterationPath/iteration fields.
export async function getIterations(project?: string): Promise<IterationNode[]> {
    const response = await clientFor(project).get(
        "/wit/classificationnodes/iterations?$depth=20&api-version=7.1"
    );

    // The root node itself is just the project name, not a real iteration -
    // only its children are actual sprints - but its name still seeds every
    // child's path (see flattenClassificationTree).
    return (response.data.children ?? []).flatMap((child: any) =>
        flattenClassificationTree(child, response.data.name ?? "")
    );
}

// Same tree shape/semantics as getIterations, but for the Area Path
// classification tree - used by the dynamic Sprint Report page's Area Path
// selector.
export async function getAreaPaths(project?: string): Promise<IterationNode[]> {
    const response = await clientFor(project).get(
        "/wit/classificationnodes/areas?$depth=20&api-version=7.1"
    );

    return (response.data.children ?? []).flatMap((child: any) =>
        flattenClassificationTree(child, response.data.name ?? "")
    );
}

export function buildWorkItemUrl(id: number, project?: string): string {
    const org = process.env.AZDO_ORG;
    const encodedProject = encodeURIComponent(
        project ?? process.env.AZDO_PROJECT!
    );

    return `https://dev.azure.com/${org}/${encodedProject}/_workitems/edit/${id}`;
}

export function buildTestRunUrl(runId: number, project?: string): string {
    const org = process.env.AZDO_ORG;
    const encodedProject = encodeURIComponent(
        project ?? process.env.AZDO_PROJECT!
    );

    return `https://dev.azure.com/${org}/${encodedProject}/_TestManagement/Runs?runId=${runId}&_a=runCharts`;
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