import type {
    TestPlanSummary,
    DefectDashboardResponse,
    DefectFilters,
    PlanOverviewResponse,
    IterationNode,
    ProjectSummary,
    AreaPathNode,
} from "../types";
import i18n from "../i18n";
import { loadStoredAzdoConnection } from "../azdoConnection";

const LOCAL_API_BASE_URL = "http://localhost:4174";

function getApiBaseUrl(): string {
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
