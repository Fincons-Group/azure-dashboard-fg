import {
    AccordionItem,
    AccordionHeader,
    AccordionPanel,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { FolderRegular } from "@fluentui/react-icons";
import { TestCaseItem } from "./TestCaseItem";
import { NAV_HEIGHT } from "../layoutConstants";
import type { TestCaseRow } from "../types";

const useStyles = makeStyles({
    accordionHeader: {
        position: "sticky",
        top: NAV_HEIGHT,
        zIndex: 5,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
    },
    panel: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
});

export function SuiteGroup({
    value,
    suiteName,
    totalCount,
    testCases,
}: {
    value: string;
    suiteName: string;
    totalCount: number;
    testCases: TestCaseRow[];
}) {
    const styles = useStyles();

    return (
        <AccordionItem value={value}>
            <AccordionHeader className={styles.accordionHeader}>
                <span className={styles.header}>
                    <FolderRegular aria-hidden="true" />
                    {suiteName}
                    <Text>
                        ({testCases.length}/{totalCount})
                    </Text>
                </span>
            </AccordionHeader>

            <AccordionPanel className={styles.panel}>
                {testCases.map((tc) => (
                    <TestCaseItem key={tc.testCaseId} testCase={tc} />
                ))}
            </AccordionPanel>
        </AccordionItem>
    );
}
