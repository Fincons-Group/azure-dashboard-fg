import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    TabList,
    Tab,
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import type { SuiteStat } from "../types";

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    nameCell: {
        width: "28%",
        whiteSpace: "normal",
        wordBreak: "break-word",
    },
    statCell: {
        width: "12%",
    },
    footnote: {
        color: tokens.colorNeutralForeground3,
    },
});

const coverageTabs = ["requirements", "userStory", "feature"] as const;

type CoverageTab = (typeof coverageTabs)[number];

// Not Applicable test cases were still executed/assessed (they're tagged
// "OutOfScope" in Azure DevOps, not skipped), so they count toward
// "executed" and coverage - only the pass-rate math below excludes them.
function suiteExecuted(stat: SuiteStat): number {
    return stat.passed + stat.failed + stat.blocked + stat.notApplicable;
}

function suitePassRate(stat: SuiteStat): number {
    return stat.total
        ? Math.round((stat.passed / stat.total) * 1000) / 10
        : 0;
}

// Not Applicable cases are neither a pass nor a fail, so they shouldn't
// dilute the pass rate the way an unrun or failed case would - this
// recomputes it over only the applicable (total - notApplicable) cases.
function suitePassRateExcludingNA(stat: SuiteStat): number {
    const applicable = stat.total - stat.notApplicable;

    return applicable
        ? Math.round((stat.passed / applicable) * 1000) / 10
        : 0;
}

function suitePassRateNADelta(stat: SuiteStat): number {
    return (
        Math.round(
            (suitePassRateExcludingNA(stat) - suitePassRate(stat)) * 10
        ) / 10
    );
}

function suiteCoveragePct(stat: SuiteStat): number {
    return stat.total
        ? Math.round((suiteExecuted(stat) / stat.total) * 1000) / 10
        : 0;
}

function SuiteCoverageTable({
    suites,
}: {
    suites: Record<string, SuiteStat>;
}) {
    const { t } = useTranslation();

    const styles = useStyles();

    const entries = Object.entries(suites).sort(([a], [b]) =>
        a.localeCompare(b)
    );

    return (
        <>
            <Table aria-label={t("testExecutionPage.coverage.tableLabel")}>
                <TableHeader>
                    <TableRow>
                        <TableHeaderCell className={styles.nameCell}>
                            {t("testExecutionPage.coverage.columns.name")}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.statCell}>
                            {t("testExecutionPage.coverage.columns.total")}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.statCell}>
                            {t("testExecutionPage.coverage.columns.executed")}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.statCell}>
                            {t("testExecutionPage.coverage.columns.coverage")}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.statCell}>
                            {t("testExecutionPage.coverage.columns.passRate")}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.statCell}>
                            {t(
                                "testExecutionPage.coverage.columns.passRateExclNA"
                            )}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.statCell}>
                            {t(
                                "testExecutionPage.coverage.columns.passRateNADelta"
                            )}
                        </TableHeaderCell>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {entries.map(([name, stat]) => {
                        const delta = suitePassRateNADelta(stat);

                        return (
                            <TableRow key={name}>
                                <TableCell className={styles.nameCell}>
                                    {name}
                                </TableCell>
                                <TableCell>{stat.total}</TableCell>
                                <TableCell>{suiteExecuted(stat)}</TableCell>
                                <TableCell>
                                    {suiteCoveragePct(stat)}%
                                </TableCell>
                                <TableCell>{suitePassRate(stat)}%</TableCell>
                                <TableCell>
                                    {suitePassRateExcludingNA(stat)}%
                                </TableCell>
                                <TableCell>
                                    {delta > 0 ? "+" : ""}
                                    {delta}%
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            <Text size={200} className={styles.footnote}>
                {t("testExecutionPage.coverage.footnote")}
            </Text>
        </>
    );
}

export function CoverageSection({
    suites,
}: {
    suites: Record<string, SuiteStat>;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const [selected, setSelected] = useState<CoverageTab>("requirements");

    return (
        <div className={styles.section}>
            <TabList
                selectedValue={selected}
                onTabSelect={(_, data) =>
                    setSelected(data.value as CoverageTab)
                }
            >
                {coverageTabs.map((tab) => (
                    <Tab key={tab} value={tab}>
                        {t(`testExecutionPage.coverage.tabs.${tab}`)}
                    </Tab>
                ))}
            </TabList>

            <SuiteCoverageTable suites={suites} />
        </div>
    );
}
