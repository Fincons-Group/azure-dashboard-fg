import { useTranslation } from "react-i18next";
import { CardGrid } from "./CardGrid";
import { StatCard } from "./StatCard";
import type { DashboardStats } from "../types";

export function ExecutionMetrics({ stats }: { stats: DashboardStats }) {
    const { t } = useTranslation();

    return (
        <CardGrid>
            <StatCard
                label={t("testExecutionPage.metrics.total")}
                value={stats.totalTestCases}
            />
            <StatCard
                label={t("testExecutionPage.metrics.executed")}
                value={stats.executedCount}
            />
            <StatCard
                label={t("testExecutionPage.metrics.passed")}
                value={stats.passedCount}
            />
            <StatCard
                label={t("testExecutionPage.metrics.failed")}
                value={stats.failedCount}
            />
            <StatCard
                label={t("testExecutionPage.metrics.blocked")}
                value={stats.blockedCount}
            />
            <StatCard
                label={t("testExecutionPage.metrics.notApplicable")}
                value={stats.notApplicableCount}
            />
            <StatCard
                label={t("testExecutionPage.metrics.notRun")}
                value={stats.notRunCount}
            />
        </CardGrid>
    );
}
