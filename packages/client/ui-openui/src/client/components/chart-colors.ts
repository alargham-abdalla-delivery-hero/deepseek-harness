/**
 * Chart color tokens shared by `BarChart` and `PieChart`. Values are CSS
 * custom-property references into `@deepseek-ai/dsh-client-ui-theme`'s design
 * tokens (not literal hex), so charts stay in sync with the active light/dark
 * theme instead of carrying their own fixed palette.
 */

/** Single accent used for every bar in `BarChart` — one data series, one color. */
export const CHART_ACCENT = 'var(--dsw-alias-state-business-primary)'

/** Distinct-but-harmonious tones (one brand hue at different steps) for `PieChart`'s categories. */
const CATEGORY_PALETTE: readonly string[] = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-static-deepseek-300)',
  'var(--dsw-static-deepseek-600)',
  'var(--dsw-static-deepseek-100)',
  'var(--dsw-static-deepseek-800)',
  'var(--dsw-static-deepseek-450)',
  'var(--dsw-static-deepseek-200)',
  'var(--dsw-static-deepseek-900)',
]

/**
 * Pick a palette color for a data-point index, wrapping around the fixed palette.
 * @param index - the data point's position, zero-based.
 * @returns a CSS `var(--dsw-...)` color reference.
 */
export function chartColor(index: number): string {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] ?? CHART_ACCENT
}
