import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Tab, TabList, makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { DefectFilterBar } from "../components/DefectFilterBar";
import { DefectOverviewTab } from "../components/DefectOverviewTab";
import { DefectQualityTab } from "../components/DefectQualityTab";
import { DefectResourceTab } from "../components/DefectResourceTab";
import { SprintDefectStatsTab } from "../components/SprintDefectStatsTab";
import { fetchDefects } from "../api/client";
import type { DefectFilters } from "../types";

type DefectTab = "sprintReport" | "overview" | "quality" | "resource";

const useStyles = makeStyles({
    toolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
});

const EMPTY_FILTERS: DefectFilters = {
    iteration: "",
    area: "",
    environment: "",
    targetVersion: "",
    suites: [],
};

export function DefectManagementPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const [filters, setFilters] = useState<DefectFilters>(EMPTY_FILTERS);
    const [tab, setTab] = useState<DefectTab>("sprintReport");

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["defects", filters],
        queryFn: () => fetchDefects(filters),
    });

    return (
        <PageLayout title={t("defectManagementPage.title")}>
            {isLoading && <LoadingCardGrid />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data && (
                <>
                    <DefectFilterBar
                        availableFilters={data.stats.availableFilters}
                        filters={filters}
                        onChange={setFilters}
                    />

                    <div className={styles.toolbar}>
                        <TabList
                            selectedValue={tab}
                            onTabSelect={(_, item) =>
                                setTab(item.value as DefectTab)
                            }
                        >
                            <Tab value="sprintReport">
                                {t("defectManagementPage.tabs.sprintReport")}
                            </Tab>
                            <Tab value="overview">
                                {t("defectManagementPage.tabs.overview")}
                            </Tab>
                            <Tab value="quality">
                                {t("defectManagementPage.tabs.quality")}
                            </Tab>
                            <Tab value="resource">
                                {t("defectManagementPage.tabs.resource")}
                            </Tab>
                        </TabList>
                    </div>

                    {tab === "sprintReport" && (
                        <SprintDefectStatsTab stats={data.stats} />
                    )}
                    {tab === "overview" && (
                        <DefectOverviewTab stats={data.stats} />
                    )}
                    {tab === "quality" && (
                        <DefectQualityTab stats={data.stats} />
                    )}
                    {tab === "resource" && (
                        <DefectResourceTab stats={data.stats} />
                    )}
                </>
            )}
        </PageLayout>
    );
}
