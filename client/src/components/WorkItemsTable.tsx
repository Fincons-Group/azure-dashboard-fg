import { useState } from "react";
import {
    Badge,
    Button,
    Checkbox,
    Input,
    Link,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
} from "@fluentui/react-components";
import { FilterFilled, FilterRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { WorkItemSummary } from "../types";

const CLOSED_STATES = ["Closed", "Resolved", "Removed", "Done"];

const formatDateOnly = (value?: string) =>
    value
        ? new Date(value).toLocaleDateString(undefined, {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
          })
        : "";

const formatTimeOnly = (value?: string) =>
    value
        ? new Date(value).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
          })
        : "";

type FilterState = Record<string, Set<string>>;

function ColumnFilter({
    values,
    selected,
    onChange,
}: {
    values: string[];
    selected: Set<string> | undefined;
    onChange: (next: Set<string> | undefined) => void;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState("");
    const isActive = selected != null;

    const visible = values.filter((v) =>
        (v || t("workItemsTable.filter.blank"))
            .toLowerCase()
            .includes(search.toLowerCase())
    );

    const isChecked = (v: string) => selected == null || selected.has(v);

    const toggle = (v: string, checked: boolean) => {
        const base = selected == null ? new Set(values) : new Set(selected);
        if (checked) {
            base.add(v);
        } else {
            base.delete(v);
        }
        onChange(base.size === values.length ? undefined : base);
    };

    return (
        <Popover positioning="below-start" withArrow trapFocus>
            <PopoverTrigger disableButtonEnhancement>
                <Button
                    appearance="transparent"
                    size="small"
                    icon={isActive ? <FilterFilled /> : <FilterRegular />}
                    aria-label={t("workItemsTable.filter.label")}
                    onClick={(e) => e.stopPropagation()}
                />
            </PopoverTrigger>
            <PopoverSurface>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        minWidth: "200px",
                    }}
                >
                    <Input
                        size="small"
                        value={search}
                        placeholder={t("workItemsTable.filter.search")}
                        onChange={(_, d) => setSearch(d.value)}
                    />
                    <Checkbox
                        label={t("workItemsTable.filter.selectAll")}
                        checked={selected == null}
                        onChange={(_, d) =>
                            onChange(d.checked ? undefined : new Set<string>())
                        }
                    />
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            maxHeight: "240px",
                            overflowY: "auto",
                        }}
                    >
                        {visible.map((v) => (
                            <Checkbox
                                key={v || "__blank__"}
                                label={v || t("workItemsTable.filter.blank")}
                                checked={isChecked(v)}
                                onChange={(_, d) => toggle(v, !!d.checked)}
                            />
                        ))}
                    </div>
                </div>
            </PopoverSurface>
        </Popover>
    );
}

export function WorkItemsTable({
    items,
    ariaLabel,
    showTags = false,
}: {
    items: WorkItemSummary[];
    ariaLabel: string;
    showTags?: boolean;
}) {
    const { t } = useTranslation();
    const [filters, setFilters] = useState<FilterState>({});
    const showPriority = items.some((item) => item.priority != null);

    const columnValue: Record<string, (item: WorkItemSummary) => string> = {
        priority: (item) => (item.priority != null ? `P${item.priority}` : ""),
        id: (item) => String(item.id),
        title: (item) => item.title ?? "",
        type: (item) => item.type ?? "",
        state: (item) => item.state ?? "",
        assignee: (item) => item.assignee?.displayName ?? "",
        createdDate: (item) => formatDateOnly(item.createdDate),
        createdTime: (item) => formatTimeOnly(item.createdDate),
        closedDate: (item) => formatDateOnly(item.closedDate),
        closedTime: (item) => formatTimeOnly(item.closedDate),
        tags: (item) =>
            item.type === "Bug"
                ? item.tags?.length
                    ? item.tags.join(", ")
                    : t("workItemsTable.noTags")
                : "",
    };

    const distinctValues = (key: string) =>
        Array.from(
            new Set(items.map((item) => columnValue[key](item)))
        ).sort((a, b) => a.localeCompare(b));

    const filteredItems = items.filter((item) =>
        Object.entries(filters).every(([key, selected]) =>
            selected.has(columnValue[key](item))
        )
    );

    const setColumnFilter =
        (key: string) => (next: Set<string> | undefined) =>
            setFilters((prev) => {
                const updated = { ...prev };
                if (next == null) {
                    delete updated[key];
                } else {
                    updated[key] = next;
                }
                return updated;
            });

    const headerCell = (key: string, labelKey: string) => (
        <TableHeaderCell>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                }}
            >
                {t(labelKey)}
                <ColumnFilter
                    values={distinctValues(key)}
                    selected={filters[key]}
                    onChange={setColumnFilter(key)}
                />
            </div>
        </TableHeaderCell>
    );

    return (
        <Table aria-label={ariaLabel}>
            <TableHeader>
                <TableRow>
                    {showPriority &&
                        headerCell(
                            "priority",
                            "workItemsTable.columns.priority"
                        )}
                    {headerCell("id", "workItemsTable.columns.id")}
                    {headerCell("title", "workItemsTable.columns.title")}
                    {headerCell("type", "workItemsTable.columns.type")}
                    {headerCell("state", "workItemsTable.columns.state")}
                    {headerCell(
                        "assignee",
                        "workItemsTable.columns.assignee"
                    )}
                    {headerCell(
                        "createdDate",
                        "workItemsTable.columns.createdDate"
                    )}
                    {headerCell(
                        "createdTime",
                        "workItemsTable.columns.createdTime"
                    )}
                    {headerCell(
                        "closedDate",
                        "workItemsTable.columns.closedDate"
                    )}
                    {headerCell(
                        "closedTime",
                        "workItemsTable.columns.closedTime"
                    )}
                    {showTags &&
                        headerCell("tags", "workItemsTable.columns.tags")}
                </TableRow>
            </TableHeader>
            <TableBody>
                {filteredItems.map((item) => {
                    const isActive = !CLOSED_STATES.includes(item.state);

                    return (
                        <TableRow key={item.id}>
                            {showPriority && (
                                <TableCell>
                                    {item.priority != null
                                        ? `P${item.priority}`
                                        : ""}
                                </TableCell>
                            )}
                            <TableCell>
                                {item.url ? (
                                    <Link
                                        href={item.url}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {item.id}
                                    </Link>
                                ) : (
                                    item.id
                                )}
                            </TableCell>
                            <TableCell>{item.title}</TableCell>
                            <TableCell>{item.type}</TableCell>
                            <TableCell>
                                <Badge
                                    color={isActive ? "danger" : "success"}
                                    appearance="tint"
                                >
                                    {item.state}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                {item.assignee?.displayName ?? ""}
                            </TableCell>
                            <TableCell>
                                {formatDateOnly(item.createdDate)}
                            </TableCell>
                            <TableCell>
                                {formatTimeOnly(item.createdDate)}
                            </TableCell>
                            <TableCell>
                                {formatDateOnly(item.closedDate)}
                            </TableCell>
                            <TableCell>
                                {formatTimeOnly(item.closedDate)}
                            </TableCell>
                            {showTags && (
                                <TableCell>
                                    {item.type === "Bug"
                                        ? item.tags?.length
                                            ? item.tags.join(", ")
                                            : t("workItemsTable.noTags")
                                        : ""}
                                </TableCell>
                            )}
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}
