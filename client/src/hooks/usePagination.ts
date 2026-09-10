import { useEffect, useMemo, useState } from "react";

// Client-side pagination over an already-fetched array - "lazy loading" here
// just means only the current page's rows ever mount, not a real fetch-more
// (every row is already on the client; see e.g. CycleTimeReportPage.tsx's
// per-epic task lists, which can run long once a project has real history).
export function usePagination<T>(items: T[], pageSize: number) {
    const [page, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

    // Falling back to a shorter list (an epic filter, a narrower result)
    // must not strand the view on a now-empty page past the new last one.
    useEffect(() => {
        if (page > pageCount - 1) {
            setPage(0);
        }
    }, [pageCount, page]);

    const pageItems = useMemo(() => {
        const start = page * pageSize;

        return items.slice(start, start + pageSize);
    }, [items, page, pageSize]);

    return {
        page,
        pageCount,
        pageItems,
        setPage,
        goToFirst: () => setPage(0),
    };
}
