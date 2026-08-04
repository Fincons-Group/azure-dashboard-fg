import axios from "axios";
import "dotenv/config";
import type { DefectRecord } from "./types.js";

export async function sendTeamsMessage(
    card: Record<string, unknown>
): Promise<void> {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;

    if (
        process.env.ENABLE_TEAMS_NOTIFICATIONS !== "true" ||
        !webhookUrl
    ) {
        return;
    }

    await axios.post(webhookUrl, card);
}

// MessageCard "sections"/"facts" fields render as a flat text stream in some
// Teams flows (e.g. Power Automate webhook triggers), losing their visual
// grouping. The card below instead renders each bug as a markdown text
// block, which is the format that's known to render reliably.
function formatBugBlock(
    bug: DefectRecord,
    options: { includeArea?: boolean } = {}
): string {
    const severity = bug.severity ?? "Unspecified";
    const priority =
        bug.priority != null
            ? String(bug.priority)
            : "Unspecified";

    const facts = [
        `Severity: ${severity}`,
        `Priority: ${priority}`,
    ];

    if (options.includeArea) {
        facts.push(`Area: ${bug.areaPath}`);
    }

    const link = bug.url
        ? `[Open in Azure DevOps](${bug.url})`
        : "";

    return [
        `**#${bug.id} - ${bug.title}**`,
        facts.join(" · "),
        link,
    ]
        .filter(Boolean)
        .join("  \n");
}

export function buildBugsReportedTodayCard(
    bugs: DefectRecord[]
) {
    const recipient =
        process.env.TEAMS_GREETING_NAME ?? "team";
    const greeting = `Hey ${recipient}, ${bugs.length} bug(s) were created today`;

    const bugBlocks = bugs.map((bug) =>
        formatBugBlock(bug, { includeArea: true })
    );

    const text = [
        greeting,
        "",
        bugBlocks.join("\n\n---\n\n"),
    ].join("\n");

    return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "0078D4",
        summary: greeting,
        title: greeting,
        text,
    };
}
