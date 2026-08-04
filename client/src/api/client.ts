import { InteractionRequiredAuthError } from "@azure/msal-browser";
import type {
    SuiteStat,
    DashboardResponse,
    RunCard,
    AutomationDashboardResponse,
    ExecutionTrendResponse,
    TestPlanSummary,
    TestSuiteSummary,
    DefectDashboardResponse,
    DefectFilters,
    CommonErrorsResponse,
    WorkItemSummary,
    MyWorkItemsMode,
    PlanOverviewResponse,
    TestPlanProgressResponse,
    BugInfo,
    DeleteTestCaseItem,
    DeleteTestCasesResult,
    ReleaseReadinessResponse,
    NavBadgesResponse,
    IterationNode,
} from "../types";
import { loginRequest } from "../authConfig";
import { msalInstance } from "../msalInstance";
import i18n from "../i18n";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const skipAuth = import.meta.env.VITE_SKIP_AUTH === "true";

async function getAccessToken(): Promise<string> {
    const account =
        msalInstance.getActiveAccount() ??
        msalInstance.getAllAccounts()[0];

    if (!account) {
        throw new Error("No signed-in account");
    }

    try {
        const result = await msalInstance.acquireTokenSilent({
            ...loginRequest,
            account,
        });

        return result.accessToken;
    } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
            await msalInstance.acquireTokenRedirect({
                ...loginRequest,
                account,
            });
        }

        throw error;
    }
}

async function authorizedFetch(
    path: string,
    init: RequestInit = {}
): Promise<Response> {
    if (skipAuth) {
        return fetch(`${API_BASE_URL}${path}`, init);
    }

    const accessToken = await getAccessToken();

    return fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            ...init.headers,
            Authorization: `Bearer ${accessToken}`,
        },
    });
}

async function throwForErrorResponse(
    res: Response,
    fallbackMessage: string
): Promise<never> {
    const body = await res.json().catch(() => null);

    if (body?.message) {
        throw new Error(body.message);
    }

    // 502/503 without a JSON body means something in front of our API (the
    // host, a proxy) is down or restarting rather than our own route code
    // having thrown - the backend normally translates an expired/invalid
    // AZDO_PAT into a 502 with an explicit message handled above.
    if (res.status === 502 || res.status === 503) {
        throw new Error(i18n.t("errorState.serviceUnavailable"));
    }

    throw new Error(fallbackMessage);
}

async function getJson<T>(url: string): Promise<T> {
    const res = await authorizedFetch(url);

    if (!res.ok) {
        await throwForErrorResponse(
            res,
            `Request to ${url} failed (${res.status})`
        );
    }

    return res.json();
}

export function fetchSuites(): Promise<
    Record<string, SuiteStat>
> {
    return getJson("/api/suites");
}

export function fetchDashboard(
    iteration?: string
): Promise<DashboardResponse> {
    const qs = iteration
        ? `?iteration=${encodeURIComponent(iteration)}`
        : "";

    return getJson(`/api/dashboard${qs}`);
}

export function fetchRuns(): Promise<RunCard[]> {
    return getJson("/api/runs");
}

export function fetchPlans(): Promise<TestPlanSummary[]> {
    return getJson("/api/plans");
}

export function fetchIterations(): Promise<IterationNode[]> {
    return getJson("/api/iterations");
}

export function fetchPlanSuites(
    planId: number
): Promise<TestSuiteSummary[]> {
    return getJson(`/api/plans/${planId}/suites`);
}

export function fetchPlanOverview(
    planId: number
): Promise<PlanOverviewResponse> {
    return getJson(`/api/plans/${planId}/overview`);
}

export function fetchPlanProgress(
    planId: number
): Promise<TestPlanProgressResponse> {
    return getJson(`/api/plans/${planId}/progress`);
}

export function fetchPlanProgressBugs(
    planId: number,
    suiteIds: number[]
): Promise<BugInfo[]> {
    const qs = suiteIds.length ? `?suiteIds=${suiteIds.join(",")}` : "";

    return getJson(`/api/plans/${planId}/progress/bugs${qs}`);
}

export function fetchAutomationDashboard(
    planId?: number,
    iteration?: string
): Promise<AutomationDashboardResponse> {
    const params = new URLSearchParams();

    if (planId != null) params.set("planId", String(planId));
    if (iteration) params.set("iteration", iteration);

    const qs = params.toString();
    const url = qs ? `/api/automation?${qs}` : "/api/automation";

    return getJson(url);
}

export function fetchExecutionTrend(): Promise<ExecutionTrendResponse> {
    return getJson("/api/execution-trend");
}

export function fetchDefects(
    filters?: DefectFilters
): Promise<DefectDashboardResponse> {
    const params = new URLSearchParams();

    if (filters?.iteration) params.set("iteration", filters.iteration);
    if (filters?.area) params.set("area", filters.area);
    if (filters?.environment) params.set("environment", filters.environment);
    if (filters?.targetVersion) params.set("targetVersion", filters.targetVersion);
    filters?.suites?.forEach((suite) => params.append("suite", suite));

    const qs = params.toString();

    return getJson(`/api/defects${qs ? `?${qs}` : ""}`);
}

export function fetchReleaseReadiness(
    iteration?: string
): Promise<ReleaseReadinessResponse> {
    const qs = iteration
        ? `?iteration=${encodeURIComponent(iteration)}`
        : "";

    return getJson(`/api/release-readiness${qs}`);
}

export function fetchNavBadges(): Promise<NavBadgesResponse> {
    return getJson("/api/nav-badges");
}

export function fetchCommonErrors(): Promise<CommonErrorsResponse> {
    return getJson("/api/common-errors");
}

export function fetchMyWorkItems(
    mode: MyWorkItemsMode
): Promise<WorkItemSummary[]> {
    return getJson(`/api/my-work-items?mode=${mode}`);
}

export async function sendEmailReport(payload: {
    subject: string;
    bodyHtml: string;
    pdfBase64?: string;
    filename?: string;
    fromName: string;
}): Promise<void> {
    const res = await authorizedFetch("/api/email-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        await throwForErrorResponse(
            res,
            `Email report failed (${res.status})`
        );
    }
}

export async function deleteTestCases(
    items: DeleteTestCaseItem[]
): Promise<DeleteTestCasesResult> {
    const res = await authorizedFetch("/api/test-cases/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
    });

    if (!res.ok) {
        await throwForErrorResponse(
            res,
            `Delete failed (${res.status})`
        );
    }

    return res.json();
}

export async function postRefresh(): Promise<void> {
    const res = await authorizedFetch("/api/refresh", {
        method: "POST",
    });

    if (!res.ok) {
        await throwForErrorResponse(
            res,
            `Refresh failed (${res.status})`
        );
    }
}
