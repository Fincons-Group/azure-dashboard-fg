import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageLayout } from "../components/PageLayout";
import { CardGrid } from "../components/CardGrid";
import { PlanCardItem } from "../components/PlanCardItem";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { fetchPlans } from "../api/client";

export function PlansPage() {
    const { t } = useTranslation();
    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["plans"],
        queryFn: fetchPlans,
    });

    return (
        <PageLayout title={t("plansPage.title")}>
            {isLoading && <LoadingCardGrid count={10} />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data &&
                (data.length === 0 ? (
                    <EmptyState message={t("plansPage.empty")} />
                ) : (
                    <CardGrid>
                        {data.map((plan) => (
                            <PlanCardItem key={plan.id} plan={plan} />
                        ))}
                    </CardGrid>
                ))}
        </PageLayout>
    );
}
