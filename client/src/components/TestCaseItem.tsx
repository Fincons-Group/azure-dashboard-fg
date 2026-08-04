import {
    Card,
    Text,
    Link as FluentLink,
    Button,
    mergeClasses,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { PlayCircleRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { OutcomeBadge } from "./OutcomeBadge";
import { BugList } from "./BugList";
import type { TestCaseRow } from "../types";

const useStyles = makeStyles({
    card: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        borderLeftWidth: "4px",
        borderLeftStyle: "solid",
        borderLeftColor: tokens.colorNeutralStroke2,
    },
    hasBugs: {
        borderLeftColor: tokens.colorPaletteRedBorder2,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalS,
        flexWrap: "wrap",
    },
    title: {
        minWidth: 0,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    meta: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        marginTop: tokens.spacingVerticalXS,
    },
});

export function TestCaseItem({ testCase }: { testCase: TestCaseRow }) {
    const styles = useStyles();
    const { t } = useTranslation();

    const activeBugs = testCase.bugs.filter(
        (b) => b.state !== "Closed"
    ).length;

    const closedBugs = testCase.bugs.length - activeBugs;

    return (
        <Card
            className={mergeClasses(
                styles.card,
                testCase.hasOpenBugs && styles.hasBugs
            )}
        >
            <div className={styles.header}>
                <div className={styles.title}>
                    {testCase.testCaseUrl ? (
                        <FluentLink
                            href={testCase.testCaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {testCase.testCaseTitle}
                        </FluentLink>
                    ) : (
                        <Text weight="semibold">{testCase.testCaseTitle}</Text>
                    )}
                </div>

                <div className={styles.actions}>
                    {testCase.lastRunUrl && (
                        <Button
                            as="a"
                            href={testCase.lastRunUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            appearance="secondary"
                            size="small"
                            icon={<PlayCircleRegular />}
                        >
                            {t("testCaseItem.latestRun")}
                        </Button>
                    )}

                    <OutcomeBadge outcome={testCase.outcome} />
                </div>
            </div>

            <Text className={styles.meta} block>
                {t("testCaseItem.area", { areaPath: testCase.areaPath })}
            </Text>

            {testCase.bugs.length > 0 && (
                <>
                    <Text className={styles.meta} block>
                        {t("testCaseItem.bugsLinked", {
                            count: testCase.bugs.length,
                            active: activeBugs,
                            closed: closedBugs,
                        })}
                    </Text>

                    <BugList bugs={testCase.bugs} />
                </>
            )}
        </Card>
    );
}
