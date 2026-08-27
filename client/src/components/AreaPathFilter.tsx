import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Dropdown, Option, Field, makeStyles, tokens } from "@fluentui/react-components";
import { ChevronDownRegular } from "@fluentui/react-icons";
import { fetchAreaPaths } from "../api/client";

const useStyles = makeStyles({
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

// Sourced from Azure DevOps's Area Path classification-node tree, scoped to
// a specific project - mirrors IterationFilter's shape (value/onChange, no
// DefectFilters dependency) so it can be dropped into any page that already
// knows which project it's working with.
export function AreaPathFilter({
    project,
    value,
    onChange,
    label,
    className,
}: {
    project: string;
    value: string;
    onChange: (value: string) => void;
    label?: string;
    className?: string;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const allAreas = t("filterBar.allAreas");

    const { data: areas } = useQuery({
        queryKey: ["areas", project],
        queryFn: () => fetchAreaPaths(project),
    });

    return (
        <Field
            label={label ?? t("filterBar.areaPath")}
            className={className ?? styles.field}
        >
            <Dropdown
                expandIcon={<ChevronDownRegular className={styles.chevron} />}
                button={{ className: styles.dropdownButton }}
                value={value || allAreas}
                selectedOptions={value ? [value] : [""]}
                onOptionSelect={(_, data) => onChange(data.optionValue ?? "")}
            >
                <Option value="">{allAreas}</Option>
                {(areas ?? []).map((area) => (
                    <Option key={area.id} value={area.path}>
                        {area.name}
                    </Option>
                ))}
            </Dropdown>
        </Field>
    );
}
