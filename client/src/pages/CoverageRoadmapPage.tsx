import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { CoverageRoadmapTable } from "../components/CoverageRoadmapTable";
import { fetchCoverage } from "../api/client";

const useStyles = makeStyles({
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
});

// This roadmap only ever tracks the Test Factory project's epics - fixed
// rather than driven by the shared ScopeBar project selector, which exists
// for pages that can point at any project.
const PROJECT = "Test Factory";

export function CoverageRoadmapPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["coverage", PROJECT],
        queryFn: () => fetchCoverage(PROJECT),
    });

    return (
        <PageLayout title={t("coverageRoadmapPage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>
                {t("coverageRoadmapPage.subtitle")}
            </Text>

            {isLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && data.length === 0 && (
                <Text className={styles.hint}>
                    {t("coverageRoadmapPage.noEpics")}
                </Text>
            )}

            {data && data.length > 0 && <CoverageRoadmapTable areas={data} />}
        </PageLayout>
    );
}
