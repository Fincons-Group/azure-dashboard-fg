import cron from "node-cron";
import "dotenv/config";
import { getDefectData, computeSprintDefectReport } from "./defectData.js";
import {
    sendTeamsMessage,
    buildBugsReportedTodayCard,
} from "./teamsNotifier.js";
import { writeSprintDefectReportFile } from "./sprintReportFileExport.js";

function isToday(dateString: string, timeZone: string): boolean {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    return fmt.format(new Date(dateString)) === fmt.format(new Date());
}

export function startBugSummaryScheduler(): void {
    if (process.env.ENABLE_TEAMS_NOTIFICATIONS !== "true") {
        return;
    }

    const schedule =
        process.env.TEAMS_DAILY_SUMMARY_CRON ?? "45 17 * * 1-5";
    const timezone =
        process.env.TEAMS_SUMMARY_TIMEZONE ?? "Europe/Rome";

    cron.schedule(
        schedule,
        async () => {
            try {
                const records = await getDefectData();
                const bugsToday = records.filter((record) =>
                    isToday(record.createdDate, timezone)
                );

                // No bugs reported today: stay silent rather than send an empty report.
                if (bugsToday.length === 0) {
                    return;
                }

                await sendTeamsMessage(
                    buildBugsReportedTodayCard(bugsToday)
                );
            } catch (error) {
                console.error(
                    "Failed to send daily bug report to Teams",
                    error
                );
            }
        },
        { timezone }
    );
}

export function startSprintReportFileExportScheduler(): void {
    const destinationFolder = process.env.SPRINT_REPORT_EXPORT_PATH;

    if (
        process.env.ENABLE_SPRINT_REPORT_EXPORT !== "true" ||
        !destinationFolder
    ) {
        return;
    }

    const schedule =
        process.env.SPRINT_REPORT_EXPORT_CRON ?? "0 18 * * *";
    const timezone =
        process.env.SPRINT_REPORT_EXPORT_TIMEZONE ?? "Europe/Rome";

    cron.schedule(
        schedule,
        async () => {
            try {
                const records = await getDefectData();
                const report = computeSprintDefectReport(records);
                const filePath = writeSprintDefectReportFile(
                    report,
                    destinationFolder
                );

                console.log(`Sprint Defect Report written to ${filePath}`);
            } catch (error) {
                console.error(
                    "Failed to write daily Sprint Defect Report file",
                    error
                );
            }
        },
        { timezone }
    );
}
