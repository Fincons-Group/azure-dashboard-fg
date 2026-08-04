export const BUG_STATE_ORDER = [
    "New",
    "In Lavorazione",
    "Resolved",
    "Da verificare",
    "In verifica",
    "Riaperto",
    "Closed",
];

const CLOSED_INDEX = BUG_STATE_ORDER.indexOf("Closed");

export function compareByState(
    a: { state: string },
    b: { state: string }
): number {
    const indexOf = (state: string) => {
        const idx = BUG_STATE_ORDER.indexOf(state);
        return idx === -1 ? CLOSED_INDEX : idx;
    };

    return indexOf(a.state) - indexOf(b.state);
}
