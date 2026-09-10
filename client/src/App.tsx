import { lazy, Suspense, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner } from "@fluentui/react-components";
import { fetchProjects, type ApiError } from "./api/client";
import { AzdoConnectionError } from "./components/AzdoConnectionError";
import { GettingStartedGuide } from "./components/GettingStartedGuide";
import { PatSetup } from "./components/PatSetup";
import { useAzdoConnection } from "./azdoConnection";

// This branch ships the Sprint Report plus the multi-scope Excel Export page -
// every other page's lazy import is dropped so its chunk is never even
// referenced, not just deferred, to keep the query/loading footprint minimal.
const DynamicSprintReportPage = lazy(() =>
    import("./pages/DynamicSprintReportPage").then((m) => ({ default: m.DynamicSprintReportPage }))
);
const ExcelExportPage = lazy(() =>
    import("./pages/ExcelExportPage").then((m) => ({ default: m.ExcelExportPage }))
);
const CoverageRoadmapPage = lazy(() =>
    import("./pages/CoverageRoadmapPage").then((m) => ({ default: m.CoverageRoadmapPage }))
);
const CycleTimeReportPage = lazy(() =>
    import("./pages/CycleTimeReportPage").then((m) => ({ default: m.CycleTimeReportPage }))
);
const AutomationKpiPage = lazy(() =>
    import("./pages/AutomationKpiPage").then((m) => ({ default: m.AutomationKpiPage }))
);
const E2eHistoryPage = lazy(() =>
    import("./pages/E2eHistoryPage").then((m) => ({ default: m.E2eHistoryPage }))
);
const TestSuitesPage = lazy(() =>
    import("./pages/TestSuitesPage").then((m) => ({ default: m.TestSuitesPage }))
);

function PageFallback() {
    return (
        <div style={{ display: "flex", justifyContent: "center", padding: "48px" }}>
            <Spinner label="Loading..." />
        </div>
    );
}

function AppRoutes() {
    return (
        <Suspense fallback={<PageFallback />}>
            <Routes>
                <Route
                    path="/dynamic-sprint-report"
                    element={<DynamicSprintReportPage />}
                />
                <Route path="/excel-export" element={<ExcelExportPage />} />
                <Route
                    path="/coverage-roadmap"
                    element={<CoverageRoadmapPage />}
                />
                <Route
                    path="/cycle-time"
                    element={<CycleTimeReportPage />}
                />
                <Route
                    path="/automation-kpis"
                    element={<AutomationKpiPage />}
                />
                <Route
                    path="/e2e-history"
                    element={<E2eHistoryPage />}
                />
                <Route
                    path="/test-suites"
                    element={<TestSuitesPage />}
                />
                <Route
                    path="*"
                    element={<Navigate to="/dynamic-sprint-report" replace />}
                />
            </Routes>
        </Suspense>
    );
}

const ONBOARDING_SEEN_KEY = "azureDashboardOnboardingSeen";
const SCOPE_STORAGE_KEY = "azureDashboardScope";

// No sign-in wall: access is gated on whether the server's AZDO_PAT actually
// works, not on a Microsoft identity. /api/projects is the cheapest call
// that exercises it (and the same query ScopeBar makes right after, so this
// just primes its cache rather than firing a second request). A PAT
// failure - not just "still loading" - renders AzdoConnectionError instead
// of a dashboard full of per-widget error banners.
function App() {
    const queryClient = useQueryClient();
    const { connection, saveConnection, clearConnection } = useAzdoConnection();
    const { isLoading, isError, error, refetch } = useQuery({
        queryKey: ["projects", connection?.org],
        queryFn: fetchProjects,
        enabled: connection != null,
    });

    // Shown once per browser the first time the app loads successfully;
    // reachable again anytime after via the Help button in TopBar.tsx.
    const [guideOpen, setGuideOpen] = useState(
        () => localStorage.getItem(ONBOARDING_SEEN_KEY) !== "true"
    );

    const closeGuide = () => {
        localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
        setGuideOpen(false);
    };

    const resetLocalState = () => {
        localStorage.removeItem(SCOPE_STORAGE_KEY);
        void queryClient.cancelQueries();
        queryClient.clear();
    };

    if (!connection) {
        return (
            <PatSetup
                onSave={(nextConnection) => {
                    saveConnection(nextConnection);
                    resetLocalState();
                    window.location.reload();
                }}
            />
        );
    }

    if (isLoading) {
        return <PageFallback />;
    }

    if (isError) {
        const apiError = error as ApiError | null;

        return (
            <AzdoConnectionError
                message={apiError?.message}
                restricted={apiError?.code === "domain_not_allowed"}
                onRetry={() => void refetch()}
                onChangeConnection={() => {
                    clearConnection();
                    resetLocalState();
                    window.location.reload();
                }}
            />
        );
    }

    return (
        <>
            <AppRoutes />
            <GettingStartedGuide open={guideOpen} onClose={closeGuide} />
        </>
    );
}

export default App;
