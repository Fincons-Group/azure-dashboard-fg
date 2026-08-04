import { Dropdown, Option, Field, makeStyles, tokens } from "@fluentui/react-components";
import { ChevronDownRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { DefectFilterOptions, DefectFilters } from "../types";

const useStyles = makeStyles({
    bar: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalM,
        alignItems: "flex-end",
    },
    field: {
        minWidth: "180px",
        flex: "1 1 180px",
    },
    chevron: {
        color: tokens.colorBrandForeground1,
        fontSize: "18px",
    },
    dropdownButton: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
});

export type DefectFilterField =
    | "iteration"
    | "area"
    | "environment"
    | "suites"
    | "targetVersion";

const ALL_FIELDS: DefectFilterField[] = [
    "iteration",
    "area",
    "environment",
    "suites",
    "targetVersion",
];

export function DefectFilterBar({
    availableFilters,
    filters,
    onChange,
    fields = ALL_FIELDS,
}: {
    availableFilters: DefectFilterOptions;
    filters: DefectFilters;
    onChange: (next: DefectFilters) => void;
    // Restricts which dropdowns render - e.g. the Sprint Status Card page
    // only wants Iteration/Area/Suites, not Environment/Target Version.
    // Defaults to every field, matching the original always-show-all bar.
    fields?: DefectFilterField[];
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const allAreas = t("filterBar.allAreas");
    const allIterations = t("defectFilterBar.allIterations");
    const allEnvironments = t("defectFilterBar.allEnvironments");
    const allTargetVersions = t("defectFilterBar.allTargetVersions");
    const allSuites = t("defectFilterBar.allSuites");
    const showField = (field: DefectFilterField) => fields.includes(field);

    return (
        <div className={styles.bar}>
            {showField("iteration") && (
                <Field label={t("defectFilterBar.iteration")} className={styles.field}>
                    <Dropdown
                        expandIcon={<ChevronDownRegular className={styles.chevron} />}
                        button={{ className: styles.dropdownButton }}
                        value={filters.iteration || allIterations}
                        selectedOptions={filters.iteration ? [filters.iteration] : [""]}
                        onOptionSelect={(_, data) =>
                            onChange({
                                ...filters,
                                iteration: data.optionValue ?? "",
                            })
                        }
                    >
                        <Option value="">{allIterations}</Option>
                        {availableFilters.iterations.map((iteration) => (
                            <Option key={iteration} value={iteration}>
                                {iteration}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            )}

            {showField("area") && (
                <Field label={t("filterBar.areaPath")} className={styles.field}>
                    <Dropdown
                        expandIcon={<ChevronDownRegular className={styles.chevron} />}
                        button={{ className: styles.dropdownButton }}
                        value={filters.area || allAreas}
                        selectedOptions={filters.area ? [filters.area] : [""]}
                        onOptionSelect={(_, data) =>
                            onChange({ ...filters, area: data.optionValue ?? "" })
                        }
                    >
                        <Option value="">{allAreas}</Option>
                        {availableFilters.areas.map((area) => (
                            <Option key={area} value={area}>
                                {area}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            )}

            {showField("environment") && availableFilters.environments.length > 0 && (
                <Field label={t("defectFilterBar.environment")} className={styles.field}>
                    <Dropdown
                        expandIcon={<ChevronDownRegular className={styles.chevron} />}
                        button={{ className: styles.dropdownButton }}
                        value={filters.environment || allEnvironments}
                        selectedOptions={filters.environment ? [filters.environment] : [""]}
                        onOptionSelect={(_, data) =>
                            onChange({
                                ...filters,
                                environment: data.optionValue ?? "",
                            })
                        }
                    >
                        <Option value="">{allEnvironments}</Option>
                        {availableFilters.environments.map((environment) => (
                            <Option key={environment} value={environment}>
                                {environment}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            )}

            {showField("suites") && availableFilters.suites.length > 0 && (
                <Field label={t("defectFilterBar.suite")} className={styles.field}>
                    <Dropdown
                        multiselect
                        expandIcon={<ChevronDownRegular className={styles.chevron} />}
                        button={{ className: styles.dropdownButton }}
                        value={
                            filters.suites.length > 0
                                ? t("defectFilterBar.selectedSuites", {
                                      count: filters.suites.length,
                                  })
                                : allSuites
                        }
                        selectedOptions={filters.suites}
                        onOptionSelect={(_, data) =>
                            onChange({
                                ...filters,
                                suites: data.selectedOptions,
                            })
                        }
                    >
                        {availableFilters.suites.map((suite) => (
                            <Option key={suite} value={suite}>
                                {suite}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            )}

            {showField("targetVersion") && availableFilters.targetVersions.length > 0 && (
                <Field label={t("defectFilterBar.targetVersion")} className={styles.field}>
                    <Dropdown
                        expandIcon={<ChevronDownRegular className={styles.chevron} />}
                        button={{ className: styles.dropdownButton }}
                        value={filters.targetVersion || allTargetVersions}
                        selectedOptions={filters.targetVersion ? [filters.targetVersion] : [""]}
                        onOptionSelect={(_, data) =>
                            onChange({
                                ...filters,
                                targetVersion: data.optionValue ?? "",
                            })
                        }
                    >
                        <Option value="">{allTargetVersions}</Option>
                        {availableFilters.targetVersions.map((version) => (
                            <Option key={version} value={version}>
                                {version}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>
            )}
        </div>
    );
}
