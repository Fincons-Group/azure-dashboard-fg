import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageLayout } from "../components/PageLayout";
import { CardGrid } from "../components/CardGrid";
import { RunCardItem } from "../components/RunCardItem";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { fetchRuns } from "../api/client";

export function RunsPage() {
    const { t } = useTranslation();
    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["runs"],
        queryFn: fetchRuns,
    });

    return (
        <PageLayout title={t("runsPage.title")}>
            {isLoading && <LoadingCardGrid count={10} />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data &&
                (data.length === 0 ? (
                    <EmptyState message={t("runsPage.empty")} />
                ) : (
                    <CardGrid>
                        {data.map((run) => (
                            <RunCardItem key={run.id} run={run} />
                        ))}
                    </CardGrid>
                ))}
        </PageLayout>
    );
}
