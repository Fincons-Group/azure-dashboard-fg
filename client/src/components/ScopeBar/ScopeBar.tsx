import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Button,
    Dropdown,
    Field,
    Option,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ChevronDownRegular, EditRegular } from "@fluentui/react-icons";
import { useScope } from "../../hooks/useScope";
import { fetchProjects, fetchIterations } from "../../api/client";
import { AreaPathFilter } from "../AreaPathFilter";
import { NAV_HEIGHT } from "../../layoutConstants";

const useStyles = makeStyles({
    bar: {
        position: "sticky",
        // Sits directly beneath TopBar, which is sticky at top: 0 with its
        // own height fixed to NAV_HEIGHT - stacking these two is what keeps
        // the project scope visible while the page content scrolls under it.
        top: NAV_HEIGHT,
        zIndex: 9,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    field: {
        minWidth: "200px",
        flex: "1 1 200px",
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
    chipsRow: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    chip: {
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
        borderRadius: tokens.borderRadiusCircular,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
        fontSize: tokens.fontSizeBase200,
    },
    separator: {
        color: tokens.colorNeutralForeground3,
    },
    changeScope: {
        marginLeft: "auto",
    },
});

// Option C from the "Scope Gate" design doc: a cascading bar (Project ->
// Area Path -> Sprint) selected once, collapsing to a chip summary once a
// project is chosen. Rendered globally by PageLayout so every page shares
// the same selection instead of each page owning its own copy.
export function ScopeBar({
    hideAreaSprint = false,
}: {
    // The Report page owns Area Path/Sprint selection itself via
    // ReportSidebar - showing them here too would be two controls for the
    // same shared scope. Project stays here since ReportSidebar still
    // needs it and every other page keeps reading it from ScopeBar.
    hideAreaSprint?: boolean;
} = {}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const scope = useScope();
    const [editing, setEditing] = useState(!scope.isComplete);

    const { data: projects } = useQuery({
        queryKey: ["projects"],
        queryFn: fetchProjects,
    });

    const { data: iterations } = useQuery({
        queryKey: ["iterations", scope.project],
        queryFn: () => fetchIterations(scope.project),
        enabled: !!scope.project,
    });

    const allSprints = t("scopeBar.allSprints");
    const allAreas = t("filterBar.allAreas");

    if (!editing) {
        return (
            <div className={styles.bar}>
                <div className={styles.chipsRow}>
                    <span className={styles.chip}>{scope.project}</span>
                    {!hideAreaSprint && (
                        <>
                            <span className={styles.separator}>&middot;</span>
                            <span className={styles.chip}>{scope.areaPath || allAreas}</span>
                            <span className={styles.separator}>&middot;</span>
                            <span className={styles.chip}>{scope.sprint || allSprints}</span>
                        </>
                    )}
                </div>

                <Button
                    appearance="subtle"
                    icon={<EditRegular />}
                    className={styles.changeScope}
                    onClick={() => setEditing(true)}
                >
                    {t("scopeBar.changeScope")}
                </Button>
            </div>
        );
    }

    return (
        <div className={styles.bar}>
            <Field label={t("scopeBar.projectLabel")} className={styles.field}>
                <Dropdown
                    expandIcon={<ChevronDownRegular className={styles.chevron} />}
                    button={{ className: styles.dropdownButton }}
                    placeholder={t("scopeBar.projectPlaceholder")}
                    value={scope.project}
                    selectedOptions={scope.project ? [scope.project] : []}
                    defaultOpen={!scope.project}
                    onOptionSelect={(_, data) => scope.setProject(data.optionValue ?? "")}
                >
                    {(projects ?? []).map((project) => (
                        <Option key={project.id} value={project.name}>
                            {project.name}
                        </Option>
                    ))}
                </Dropdown>
            </Field>

            {scope.project && !hideAreaSprint && (
                <>
                    <AreaPathFilter
                        project={scope.project}
                        value={scope.areaPath}
                        onChange={scope.setAreaPath}
                        label={t("scopeBar.areaPathLabel")}
                        className={styles.field}
                    />

                    <Field label={t("scopeBar.sprintLabel")} className={styles.field}>
                        <Dropdown
                            expandIcon={<ChevronDownRegular className={styles.chevron} />}
                            button={{ className: styles.dropdownButton }}
                            value={scope.sprint || allSprints}
                            selectedOptions={scope.sprint ? [scope.sprint] : [""]}
                            onOptionSelect={(_, data) => scope.setSprint(data.optionValue ?? "")}
                        >
                            <Option value="">{allSprints}</Option>
                            {(iterations ?? []).map((iteration) => (
                                <Option key={iteration.id} value={iteration.path}>
                                    {iteration.name}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>
                </>
            )}

            {scope.project && (
                <Button
                    appearance="primary"
                    className={styles.changeScope}
                    onClick={() => setEditing(false)}
                >
                    {t("scopeBar.done")}
                </Button>
            )}
        </div>
    );
}
