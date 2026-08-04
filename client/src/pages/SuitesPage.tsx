import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { CardGrid } from "../components/CardGrid";
import { SuiteCard } from "../components/SuiteCard";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { ExportMenu, type ExportFormat } from "../components/ExportMenu";
import { fetchSuites } from "../api/client";
import { exportToCsv, exportToExcel, exportToPdf } from "../utils/export";

const useStyles = makeStyles({
    toolbar: {
        display: "flex",
        justifyContent: "flex-end",
        gap: tokens.spacingHorizontalM,
    },
});

export function SuitesPage() {
    const styles = useStyles();
    const { t } = useTranslation();
    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["suites"],
        queryFn: fetchSuites,
    });

    const handleExport = (format: ExportFormat) => {
        if (!data) {
            return;
        }

        const suiteBugTotals = Object.entries(data)
            .map(([suiteName, stat]) => ({
                suiteName,
                totalBugs: stat.openBugs,
            }))
            .sort((a, b) => a.suiteName.localeCompare(b.suiteName));
        const filename = `suites-export-${Date.now()}`;
        const title = t("common.title");

        if (format === "csv") {
            exportToCsv(filename, [], suiteBugTotals);
        } else if (format === "excel") {
            void exportToExcel(filename, [], suiteBugTotals);
        } else {
            exportToPdf(filename, title, [], suiteBugTotals);
        }
    };

    return (
        <PageLayout title={t("common.title")}>
            <div className={styles.toolbar}>
                <ExportMenu
                    onExport={handleExport}
                    disabled={!data || Object.keys(data).length === 0}
                />
            </div>

            {isLoading && <LoadingCardGrid />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data &&
                (Object.keys(data).length === 0 ? (
                    <EmptyState message={t("suitesPage.empty")} />
                ) : (
                    <CardGrid>
                        {Object.entries(data)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([suiteName, stat]) => (
                                <SuiteCard
                                    key={suiteName}
                                    suiteName={suiteName}
                                    stat={stat}
                                />
                            ))}
                    </CardGrid>
                ))}
        </PageLayout>
    );
}
