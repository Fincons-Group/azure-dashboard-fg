import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Dropdown, Option, Field, makeStyles, tokens } from "@fluentui/react-components";
import { ChevronDownRegular } from "@fluentui/react-icons";
import { fetchIterations } from "../api/client";

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

// Sourced straight from Azure DevOps's classification-nodes tree (real
// sprints, including empty/future ones) rather than derived from bugs seen
// in the currently fetched page of data - kept deliberately generic
// (value/onChange, no DefectFilters dependency) so any page can drop it in
// and wire it to whatever iteration field it needs.
export function IterationFilter({
    value,
    onChange,
    label,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    className?: string;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const allIterations = t("iterationFilter.all");

    const { data: iterations } = useQuery({
        queryKey: ["iterations"],
        queryFn: fetchIterations,
    });

    return (
        <Field
            label={label ?? t("iterationFilter.label")}
            className={className ?? styles.field}
        >
            <Dropdown
                expandIcon={<ChevronDownRegular className={styles.chevron} />}
                button={{ className: styles.dropdownButton }}
                value={value || allIterations}
                selectedOptions={value ? [value] : [""]}
                onOptionSelect={(_, data) => onChange(data.optionValue ?? "")}
            >
                <Option value="">{allIterations}</Option>
                {(iterations ?? []).map((iteration) => (
                    <Option key={iteration.id} value={iteration.path}>
                        {iteration.name}
                    </Option>
                ))}
            </Dropdown>
        </Field>
    );
}
