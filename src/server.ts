import "dotenv/config";
import express, { type Response } from "express";
import cors from "cors";
import axios from "axios";
import {
    AzdoAuthError,
    AzdoConfigError,
    AzdoDomainError,
    assertAllowedDomain,
    getIterations,
    getAreaPaths,
    getProjects,
    getSuites,
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
import {
    getCoverageRoadmap,
    clearCoverageCache,
} from "./coverageData.js";
import {
    getCycleTimeReport,
    clearCycleTimeCache,
} from "./cycleTimeData.js";
import {
    getAutomationKpis,
    clearAutomationKpiCache,
} from "./automationKpiData.js";
import {
    getQaControlCenter,
    clearQaControlCenterCache,
} from "./qaControlCenterData.js";
import { computeReportExtraKpis } from "./reportExtraKpis.js";
import {
    getE2eRunHistory,
    clearE2eHistoryCache,
    FirebaseConfigError,
} from "./firebaseE2eData.js";
import {
    getTestSuiteRuns,
    clearTestSuiteRunsCache,
    getSignedReportFileUrl,
} from "./firebaseTestSuitesData.js";
import {
    getSpecCatalog,
    clearSpecCatalogCache,
} from "./testSpecCatalogData.js";
import {
    sendBugsCreatedTodayReport,
    sendVerificaCheck,
} from "./notificationTriggers.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "15mb" }));

// Dev convenience: serves local Playwright/SmartReport output so the E2E
// History page's "View" link resolves to something real while testing
// against a laptop-local tst-e2e checkout. Unset in every other deployment -
// the real pipeline (Part C of docs/e2e-firebase-integration-plan.md) will
// publish reportUrl pointing at wherever CI uploads the report instead.
if (process.env.E2E_REPORTS_DIR) {
    app.use("/e2e-reports", express.static(process.env.E2E_REPORTS_DIR));
}

// Same dev convenience as E2E_REPORTS_DIR above, for the NRT/A11Y/Security Test
// Suites hub: point this at a local tst-e2e checkout's `reports/` folder
// (the parent of its runs/, a11y/, and zap/ subfolders) so TestSuitesPage's
// "Open ..." links resolve to the real smart-report.html / a11y/index.html /
// ZAP report instead of a dead button, for runs whose Firestore document
// (see firebaseTestSuitesData.ts) has no reportUrl of its own yet - this
// only serves the static files reportFile's relative paths point at.
if (process.env.TEST_SUITES_REPORTS_DIR) {
    app.use("/test-suites-reports", express.static(process.env.TEST_SUITES_REPORTS_DIR));
}

// Scoped to /api - the static report routes above (and any request that
// falls through them, e.g. a missing E2E_REPORTS_DIR/TEST_SUITES_REPORTS_DIR
// file) never call Azure DevOps at all, so they shouldn't need a PAT to
// resolve. Without this scoping, an unconfigured/missing report file used to
// fall through to this gate and surface a confusing "Missing Azure DevOps
// PAT" error instead of a plain 404.
app.use("/api", (req, res, next) => {
    runWithAzdoConfig(
        {
            pat: req.header("x-ado-pat") ?? undefined,
            org: req.header("x-ado-org") ?? undefined,
            project: req.header("x-ado-project") ?? undefined,
        },
        () => {
            // Gate every /api route behind the PAT's owner, not just the
            // ones that happen to call azdo.ts - a request must resolve to
            // an allowed account before it can reach any handler below.
            assertAllowedDomain()
                .then(next)
                .catch((error) => sendApiError(res, error));
        }
    );
});

// AzdoAuthError means Azure DevOps rejected our AZDO_PAT (usually expired or
// revoked) - surface it as 502 Bad Gateway so the client can tell it apart
// from an ordinary server-side bug and show a specific, actionable message.
function sendApiError(res: Response, error: any): void {
    // Never log the raw error: every azdo.ts client carries the shared PAT
    // as a default Authorization header (createAzdoClient), and Node prints
    // an AxiosError's own enumerable properties - including `config.headers`
    // - alongside its stack trace. Logging the raw object would leak the PAT
    // to server logs on every ordinary Azure DevOps hiccup. Mirrors the safe
    // logging shape already used by azdo.ts's fetchAuthenticatedEmail.
    if (axios.isAxiosError(error)) {
        console.error({
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
            url: error.config?.baseURL
                ? error.config.baseURL + (error.config?.url ?? "")
                : error.config?.url,
        });
    } else {
        console.error(error);
    }

    if (error instanceof AzdoAuthError) {
        res.status(502).json({ message: error.message });
        return;
    }

    if (error instanceof AzdoDomainError) {
        res.status(403).json({
            message: error.message,
            code: "domain_not_allowed",
        });
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

app.get("/api/plans/:planId/suites", async (req, res) => {
    try {
        const planId = Number(req.params.planId);
        const project = req.query.project as string | undefined;
        const suites = await getSuites(planId, project);

        res.json(
            suites.map((suite: any) => ({
                id: suite.id,
                name: suite.name,
                parentId: suite.parentSuite?.id,
            }))
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

// Replicates the "QA Control Center" ADO dashboard widget (see
// qaControlCenterData.ts for the full port) - ADO blocks that dashboard from
// being framed here (X-Frame-Options: SAMEORIGIN, see TeamDashboardPage.tsx),
// so this renders the same execution-velocity/forecast/workload model
// natively instead, for any plan+suite rather than the one fixed instance.
app.get("/api/qa-control-center", async (req, res) => {
    try {
        const planId = Number(req.query.planId);
        const suiteId = Number(req.query.suiteId);
        const project = req.query.project as string | undefined;
        const includeChildren = req.query.includeChildren !== "false";

        if (!planId || !suiteId) {
            res.status(400).json({ message: "planId and suiteId are required." });
            return;
        }

        res.json(
            await getQaControlCenter(planId, suiteId, project, includeChildren)
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

// Companion endpoint to /api/defects + /api/plans/:planId/overview for the
// Sprint Report's additional KPIs - kept as its own route (rather than
// folded into either response) because firstExecutionPassRate requires
// enumerating Azure DevOps test run history, which is heavier than
// everything else the report fetches and benefits from its own cache and
// client-side loading state (see DynamicSprintReportPage.tsx).
app.get("/api/report-extra-kpis", async (req, res) => {
    try {
        const planId = req.query.planId;
        const planIds = (
            Array.isArray(planId)
                ? (planId as string[])
                : planId
                ? [planId as string]
                : []
        ).map(Number);

        res.json(
            await computeReportExtraKpis({
                project: req.query.project as string | undefined,
                area: req.query.area as string | undefined,
                iteration: req.query.iteration as string | undefined,
                planIds,
            })
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/coverage", async (req, res) => {
    try {
        res.json(
            await getCoverageRoadmap(
                req.query.project as string | undefined
            )
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/cycle-time", async (req, res) => {
    try {
        res.json(
            await getCycleTimeReport(
                req.query.project as string | undefined
            )
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/automation-kpis", async (req, res) => {
    try {
        res.json(
            await getAutomationKpis(
                req.query.project as string | undefined
            )
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

// Not gated on Firebase being configured at all - returns { runs: [],
// configured: false } instead of an error until
// FIREBASE_SERVICE_ACCOUNT_JSON is set, so the E2E History page can show a
// setup hint rather than an error banner (see FirebaseConfigError in
// firebaseE2eData.ts).
app.get("/api/e2e-history", async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 30;

        res.json({
            runs: await getE2eRunHistory(limit),
            configured: true,
        });
    } catch (error: any) {
        if (error instanceof FirebaseConfigError) {
            res.json({ runs: [], configured: false });
            return;
        }

        sendApiError(res, error);
    }
});

// Same "not configured" shape as /api/e2e-history above - lets TestSuitesPage
// show a setup hint instead of an error banner when FIREBASE_SERVICE_ACCOUNT_JSON
// isn't set.
app.get("/api/test-suites", async (_req, res) => {
    try {
        res.json({
            runs: await getTestSuiteRuns(),
            configured: true,
        });
    } catch (error: any) {
        if (error instanceof FirebaseConfigError) {
            res.json({ runs: [], configured: false });
            return;
        }

        sendApiError(res, error);
    }
});

// Backs TestSuiteRun.reportUrl (see its comment in types.ts) - sits behind
// /api's assertAllowedDomain() gate above like every other route, so it
// needs the same PAT header as any other API call, not just a knowable URL.
// Returns a fresh short-lived signed URL rather than redirecting straight to
// Storage, since the client can't follow a redirect through a plain <a
// href> without losing that PAT-based gate - see TestSuitesPage.tsx's
// report button.
const REPORT_FILENAME_ALLOWLIST = new Set([
    "smart-report.html",
    "smart-report.pdf",
    "smart-report-dark.pdf",
    "smart-report-minimal.pdf",
]);

app.get("/api/test-suites-reports/runs/:runId/:filename", async (req, res) => {
    if (!REPORT_FILENAME_ALLOWLIST.has(req.params.filename)) {
        res.status(404).json({ message: "Unknown report file." });
        return;
    }

    try {
        const url = await getSignedReportFileUrl(req.params.runId, req.params.filename);

        if (!url) {
            res.status(404).json({ message: "Report not found." });
            return;
        }

        res.json({ url });
    } catch (error: any) {
        sendApiError(res, error);
    }
});

// "As they are" spec-file inventory (see testSpecCatalogData.ts) - NRT/A11Y/
// Security tabs of real Playwright spec files from the tst-e2e checkout,
// each with whatever run history/errors are available. "configured" here
// means the spec-path list has been published to Firestore (see
// scripts/publish-spec-catalog.js) - independent of the Azure DevOps gate
// this route sits behind, which only affects the title-enrichment lookup.
app.get("/api/test-spec-catalog", async (req, res) => {
    try {
        res.json(await getSpecCatalog(req.query.project as string | undefined));
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
    clearCoverageCache();
    clearCycleTimeCache();
    clearAutomationKpiCache();
    clearE2eHistoryCache();
    clearTestSuiteRunsCache();
    clearSpecCatalogCache();
    clearQaControlCenterCache();

    res.status(200).json({ refreshed: true });
});

// Triggered by an external scheduler (see functions/) rather than a browser,
// so it sits outside the /api PAT-forwarding gate above - it runs against
// this server's own AZDO_PAT env var (see getCurrentConfig's fallback in
// azdo.ts), not a per-request header. Gated by a shared secret instead of a
// PAT/domain check since there's no end-user identity here to check against.
function requireCronSecret(req: express.Request, res: Response): boolean {
    const expected = process.env.INTERNAL_CRON_SECRET;

    if (!expected) {
        res.status(503).json({
            message: "INTERNAL_CRON_SECRET is not configured on this server.",
        });
        return false;
    }

    if (req.header("x-cron-secret") !== expected) {
        res.status(401).json({ message: "Invalid cron secret." });
        return false;
    }

    return true;
}

app.post("/internal/notify/bugs-created-today", async (req, res) => {
    if (!requireCronSecret(req, res)) return;

    try {
        res.json(await sendBugsCreatedTodayReport());
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.post("/internal/notify/verifica-check", async (req, res) => {
    if (!requireCronSecret(req, res)) return;

    try {
        res.json(await sendVerificaCheck());
    } catch (error: any) {
        sendApiError(res, error);
    }
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
