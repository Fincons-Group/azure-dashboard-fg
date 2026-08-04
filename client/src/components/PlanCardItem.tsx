import { Text, Title3, makeStyles, tokens } from "@fluentui/react-components";
import { ClipboardTaskListLtrRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { TestPlanSummary } from "../types";

const useStyles = makeStyles({
    card: {
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        textDecorationLine: "none",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        ":hover": {
            boxShadow: tokens.shadow8,
        },
    },
    title: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
    },
});

export function PlanCardItem({ plan }: { plan: TestPlanSummary }) {
    const styles = useStyles();
    const { t } = useTranslation();

    return (
        <Link
            to={`/plans/${plan.id}`}
            state={{ plan }}
            className={styles.card}
        >
            <Title3 as="h3" className={styles.title}>
                <ClipboardTaskListLtrRegular aria-hidden="true" />
                {plan.name}
            </Title3>

            {plan.state && (
                <Text>{t("planCard.state", { state: plan.state })}</Text>
            )}

            {plan.areaPath && (
                <Text>{t("planCard.area", { areaPath: plan.areaPath })}</Text>
            )}

            {plan.iteration && (
                <Text>
                    {t("planCard.iteration", { iteration: plan.iteration })}
                </Text>
            )}

            {plan.owner && (
                <Text>{t("planCard.owner", { owner: plan.owner })}</Text>
            )}
        </Link>
    );
}
