import axios from "axios";
import "dotenv/config";
import type { DefectRecord } from "./types.js";

// Entries are matched either as a bare domain ("finconsgroup.com", matched
// against the part after "@") or a full address ("name@finconsgroup.com",
// matched exactly) - lets the allowlist mix "anyone at this domain" with
// one-off external addresses without two separate env vars.
export function parseAllowedSenders(raw?: string): string[] {
    return (raw ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

export function isAllowedSender(
    email: string | undefined,
    allowedSenders: string[]
): boolean {
    if (!email) {
        return false;
    }

    const normalized = email.toLowerCase();
    const domain = normalized.split("@")[1];

    return allowedSenders.some((entry) =>
        entry.includes("@") ? entry === normalized : entry === domain
    );
}

export async function sendTeamsMessage(
    card: Record<string, unknown>,
    options: { webhookUrl?: string } = {}
): Promise<void> {
    const webhookUrl = options.webhookUrl ?? process.env.TEAMS_WEBHOOK_URL;

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
    options: { includeArea?: boolean; includeAssignee?: boolean } = {}
): string {
    const severity = bug.severity ?? "Unspecified";
    const priority =
        bug.priority != null ? String(bug.priority) : "Unspecified";

    const facts = [`Severity: ${severity}`, `Priority: ${priority}`];

    if (options.includeArea) {
        facts.push(`Area: ${bug.areaPath}`);
    }

    if (options.includeAssignee) {
        facts.push(`Assignee: ${bug.assignedTo?.displayName ?? "Unassigned"}`);
    }

    const link = bug.url ? `[Open in Azure DevOps](${bug.url})` : "";

    return [`**#${bug.id} - ${bug.title}**`, facts.join(" · "), link]
        .filter(Boolean)
        .join("  \n");
}

export function buildBugsReportedTodayCard(bugs: DefectRecord[]) {
    const recipient = process.env.TEAMS_GREETING_NAME ?? "team";
    const greeting = `Hey ${recipient}, ${bugs.length} bug(s) were created today`;

    const bugBlocks = bugs.map((bug) =>
        formatBugBlock(bug, { includeArea: true })
    );

    const text = [greeting, "", bugBlocks.join("\n\n---\n\n")].join("\n");

    return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "0078D4",
        summary: greeting,
        title: greeting,
        text,
    };
}

export function buildBugsToVerifyCard(bugs: DefectRecord[]) {
    const greeting = `${bugs.length} bug(s) are waiting "Da verificare"`;

    const bugBlocks = bugs.map((bug) =>
        formatBugBlock(bug, { includeArea: true, includeAssignee: true })
    );

    const text = [greeting, "", bugBlocks.join("\n\n---\n\n")].join("\n");

    return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "FFB900",
        summary: greeting,
        title: greeting,
        text,
    };
}
