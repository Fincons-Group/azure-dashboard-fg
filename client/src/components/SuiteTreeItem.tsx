import {
    Accordion,
    AccordionItem,
    AccordionHeader,
    AccordionPanel,
    Badge,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { FolderRegular, DocumentRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { TestSuiteSummary } from "../types";

const useStyles = makeStyles({
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
    testCaseRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalXS}`,
        borderRadius: tokens.borderRadiusSmall,
        color: tokens.colorNeutralForeground2,
        ":hover": {
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
    },
    testCaseId: {
        color: tokens.colorNeutralForeground3,
        fontFamily: tokens.fontFamilyMonospace,
    },
});

function countTestCases(suite: TestSuiteSummary): number {
    return (
        suite.testCases.length +
        suite.children.reduce(
            (sum, child) => sum + countTestCases(child),
            0
        )
    );
}

export function SuiteTreeItem({ suite }: { suite: TestSuiteSummary }) {
    const styles = useStyles();
    const { t } = useTranslation();

    return (
        <AccordionItem value={suite.id}>
            <AccordionHeader>
                <span className={styles.header}>
                    <FolderRegular aria-hidden="true" />
                    {suite.name}
                    <Badge appearance="tint" color="informative" size="small">
                        {countTestCases(suite)}
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
                            <SuiteTreeItem key={child.id} suite={child} />
                        ))}
                    </Accordion>
                )}

                {suite.testCases.length > 0 && (
                    <div className={styles.testCaseList}>
                        {suite.testCases.map((tc) => (
                            <div key={tc.id} className={styles.testCaseRow}>
                                <DocumentRegular aria-hidden="true" />
                                <Text className={styles.testCaseId}>
                                    #{tc.id}
                                </Text>
                                <Text>{tc.title}</Text>
                            </div>
                        ))}
                    </div>
                )}

                {suite.children.length === 0 &&
                    suite.testCases.length === 0 && (
                        <Text>{t("planDetailPage.suiteEmpty")}</Text>
                    )}
            </AccordionPanel>
        </AccordionItem>
    );
}
