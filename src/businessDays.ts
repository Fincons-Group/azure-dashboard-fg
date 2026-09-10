// Counts Mon-Fri days between two arbitrary past timestamps (elapsed time,
// not a countdown to a future deadline - see countBusinessDaysRemaining in
// client/src/components/SprintDefectReportTab.tsx for that different use
// case, which this deliberately doesn't share since the semantics differ).
// `from` itself is never counted, mirroring how a bug opened Monday morning
// and resolved Monday afternoon reads as "0 business days", not 1.
export function businessDaysBetween(from: Date, to: Date): number {
    const cursor = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate() + 1
    );
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

    let count = 0;

    while (cursor <= end) {
        const day = cursor.getDay();

        if (day !== 0 && day !== 6) {
            count++;
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return Math.max(count, 0);
}
