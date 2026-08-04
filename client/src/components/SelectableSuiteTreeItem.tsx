import {
    Accordion,
    AccordionItem,
    AccordionHeader,
    AccordionPanel,
    Badge,
    Checkbox,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { FolderRegular, DocumentRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { TestSuiteSummary } from "../types";

const useStyles = makeStyles({
    suiteRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: tokens.spacingHorizontalXS,
    },
    accordionItem: {
        flexGrow: 1,
        minWidth: 0,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    nested: {
        paddingLeft: tokens.spacingHorizontalL,
        borderLeftWidth: "1px",
        borderLeftStyle: "solid",
        borderLeftColor: tokens.colorNeutralStroke2,
    },
    testCaseList: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
        paddingBottom: tokens.spacingVerticalS,
        paddingLeft: tokens.spacingHorizontalL,
    },
    testCaseId: {
        color: tokens.colorNeutralForeground3,
        fontFamily: tokens.fontFamilyMonospace,
        marginRight: tokens.spacingHorizontalXXS,
    },
});

function collectTestCaseIds(suite: TestSuiteSummary): number[] {
    return [
        ...suite.testCases.map((tc) => tc.id),
        ...suite.children.flatMap(collectTestCaseIds),
    ];
}

export function SelectableSuiteTreeItem({
    suite,
    selectedIds,
    onToggleTestCase,
    onToggleSuite,
}: {
    suite: TestSuiteSummary;
    selectedIds: Set<number>;
    onToggleTestCase: (id: number, checked: boolean) => void;
    onToggleSuite: (ids: number[], checked: boolean) => void;
}) {
    const styles = useStyles();
    const { t } = useTranslation();

    const suiteTestCaseIds = collectTestCaseIds(suite);
    const selectedCount = suiteTestCaseIds.filter((id) =>
        selectedIds.has(id)
    ).length;
    const suiteChecked: boolean | "mixed" =
        selectedCount === 0
            ? false
            : selectedCount === suiteTestCaseIds.length
                ? true
                : "mixed";

    return (
        <div className={styles.suiteRow}>
            <Checkbox
                checked={suiteChecked}
                disabled={suiteTestCaseIds.length === 0}
                onChange={(_, data) =>
                    onToggleSuite(
                        suiteTestCaseIds,
                        data.checked === true
                    )
                }
                aria-label={t("removeTestCasesPage.selectSuite", {
                    suiteName: suite.name,
                })}
            />

            <AccordionItem
                value={suite.id}
                className={styles.accordionItem}
            >
                <AccordionHeader>
                    <span className={styles.header}>
                        <FolderRegular aria-hidden="true" />
                        {suite.name}
                        <Badge
                            appearance="tint"
                            color="informative"
                            size="small"
                        >
                            {suiteTestCaseIds.length}
                        </Badge>
                    </span>
                </AccordionHeader>

                <AccordionPanel>
                    {suite.children.length > 0 && (
                        <Accordion
                            collapsible
                            multiple
                            className={styles.nested}
                        >
                            {suite.children.map((child) => (
                                <SelectableSuiteTreeItem
                                    key={child.id}
                                    suite={child}
                                    selectedIds={selectedIds}
                                    onToggleTestCase={onToggleTestCase}
                                    onToggleSuite={onToggleSuite}
                                />
                            ))}
                        </Accordion>
                    )}

                    {suite.testCases.length > 0 && (
                        <div className={styles.testCaseList}>
                            {suite.testCases.map((tc) => (
                                <Checkbox
                                    key={tc.id}
                                    checked={selectedIds.has(tc.id)}
                                    onChange={(_, data) =>
                                        onToggleTestCase(
                                            tc.id,
                                            data.checked === true
                                        )
                                    }
                                    label={
                                        <span>
                                            <DocumentRegular aria-hidden="true" />
                                            <Text
                                                className={
                                                    styles.testCaseId
                                                }
                                            >
                                                #{tc.id}
                                            </Text>
                                            <Text>{tc.title}</Text>
                                        </span>
                                    }
                                />
                            ))}
                        </div>
                    )}

                    {suite.children.length === 0 &&
                        suite.testCases.length === 0 && (
                            <Text>
                                {t("planDetailPage.suiteEmpty")}
                            </Text>
                        )}
                </AccordionPanel>
            </AccordionItem>
        </div>
    );
}
