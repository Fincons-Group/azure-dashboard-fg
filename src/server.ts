import "dotenv/config";
import express, { type Response } from "express";
import cors from "cors";
import {
    AzdoAuthError,
    AzdoConfigError,
    getIterations,
    getAreaPaths,
    getProjects,
    runWithAzdoConfig,
} from "./azdo.js";
import {
    clearDashboardCache,
    computeTestPlans,
} from "./dashboardData.js";
import {
    getDefectData,
    getDefectCacheTimestamp,
    computeDefectStats,
    clearDefectCache,
    getStoryCount,
    getStoryPointsByArea,
    getAllSuiteNames,
    filterRecords,
} from "./defectData.js";
import {
    computePlanOverview,
    clearPlanOverviewCache,
} from "./planOverviewData.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "15mb" }));
app.use((req, _, next) => {
    runWithAzdoConfig(
        {
            pat: req.header("x-ado-pat") ?? undefined,
            org: req.header("x-ado-org") ?? undefined,
            project: req.header("x-ado-project") ?? undefined,
        },
        next
    );
});

// AzdoAuthError means Azure DevOps rejected our AZDO_PAT (usually expired or
// revoked) - surface it as 502 Bad Gateway so the client can tell it apart
// from an ordinary server-side bug and show a specific, actionable message.
function sendApiError(res: Response, error: any): void {
    console.error(error);

    if (error instanceof AzdoAuthError) {
        res.status(502).json({ message: error.message });
        return;
    }

    if (error instanceof AzdoConfigError) {
        res.status(error.statusCode).json({ message: error.message });
        return;
    }

    res.status(500).json({ message: error.message });
}

app.get("/api/projects", async (_, res) => {
    try {
        res.json(await getProjects());
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/areas", async (req, res) => {
    try {
        res.json(
            await getAreaPaths(req.query.project as string | undefined)
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/iterations", async (req, res) => {
    try {
        res.json(
            await getIterations(req.query.project as string | undefined)
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans", async (req, res) => {
    try {
        const plans = await computeTestPlans(
            req.query.project as string | undefined
        );

        const areaPath = req.query.areaPath as string | undefined;
        const iteration = req.query.iteration as string | undefined;

        const scoped = plans.filter(
            (plan) =>
                (!areaPath || plan.areaPath === areaPath) &&
                (!iteration || plan.iteration === iteration)
        );

        res.json(scoped);
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans/:planId/overview", async (req, res) => {
    try {
        const planId = Number(req.params.planId);

        res.json(
            await computePlanOverview(
                planId,
                req.query.project as string | undefined
            )
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/defects", async (req, res) => {
    try {
        const project = req.query.project as string | undefined;

        const [records, storyCount, storyPointsByArea, allSuiteNames] =
            await Promise.all([
                getDefectData(project),
                getStoryCount(project),
                getStoryPointsByArea(project),
                getAllSuiteNames(project),
            ]);

        const filtered = filterRecords(records, {
            iteration: req.query.iteration as
                | string
                | undefined,
            area: req.query.area as string | undefined,
            environment: req.query.environment as
                | string
                | undefined,
            targetVersion: req.query.targetVersion as
                | string
                | undefined,
            suites: (Array.isArray(req.query.suite)
                ? (req.query.suite as string[])
                : req.query.suite
                ? [req.query.suite as string]
                : []
            ),
        });

        res.json({
            stats: computeDefectStats(
                filtered,
                storyCount,
                storyPointsByArea,
                records,
                allSuiteNames
            ),
            cacheTimestamp: getDefectCacheTimestamp(project),
        });
    } catch (error: any) {
        sendApiError(res, error);
    }
});

// Every data module already self-caches for 5 minutes (see e.g.
// dashboardData.ts's CACHE_DURATION_MS), so an organic page load never
// re-hits Azure DevOps more than once per 5 minutes. This handler is the one
// place that can bypass all of those at once (the "Refresh Now" button), and
// it's shared by every user hitting this server - without its own throttle,
// several people clicking it within the same few minutes would each trigger
// a full re-fetch of every dashboard from Azure DevOps. Tracked as a single
// timestamp here (not derived from the per-module cache timestamps) because
// it's guarding the *manual* clear-everything action specifically, separate
// from each module's own organic cache lifetime.
let lastManualRefreshAt = 0;
const MANUAL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

app.post("/api/refresh", (_, res) => {
    const now = Date.now();
    const elapsed = now - lastManualRefreshAt;

    if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) {
        res.status(200).json({
            refreshed: false,
            retryAfterMs: MANUAL_REFRESH_COOLDOWN_MS - elapsed,
        });

        return;
    }

    lastManualRefreshAt = now;

    clearDashboardCache();
    clearDefectCache();
    clearPlanOverviewCache();

    res.status(200).json({ refreshed: true });
});

const port = Number(process.env.PORT) || 3000;

// Defaults to loopback only: this server forwards whatever Azure DevOps PAT
// it receives (see runWithAzdoConfig above) straight through to Azure DevOps,
// so listening on 0.0.0.0 would let anyone else on the same network reach it
// when this is run as the local packaged CLI. A hosted deployment (e.g.
// Render) needs to be reachable from outside its own container, so it must
// set HOST=0.0.0.0 explicitly - there the actual access boundary is CORS_ORIGIN
// above, not the bind address.
const host = process.env.HOST || "127.0.0.1";

app.listen(port, host, () => {
    console.log(
        `Running on http://localhost:${port}`
    );
});
