import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { DefectFilterBar } from "../components/DefectFilterBar";
import { IterationFilter } from "../components/IterationFilter";
import { SprintDefectReportTab } from "../components/SprintDefectReportTab";
import { fetchDefects } from "../api/client";
import type { DefectFilters } from "../types";

const useStyles = makeStyles({
    filters: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalM,
        alignItems: "flex-end",
    },
});

const EMPTY_FILTERS: DefectFilters = {
    iteration: "",
    area: "",
    environment: "",
    targetVersion: "",
    suites: [],
};

export function SprintReportPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const [filters, setFilters] = useState<DefectFilters>(EMPTY_FILTERS);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["defects", filters],
        queryFn: () => fetchDefects(filters),
    });

    return (
        <PageLayout title={t("sprintReportPage.title")}>
            {isLoading && <LoadingCardGrid />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data && (
                <>
                    <div className={styles.filters}>
                        <DefectFilterBar
                            availableFilters={data.stats.availableFilters}
                            filters={filters}
                            onChange={setFilters}
                            fields={["iteration", "area", "suites"]}
                        />

                        <IterationFilter
                            value={filters.iteration}
                            onChange={(iteration) =>
                                setFilters({ ...filters, iteration })
                            }
                        />
                    </div>

                    <SprintDefectReportTab stats={data.stats} />
                </>
            )}
        </PageLayout>
    );
}
