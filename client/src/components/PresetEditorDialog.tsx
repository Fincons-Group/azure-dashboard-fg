import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    Option,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { fetchPlans, fetchProjects } from "../api/client";
import { ReportSidebar } from "./ReportSidebar";
import type { ExcelExportPreset } from "../hooks/useExcelExportPresets";

const useStyles = makeStyles({
    surface: {
        maxWidth: "760px",
        width: "92vw",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        maxHeight: "68vh",
        overflowY: "auto",
    },
});

export interface PresetEditorValues {
    name: string;
    project: string;
    areaPath: string;
    sprint: string;
    planIds: number[];
}

// Mounted only while open (with a key), so the working copy is seeded once
// from props in the useState initializer - no state-syncing effect needed.
export function PresetEditorDialog({
    preset,
    defaultProject,
    onSave,
    onClose,
}: {
    preset?: ExcelExportPreset;
    defaultProject?: string;
    onSave: (values: PresetEditorValues) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const styles = useStyles();

    const [values, setValues] = useState<PresetEditorValues>(() =>
        preset
            ? {
                  name: preset.name,
                  project: preset.project,
                  areaPath: preset.areaPath,
                  sprint: preset.sprint,
                  planIds: [...preset.planIds],
              }
            : {
                  name: "",
                  project: defaultProject ?? "",
                  areaPath: "",
                  sprint: "",
                  planIds: [],
              }
    );

    const { data: projects } = useQuery({
        queryKey: ["projects"],
        queryFn: fetchProjects,
    });

    const { data: plans, isLoading: plansLoading } = useQuery({
        queryKey: ["plans", values.project, values.areaPath, values.sprint],
        queryFn: () =>
            fetchPlans(values.project, values.areaPath, values.sprint),
        enabled: !!values.project && !!values.areaPath && !!values.sprint,
    });

    const sortedPlans = useMemo(
        () => [...(plans ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
        [plans]
    );

    const canSave =
        !!values.name.trim() &&
        !!values.project &&
        !!values.sprint &&
        values.planIds.length > 0;

    return (
        <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
            <DialogSurface className={styles.surface}>
                <DialogBody>
                    <DialogTitle>
                        {preset
                            ? t("excelExportPage.editPreset")
                            : t("excelExportPage.addPreset")}
                    </DialogTitle>
                    <DialogContent className={styles.content}>
                        <Field label={t("excelExportPage.presetName")}>
                            <Input
                                value={values.name}
                                placeholder={t(
                                    "excelExportPage.presetNamePlaceholder"
                                )}
                                onChange={(_, data) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        name: data.value,
                                    }))
                                }
                            />
                        </Field>

                        <Field label={t("excelExportPage.projectLabel")}>
                            <Dropdown
                                value={values.project}
                                selectedOptions={
                                    values.project ? [values.project] : []
                                }
                                onOptionSelect={(_, data) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        project: data.optionValue ?? "",
                                        areaPath: "",
                                        sprint: "",
                                        planIds: [],
                                    }))
                                }
                            >
                                {(projects ?? []).map((project) => (
                                    <Option key={project.id} value={project.name}>
                                        {project.name}
                                    </Option>
                                ))}
                            </Dropdown>
                        </Field>

                        {values.project && (
                            <ReportSidebar
                                project={values.project}
                                areaPath={values.areaPath}
                                sprint={values.sprint}
                                onAreaPathChange={(areaPath) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        areaPath,
                                        planIds: [],
                                    }))
                                }
                                onSprintChange={(sprint) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        sprint,
                                        planIds: [],
                                    }))
                                }
                                plans={sortedPlans}
                                plansLoading={plansLoading}
                                checkedPlanIds={values.planIds}
                                onCheckedPlanIdsChange={(planIds) =>
                                    setValues((prev) => ({ ...prev, planIds }))
                                }
                                newPlanIds={new Set()}
                            />
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {t("excelExportPage.cancel")}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!canSave}
                            onClick={() =>
                                onSave({ ...values, name: values.name.trim() })
                            }
                        >
                            {t("excelExportPage.save")}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
