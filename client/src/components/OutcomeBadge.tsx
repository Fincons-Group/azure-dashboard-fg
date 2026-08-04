import { Badge, type BadgeProps } from "@fluentui/react-components";
import {
    CheckmarkCircleFilled,
    DismissCircleFilled,
    ErrorCircleFilled,
    SubtractCircleFilled,
    CircleOffFilled,
    PauseCircleFilled,
    ArrowClockwiseFilled,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { Outcome } from "../types";

const outcomeConfig: Record<
    Outcome,
    { color: BadgeProps["color"]; icon: BadgeProps["icon"] }
> = {
    Passed: { color: "success", icon: <CheckmarkCircleFilled /> },
    Failed: { color: "danger", icon: <DismissCircleFilled /> },
    Blocked: { color: "severe", icon: <ErrorCircleFilled /> },
    NotApplicable: { color: "informative", icon: <CircleOffFilled /> },
    Paused: { color: "warning", icon: <PauseCircleFilled /> },
    InProgress: { color: "brand", icon: <ArrowClockwiseFilled /> },
    NotRun: { color: "subtle", icon: <SubtractCircleFilled /> },
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
    const { t } = useTranslation();
    const config = outcomeConfig[outcome];
    const label = t(`outcome.${outcome}`);

    return (
        <Badge
            color={config.color}
            icon={config.icon}
            appearance="filled"
            aria-label={t("outcome.ariaLabel", { outcome: label })}
        >
            {label}
        </Badge>
    );
}
