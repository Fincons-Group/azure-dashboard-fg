import {
    Badge,
    Link,
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { BugInfo } from "../types";
import { compareByState } from "../utils/bugState";

export function BugsTable({
    bugs,
    ariaLabel,
    quickActionLabel,
}: {
    bugs: BugInfo[];
    ariaLabel: string;
    quickActionLabel?: string;
}) {
    const { t } = useTranslation();
    const sortedBugs = [...bugs].sort(compareByState);
    const showPriority = sortedBugs.some((bug) => bug.priority != null);

    return (
        <Table aria-label={ariaLabel}>
            <TableHeader>
                <TableRow>
                    {showPriority && (
                        <TableHeaderCell>
                            {t("bugsTable.columns.priority")}
                        </TableHeaderCell>
                    )}
                    <TableHeaderCell>
                        {t("bugsTable.columns.id")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("bugsTable.columns.title")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("bugsTable.columns.state")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("bugsTable.columns.creator")}
                    </TableHeaderCell>
                    <TableHeaderCell>
                        {t("bugsTable.columns.assignee")}
                    </TableHeaderCell>
                    {quickActionLabel && <TableHeaderCell />}
                </TableRow>
            </TableHeader>
            <TableBody>
                {sortedBugs.map((bug) => {
                    const isActive = bug.state !== "Closed";

                    return (
                        <TableRow key={bug.id}>
                            {showPriority && (
                                <TableCell>
                                    {bug.priority != null
                                        ? `P${bug.priority}`
                                        : ""}
                                </TableCell>
                            )}
                            <TableCell>
                                {bug.url ? (
                                    <Link
                                        href={bug.url}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {bug.id}
                                    </Link>
                                ) : (
                                    bug.id
                                )}
                            </TableCell>
                            <TableCell>{bug.title}</TableCell>
                            <TableCell>
                                <Badge
                                    color={isActive ? "danger" : "success"}
                                    appearance="tint"
                                >
                                    {bug.state}
                                </Badge>
                            </TableCell>
                            <TableCell>{bug.creator ?? ""}</TableCell>
                            <TableCell>
                                {bug.assignee?.displayName ?? ""}
                            </TableCell>
                            {quickActionLabel && (
                                <TableCell>
                                    {bug.url && (
                                        <Link
                                            href={bug.url}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {quickActionLabel}
                                        </Link>
                                    )}
                                </TableCell>
                            )}
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}
