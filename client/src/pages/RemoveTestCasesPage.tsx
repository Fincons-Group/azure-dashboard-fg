import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Accordion,
    Button,
    Card,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Option,
    Text,
    Title3,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ChevronDownRegular, DeleteRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { SelectableSuiteTreeItem } from "../components/SelectableSuiteTreeItem";
import { NAV_HEIGHT } from "../layoutConstants";
import { deleteTestCases, fetchPlanSuites, fetchPlans } from "../api/client";
import type { TestCaseSummary, TestSuiteSummary } from "../types";

function flattenTestCases(
    suites: TestSuiteSummary[]
): TestCaseSummary[] {
    return suites.flatMap((suite) => [
        ...suite.testCases,
        ...flattenTestCases(suite.children),
    ]);
}

const useStyles = makeStyles({
    filterField: {
        maxWidth: "320px",
    },
    toolbar: {
        position: "sticky",
        top: NAV_HEIGHT,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
        padding: tokens.spacingHorizontalM,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    suitesCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    dialogList: {
        maxHeight: "240px",
        overflowY: "auto",
        margin: 0,
        paddingLeft: tokens.spacingHorizontalL,
    },
});

export function RemoveTestCasesPage() {
    const styles = useStyles();
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    const [selectedPlanId, setSelectedPlanId] = useState<
        number | undefined
    >(undefined);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(
        new Set()
    );
    const [confirmOpen, setConfirmOpen] = useState(false);

    const { data: plans } = useQuery({
        queryKey: ["plans"],
        queryFn: fetchPlans,
    });

    const {
        data: suites,
        isLoading,
        isError,
        error,
        refetch,
    } = useQuery({
        queryKey: ["plan-suites", selectedPlanId],
        queryFn: () => fetchPlanSuites(selectedPlanId!),
        enabled: selectedPlanId != null,
    });

    const selectedPlanName =
        plans?.find((p) => p.id === selectedPlanId)?.name ??
        t("removeTestCasesPage.planFilter.placeholder");

    const allTestCases = suites ? flattenTestCases(suites) : [];
    const selectedTestCases = allTestCases.filter((tc) =>
        selectedIds.has(tc.id)
    );

    const deleteMutation = useMutation({
        mutationFn: deleteTestCases,
        onSuccess: () => {
            setSelectedIds(new Set());
            setConfirmOpen(false);

            void queryClient.invalidateQueries({
                queryKey: ["plan-suites", selectedPlanId],
            });
            void queryClient.invalidateQueries({
                queryKey: ["dashboard"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["suites"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["automation"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["plan-overview"],
            });
            void queryClient.invalidateQueries({
                queryKey: ["plan-progress"],
            });
        },
    });

    const handlePlanSelect = (planId: number | undefined) => {
        setSelectedPlanId(planId);
        setSelectedIds(new Set());
        deleteMutation.reset();
    };

    const toggleTestCase = (id: number, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);

            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }

            return next;
        });
    };

    const toggleSuite = (ids: number[], checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);

            for (const id of ids) {
                if (checked) {
                    next.add(id);
                } else {
                    next.delete(id);
                }
            }

            return next;
        });
    };

    return (
        <PageLayout title={t("removeTestCasesPage.title")}>
            <Field
                label={t("removeTestCasesPage.planFilter.label")}
                className={styles.filterField}
            >
                <Dropdown
                    expandIcon={<ChevronDownRegular />}
                    value={selectedPlanName}
                    selectedOptions={[
                        selectedPlanId != null
                            ? String(selectedPlanId)
                            : "",
                    ]}
                    onOptionSelect={(_, option) =>
                        handlePlanSelect(
                            option.optionValue
                                ? Number(option.optionValue)
                                : undefined
                        )
                    }
                >
                    {plans?.map((plan) => (
                        <Option key={plan.id} value={String(plan.id)}>
                            {plan.name}
                        </Option>
                    ))}
                </Dropdown>
            </Field>

            {deleteMutation.isSuccess && (
                <MessageBar intent="success">
                    <MessageBarBody>
                        <MessageBarTitle>
                            {t(
                                "removeTestCasesPage.result.successTitle",
                                { count: deleteMutation.data.deleted.length }
                            )}
                        </MessageBarTitle>
                        {deleteMutation.data.failed.length > 0 &&
                            t("removeTestCasesPage.result.failedSummary", {
                                count: deleteMutation.data.failed.length,
                            })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {deleteMutation.isError && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        <MessageBarTitle>
                            {t("removeTestCasesPage.result.errorTitle")}
                        </MessageBarTitle>
                        {deleteMutation.error.message}
                    </MessageBarBody>
                </MessageBar>
            )}

            {selectedPlanId == null && (
                <EmptyState
                    message={t("removeTestCasesPage.selectPlanFirst")}
                />
            )}

            {selectedPlanId != null && (
                <>
                    <div className={styles.toolbar}>
                        <Text weight="semibold">
                            {t("removeTestCasesPage.selectedCount", {
                                count: selectedIds.size,
                            })}
                        </Text>

                        <div>
                            <Button
                                appearance="secondary"
                                disabled={selectedIds.size === 0}
                                onClick={() => setSelectedIds(new Set())}
                            >
                                {t("removeTestCasesPage.clearSelection")}
                            </Button>{" "}
                            <Button
                                appearance="primary"
                                icon={<DeleteRegular />}
                                disabled={selectedIds.size === 0}
                                onClick={() => setConfirmOpen(true)}
                            >
                                {t("removeTestCasesPage.deleteSelected")}
                            </Button>
                        </div>
                    </div>

                    {isLoading && <LoadingCardGrid count={4} />}

                    {isError && (
                        <ErrorState
                            message={error.message}
                            onRetry={refetch}
                        />
                    )}

                    {suites &&
                        (suites.length === 0 ? (
                            <EmptyState
                                message={t("planDetailPage.empty")}
                            />
                        ) : (
                            <Card className={styles.suitesCard}>
                                <Title3 as="h2">
                                    {t("planDetailPage.suitesTitle")}
                                </Title3>

                                <Accordion collapsible multiple>
                                    {suites.map((suite) => (
                                        <SelectableSuiteTreeItem
                                            key={suite.id}
                                            suite={suite}
                                            selectedIds={selectedIds}
                                            onToggleTestCase={
                                                toggleTestCase
                                            }
                                            onToggleSuite={toggleSuite}
                                        />
                                    ))}
                                </Accordion>
                            </Card>
                        ))}
                </>
            )}

            <Dialog
                open={confirmOpen}
                onOpenChange={(_, data) => setConfirmOpen(data.open)}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t("removeTestCasesPage.confirm.title", {
                                count: selectedTestCases.length,
                            })}
                        </DialogTitle>
                        <DialogContent>
                            <Text block>
                                {t("removeTestCasesPage.confirm.message", {
                                    count: selectedTestCases.length,
                                })}
                            </Text>
                            <ul className={styles.dialogList}>
                                {selectedTestCases.map((tc) => (
                                    <li key={tc.id}>
                                        #{tc.id} {tc.title}
                                    </li>
                                ))}
                            </ul>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={deleteMutation.isPending}
                                onClick={() => setConfirmOpen(false)}
                            >
                                {t("removeTestCasesPage.confirm.cancel")}
                            </Button>
                            <Button
                                appearance="primary"
                                icon={<DeleteRegular />}
                                disabled={deleteMutation.isPending}
                                onClick={() =>
                                    deleteMutation.mutate(
                                        selectedTestCases.map((tc) => ({
                                            planId: selectedPlanId!,
                                            suiteId: tc.suiteId,
                                            testCaseId: tc.id,
                                        }))
                                    )
                                }
                            >
                                {t("removeTestCasesPage.confirm.confirm", {
                                    count: selectedTestCases.length,
                                })}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </PageLayout>
    );
}
