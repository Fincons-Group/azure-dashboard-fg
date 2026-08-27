// Entries are matched either as a bare domain ("finconsgroup.com", matched
// against the part after "@") or a full address ("name@finconsgroup.com",
// matched exactly) - lets the allowlist mix "anyone at this domain" with
// one-off external addresses without two separate env vars.
//
// The rest of this module (Teams webhook sends, MessageCard builders, the
// scheduled "verifica" notification cron jobs) was removed on this
// sprint-report-only branch along with scheduler.ts - these two helpers
// survive because defectData.ts still uses them to bucket verifica activity
// by assignee/domain for the sprint report's VerificaActivitySummary.
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
