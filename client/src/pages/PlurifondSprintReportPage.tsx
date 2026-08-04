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
import type { SuiteGroupDef } from "../components/SprintDefectReportTab";
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

// Plurifond bugs are always scoped to these three suites (matched on the
// bug's Custom.Suite field, same as the org-wide Sprint Report's suite
// filter) - fixed rather than user-editable, so "suites" is left out of the
// DefectFilterBar fields below.
const PLURIFOND_BUG_SUITES = ["Tranche 1"];

const EMPTY_FILTERS: DefectFilters = {
    iteration: "",
    area: "",
    environment: "",
    targetVersion: "",
    suites: PLURIFOND_BUG_SUITES,
};

// Plurifond Sprint 1 only tracks Test Factory for now - the whole plan
// (7414, 70 test cases), not a specific suite within it - no Test
// Business/Test Agenti breakdown exists for this project yet.
const PLURIFOND_SUITE_GROUP_DEFS: SuiteGroupDef[] = [
    {
        label: "Test Factory",
        planId: 7414,
    },
];

export function PlurifondSprintReportPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const [filters, setFilters] = useState<DefectFilters>(EMPTY_FILTERS);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["defects", filters],
        queryFn: () => fetchDefects(filters),
    });

    return (
        <PageLayout title={t("plurifondSprintReportPage.title")}>
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
                            fields={["iteration", "area"]}
                        />

                        <IterationFilter
                            value={filters.iteration}
                            onChange={(iteration) =>
                                setFilters({ ...filters, iteration })
                            }
                        />
                    </div>

                    <SprintDefectReportTab
                        stats={data.stats}
                        suiteGroupDefs={PLURIFOND_SUITE_GROUP_DEFS}
                        defaultHeaderTitle="Test Funzionali - Plurifonds"
                        defaultHeaderSubtitle="Stato avanzamento test funzionali – Plurifonds"
                        defaultActionsText={(report) => {
                            let outOfScopeLine = "";
                            if (report.outOfScopeCount > 0) {
                                const isPlural = report.outOfScopeCount > 1;
                                outOfScopeLine = `* escluso${isPlural ? "i" : ""} ${report.outOfScopeCount} bug segnalat${isPlural ? "i" : "o"} come fuori ambito.\n\n`;
                            }

                            return (
                                `System Integrator: inserire entro la giornata di oggi le date di risoluzione previste per i ${report.withoutResolutionDateCount} bug aperti.\n` +
                                outOfScopeLine +
                                "Test funzionali: Avviati i test funzionali per Plurifonds in data 27/07: Rilevato un numero significativo di test case non eseguibili, poiché associati a funzionalità non ancora rilasciate ma incluse nel piano di test condiviso.\n\n"
                            );
                        }}
                        includeDsiSource={false}
                        includeDeadline={false}
                    />
                </>
            )}
        </PageLayout>
    );
}
