import "dotenv/config";
import { getDefectData, VERIFICA_STATE } from "./defectData.js";
import {
    sendTeamsMessage,
    buildBugsReportedTodayCard,
    buildBugsToVerifyCard,
    parseAllowedSenders,
    isAllowedSender,
} from "./teamsNotifier.js";

// Fixed check times (09:00/14:00/17:45 Europe/Rome), driven by an external
// scheduler (see .github/workflows/notify-teams-cron.yml, which wakes this
// server via HTTP since the free Render tier sleeps) - each trigger just
// looks at current Azure DevOps state and reports it, there's no "since
// last run" tracking to keep in sync with an external caller.
function isToday(dateString: string, timeZone: string): boolean {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    return fmt.format(new Date(dateString)) === fmt.format(new Date());
}

export async function sendBugsCreatedTodayReport(): Promise<{
    sent: boolean;
    count: number;
}> {
    const timezone = process.env.TEAMS_SUMMARY_TIMEZONE ?? "Europe/Rome";
    const records = await getDefectData();
    const bugsToday = records.filter((record) =>
        isToday(record.createdDate, timezone)
    );

    // No bugs reported today: stay silent rather than send an empty report.
    if (bugsToday.length === 0) {
        return { sent: false, count: 0 };
    }

    await sendTeamsMessage(buildBugsReportedTodayCard(bugsToday), {
        webhookUrl: process.env.TEAMS_WEBHOOK_URL_BUGS_REPORTED,
    });

    return { sent: true, count: bugsToday.length };
}

export async function sendVerificaCheck(): Promise<{
    sent: boolean;
    count: number;
}> {
    const project = process.env.TEAMS_VERIFICA_PROJECT || undefined;
    const allowedAssignees = parseAllowedSenders(
        process.env.TEAMS_VERIFICA_ALLOWED_SENDERS ?? "finconsgroup.com"
    );
    const records = await getDefectData(project);
    const toVerify = records.filter(
        (record) =>
            record.state === VERIFICA_STATE &&
            isAllowedSender(record.assignedTo?.uniqueName, allowedAssignees)
    );

    // Nothing waiting on QA: stay silent rather than send an empty report.
    if (toVerify.length === 0) {
        return { sent: false, count: 0 };
    }

    await sendTeamsMessage(buildBugsToVerifyCard(toVerify), {
        webhookUrl: process.env.TEAMS_WEBHOOK_URL_ASSIGNEE_VERIFICA,
    });

    return { sent: true, count: toVerify.length };
}
