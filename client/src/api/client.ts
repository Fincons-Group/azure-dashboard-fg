import type {
    TestPlanSummary,
    DefectDashboardResponse,
    DefectFilters,
    PlanOverviewResponse,
    IterationNode,
    ProjectSummary,
    AreaPathNode,
    CoverageArea,
    CycleTimeResponse,
    AutomationKpiResponse,
    ReportExtraKpis,
    E2eHistoryResponse,
} from "../types";
import i18n from "../i18n";
import { loadStoredAzdoConnection } from "../azdoConnection";

const LOCAL_API_BASE_URL = "http://localhost:4174";

// Exported so callers that build a plain <a href> (e.g. TestSuitesPage's
// report links) resolve against the actual API origin instead of whatever
// origin the link gets clicked from - a relative path there breaks whenever
// the client and server aren't guaranteed same-origin (this packaged app's
// GitHub Pages + local-server deployment, or plain multi-port dev).
export function getApiBaseUrl(): string {
    if (import.meta.env.VITE_API_BASE_URL) {
        return import.meta.env.VITE_API_BASE_URL;
    }

    return window.location.port === "4173" ? LOCAL_API_BASE_URL : "";
}

function buildRequestHeaders(
    headers?: HeadersInit
): Headers {
    const nextHeaders = new Headers(headers);
    const connection = loadStoredAzdoConnection();

    if (connection?.pat) {
        nextHeaders.set("x-ado-pat", connection.pat);
    }

    if (connection?.org) {
        nextHeaders.set("x-ado-org", connection.org);
    }

    return nextHeaders;
}

async function apiFetch(
    path: string,
    init: RequestInit = {}
): Promise<Response> {
    return fetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        headers: buildRequestHeaders(init.headers),
    });
}

// `code` lets callers (AzdoConnectionError) branch on *why* a request
// failed without matching on message text - currently only ever
// "domain_not_allowed" (see the server's AzdoDomainError/sendApiError).
export class ApiError extends Error {
    code?: string;

    constructor(message: string, code?: string) {
        super(message);
        this.name = "ApiError";
        this.code = code;
    }
}

async function throwForErrorResponse(
    res: Response,
    fallbackMessage: string
): Promise<never> {
    const body = await res.json().catch(() => null);

    if (body?.message) {
        throw new ApiError(body.message, body.code);
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
    const res = await apiFetch(url);

    if (!res.ok) {
        await throwForErrorResponse(
            res,
            `Request to ${url} failed (${res.status})`
        );
    }

    return res.json();
}

export function fetchPlans(
    project?: string,
    areaPath?: string,
    iteration?: string
): Promise<TestPlanSummary[]> {
    const params = new URLSearchParams();

    if (project) params.set("project", project);
    if (areaPath) params.set("areaPath", areaPath);
    if (iteration) params.set("iteration", iteration);

    const qs = params.toString();

    return getJson(`/api/plans${qs ? `?${qs}` : ""}`);
}

export function fetchIterations(project?: string): Promise<IterationNode[]> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";

    return getJson(`/api/iterations${qs}`);
}

export function fetchProjects(): Promise<ProjectSummary[]> {
    return getJson("/api/projects");
}

export function fetchAreaPaths(project: string): Promise<AreaPathNode[]> {
    return getJson(`/api/areas?project=${encodeURIComponent(project)}`);
}

export function fetchPlanOverview(
    planId: number,
    project?: string
): Promise<PlanOverviewResponse> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";

    return getJson(`/api/plans/${planId}/overview${qs}`);
}

export function fetchCoverage(project?: string): Promise<CoverageArea[]> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";

    return getJson(`/api/coverage${qs}`);
}

export function fetchCycleTime(project?: string): Promise<CycleTimeResponse> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";

    return getJson(`/api/cycle-time${qs}`);
}

export function fetchAutomationKpis(
    project?: string
): Promise<AutomationKpiResponse> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";

    return getJson(`/api/automation-kpis${qs}`);
}

// Companion call to fetchDefects/fetchPlanOverview for the Sprint Report's
// 4 additional KPIs - see ReportExtraKpis in types.ts for why this is kept
// as its own request instead of folded into either of those.
export function fetchReportExtraKpis(
    project?: string,
    area?: string,
    iteration?: string,
    planIds?: number[]
): Promise<ReportExtraKpis> {
    const params = new URLSearchParams();

    if (project) params.set("project", project);
    if (area) params.set("area", area);
    if (iteration) params.set("iteration", iteration);
    planIds?.forEach((planId) => params.append("planId", String(planId)));

    const qs = params.toString();

    return getJson(`/api/report-extra-kpis${qs ? `?${qs}` : ""}`);
}

export function fetchE2eHistory(limit?: number): Promise<E2eHistoryResponse> {
    const qs = limit ? `?limit=${limit}` : "";

    return getJson(`/api/e2e-history${qs}`);
}

export function fetchDefects(
    filters?: DefectFilters,
    project?: string
): Promise<DefectDashboardResponse> {
    const params = new URLSearchParams();

    if (filters?.iteration) params.set("iteration", filters.iteration);
    if (filters?.area) params.set("area", filters.area);
    if (filters?.environment) params.set("environment", filters.environment);
    if (filters?.targetVersion) params.set("targetVersion", filters.targetVersion);
    if (project) params.set("project", project);
    filters?.suites?.forEach((suite) => params.append("suite", suite));

    const qs = params.toString();

    return getJson(`/api/defects${qs ? `?${qs}` : ""}`);
}

export interface RefreshResult {
    refreshed: boolean;
    retryAfterMs?: number;
}

export async function postRefresh(): Promise<RefreshResult> {
    const res = await apiFetch("/api/refresh", {
        method: "POST",
    });

    if (!res.ok) {
        await throwForErrorResponse(
            res,
            `Refresh failed (${res.status})`
        );
    }

    return res.json();
}
