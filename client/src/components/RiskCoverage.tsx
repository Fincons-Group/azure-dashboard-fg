import { useTranslation } from "react-i18next";
import {
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
} from "@fluentui/react-components";
import { computeGroupStats } from "../utils/stats";
import type { TestCaseRow } from "../types";

export function RiskCoverage({
    groupedByPriority,
}: {
    groupedByPriority: Record<string, TestCaseRow[]>;
}) {
    const { t } = useTranslation();

    const rows = Object.entries(groupedByPriority)
        .map(([priority, rows]) => ({
            priority: Number(priority),
            stats: computeGroupStats(rows),
        }))
        .sort((a, b) => a.priority - b.priority);

    const highestRiskPriority = rows.length
        ? Math.min(...rows.map((r) => r.priority))
        : null;

    return (
        <Table aria-label={t("testExecutionPage.risk.tableLabel")}>
            <TableHeader>
                <TableRow>
                    <TableHeaderCell>
                        {t("testExecutionPage.risk.columns.priority")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("testExecutionPage.risk.columns.total")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("testExecutionPage.risk.columns.passRate")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("testExecutionPage.risk.columns.failed")}
                    </TableHeaderCell>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map(({ priority, stats }) => (
                    <TableRow key={priority}>
                        <TableCell>
                            {t("testExecutionPage.risk.priorityLabel", {
                                value: priority,
                            })}
                            {priority === highestRiskPriority
                                ? ` (${t("testExecutionPage.risk.highRisk")})`
                                : ""}
                        </TableCell>
                        <TableCell>{stats.total}</TableCell>
                        <TableCell>{stats.passRate}%</TableCell>
                        <TableCell>{stats.failed}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
