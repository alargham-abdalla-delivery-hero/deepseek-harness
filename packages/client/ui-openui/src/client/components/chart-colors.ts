/** Fixed color palette shared by `BarChart` and `PieChart`, assigned by data-point index. */
export const CHART_COLORS: readonly string[] = [
  '#4C6EF5', '#12B886', '#F59F00', '#E64980', '#7048E8', '#15AABF', '#FA5252', '#82C91E',
]

/** Pick a palette color for a data-point index, wrapping around the fixed palette. */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? '#4C6EF5'
}
