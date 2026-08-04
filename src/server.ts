import "dotenv/config";
import express, { type Response } from "express";
import cors from "cors";
import { requireAuth } from "./auth.js";
import { AzdoAuthError, getIterations } from "./azdo.js";
import {
    getDashboardData,
    clearDashboardCache,
    getCacheTimestamp,
    computeDashboardStats,
    computeSuiteStats,
    computeRunCards,
    computeExecutionTrend,
    computeTestPlans,
    computePlanSuites,
    deleteTestCases,
} from "./dashboardData.js";
import {
    getAutomationDashboard,
    clearAutomationCache,
} from "./automationData.js";
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
    getCommonErrorsData,
    getCommonErrorsCacheTimestamp,
    clearCommonErrorsCache,
} from "./errorAggregationData.js";
import {
    getAssignedWorkItems,
    getMentionedWorkItems,
    getFollowedWorkItems,
    getCreatedWorkItems,
} from "./myWorkItemsData.js";
import { sendReportEmail } from "./mailer.js";
import {
    computePlanOverview,
    clearPlanOverviewCache,
} from "./planOverviewData.js";
import {
    computeTestPlanProgress,
    clearTestPlanProgressCache,
    computeTestPlanProgressBugs,
    clearTestPlanProgressBugsCache,
} from "./testPlanProgressData.js";
import {
    computeReleaseReadiness,
    clearReleaseReadinessCache,
    countOpenBySeverity,
} from "./releaseReadinessData.js";
import {
    startBugSummaryScheduler,
    startSprintReportFileExportScheduler,
} from "./scheduler.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "15mb" }));

app.use("/api", requireAuth);

// AzdoAuthError means Azure DevOps rejected our AZDO_PAT (usually expired or
// revoked) - surface it as 502 Bad Gateway so the client can tell it apart
// from an ordinary server-side bug and show a specific, actionable message.
function sendApiError(res: Response, error: any): void {
    console.error(error);

    if (error instanceof AzdoAuthError) {
        res.status(502).json({ message: error.message });
        return;
    }

    res.status(500).json({ message: error.message });
}

app.get("/api/suites", async (_, res) => {
    try {
        const allTestCases =
            await getDashboardData();

        res.json(
            computeSuiteStats(allTestCases)
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/dashboard", async (req, res) => {
    try {
        const allTestCases =
            await getDashboardData();

        const iteration = req.query.iteration as
            | string
            | undefined;

        const scoped = iteration
            ? allTestCases.filter(
                  (tc) => tc.iteration === iteration
              )
            : allTestCases;

        res.json({
            stats: computeDashboardStats(
                scoped
            ),
            cacheTimestamp: getCacheTimestamp(),
        });
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/runs", async (_, res) => {
    try {
        res.json(await computeRunCards());
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/execution-trend", async (_, res) => {
    try {
        const [trend, allTestCases] =
            await Promise.all([
                computeExecutionTrend(),
                getDashboardData(),
            ]);

        res.json({
            trend,
            totalTestCases: allTestCases.length,
        });
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/iterations", async (_, res) => {
    try {
        res.json(await getIterations());
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans", async (_, res) => {
    try {
        res.json(await computeTestPlans());
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans/:planId/suites", async (req, res) => {
    try {
        const planId = Number(req.params.planId);

        res.json(await computePlanSuites(planId));
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans/:planId/overview", async (req, res) => {
    try {
        const planId = Number(req.params.planId);

        res.json(await computePlanOverview(planId));
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans/:planId/progress", async (req, res) => {
    try {
        const planId = Number(req.params.planId);

        res.json(await computeTestPlanProgress(planId));
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/plans/:planId/progress/bugs", async (req, res) => {
    try {
        const planId = Number(req.params.planId);
        const suiteIdsParam = req.query.suiteIds as string | undefined;
        const suiteIds = suiteIdsParam
            ? suiteIdsParam
                  .split(",")
                  .map(Number)
                  .filter(Number.isFinite)
            : undefined;

        res.json(await computeTestPlanProgressBugs(planId, suiteIds));
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/release-readiness", async (req, res) => {
    if (process.env.ENABLE_RELEASE_READINESS !== "true") {
        res.status(403).json({
            message: "Release readiness is disabled.",
        });

        return;
    }

    try {
        res.json(
            await computeReleaseReadiness(
                req.query.iteration as string | undefined
            )
        );
    } catch (error: any) {
        console.error(error);

        res.status(500).json({
            message: error.message,
        });
    }
});

app.get("/api/nav-badges", async (_, res) => {
    try {
        const records = await getDefectData();
        const counts = countOpenBySeverity(records);

        res.json({
            openCriticalHighDefects:
                counts["1 - Critical"] + counts["2 - High"],
        });
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.post("/api/test-cases/delete", async (req, res) => {
    const items = Array.isArray(req.body?.items)
        ? req.body.items
              .map((item: any) => ({
                  planId: Number(item?.planId),
                  suiteId: Number(item?.suiteId),
                  testCaseId: Number(item?.testCaseId),
              }))
              .filter(
                  (item: {
                      planId: number;
                      suiteId: number;
                      testCaseId: number;
                  }) =>
                      Number.isInteger(item.planId) &&
                      Number.isInteger(item.suiteId) &&
                      Number.isInteger(item.testCaseId)
              )
        : [];

    if (items.length === 0) {
        res.status(400).json({
            message: "items is required",
        });

        return;
    }

    try {
        const result = await deleteTestCases(items);

        if (result.deleted.length > 0) {
            clearAutomationCache();
            clearPlanOverviewCache();
            clearTestPlanProgressCache();
            clearTestPlanProgressBugsCache();
        }

        res.json(result);
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/automation", async (req, res) => {
    try {
        const planId = Number(req.query.planId);
        const iteration = req.query.iteration as
            | string
            | undefined;

        res.json(
            await getAutomationDashboard(
                Number.isFinite(planId)
                    ? planId
                    : undefined,
                iteration
            )
        );
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/defects", async (req, res) => {
    try {
        const [records, storyCount, storyPointsByArea, allSuiteNames] =
            await Promise.all([
                getDefectData(),
                getStoryCount(),
                getStoryPointsByArea(),
                getAllSuiteNames(),
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
            cacheTimestamp: getDefectCacheTimestamp(),
        });
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.get("/api/common-errors", async (_, res) => {
    try {
        const { errors, totalFailedResults } =
            await getCommonErrorsData();

        res.json({
            errors,
            totalFailedResults,
            cacheTimestamp:
                getCommonErrorsCacheTimestamp(),
        });
    } catch (error: any) {
        sendApiError(res, error);
    }
});
app.get("/api/my-work-items", async (req, res) => {
    try {
        const mode = req.query.mode;

        const items =
            mode === "mentioned"
                ? await getMentionedWorkItems()
                : mode === "following"
                    ? await getFollowedWorkItems()
                    : mode === "created"
                        ? await getCreatedWorkItems()
                        : await getAssignedWorkItems();

        res.json(items);
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.post("/api/email-report", async (req, res) => {
    const toEmails = (process.env.SEND_MAIL_TO ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean);

    if (process.env.ENABLE_EMAIL_REPORT !== "true" || toEmails.length === 0) {
        res.status(403).json({
            message: "Email report is disabled.",
        });

        return;
    }

    const { subject, bodyHtml, pdfBase64, filename, fromName } =
        req.body as {
            subject?: string;
            bodyHtml?: string;
            pdfBase64?: string;
            filename?: string;
            fromName?: string;
        };

    if (!subject) {
        res.status(400).json({
            message: "subject is required.",
        });

        return;
    }

    try {
        await sendReportEmail({
            to: toEmails,
            subject,
            bodyHtml: bodyHtml ?? "",
            pdfBase64,
            filename,
            fromName: fromName ?? "QA Dashboard",
        });

        res.status(204).end();
    } catch (error: any) {
        sendApiError(res, error);
    }
});

app.post("/api/refresh", (_, res) => {
    clearDashboardCache();
    clearDefectCache();
    clearCommonErrorsCache();
    clearAutomationCache();
    clearPlanOverviewCache();
    clearTestPlanProgressCache();
    clearTestPlanProgressBugsCache();
    clearReleaseReadinessCache();

    res.status(204).end();
});


startBugSummaryScheduler();
startSprintReportFileExportScheduler();

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
    console.log(
        `Running on http://localhost:${port}`
    );
});
