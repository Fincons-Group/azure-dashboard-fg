// Recharts reserves exactly the given `width` for a vertical category axis's
// tick labels; anything wider than that is drawn past the chart's left edge
// and clipped by the SVG viewport instead of wrapping. A fixed width works
// until a label is longer than expected (e.g. a long suite/component name),
// so size the axis to the longest label actually being rendered.
export function categoryAxisWidth(
    labels: string[],
    options: { min?: number; max?: number; charWidth?: number; padding?: number } = {}
): number {
    const { min = 120, max = 280, charWidth = 6.5, padding = 24 } = options;

    const longest = labels.reduce(
        (len, label) => Math.max(len, label.length),
        0
    );

    return Math.min(max, Math.max(min, Math.round(longest * charWidth) + padding));
}
