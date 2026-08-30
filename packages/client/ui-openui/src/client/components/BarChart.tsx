/** React implementation of the curated `BarChart` OpenUI component: plain SVG, no charting dependency. */
import type { ChartDatum } from '@deepseek-ai/dsh-openui-lang'
import { chartColor } from './chart-colors.ts'

export interface BarChartProps {
  data: ChartDatum[]
  title?: string
}

const VIEW_WIDTH = 320
const VIEW_HEIGHT = 200
const BAR_GAP = 12
const AXIS_HEIGHT = 24
const LABEL_MARGIN = 4

/** Render an OpenUI `BarChart` as a plain SVG bar chart. */
export function BarChart({ data, title }: BarChartProps) {
  const max = Math.max(1, ...data.map(d => d.value))
  const barWidth = data.length > 0 ? (VIEW_WIDTH - BAR_GAP * (data.length + 1)) / data.length : 0
  return (
    <div data-openui-component="BarChart">
      {title !== undefined && <h3>{title}</h3>}
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={title ?? 'Bar chart'}>
        {data.map((point, index) => {
          const barHeight = (point.value / max) * (VIEW_HEIGHT - AXIS_HEIGHT - LABEL_MARGIN * 2)
          const x = BAR_GAP + index * (barWidth + BAR_GAP)
          const y = VIEW_HEIGHT - AXIS_HEIGHT - barHeight
          return (
            <g key={point.label}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={chartColor(index)} />
              <text x={x + barWidth / 2} y={VIEW_HEIGHT - AXIS_HEIGHT + 12} textAnchor="middle" fontSize="10">
                {point.label}
              </text>
              <text x={x + barWidth / 2} y={y - LABEL_MARGIN} textAnchor="middle" fontSize="10">
                {point.value}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
