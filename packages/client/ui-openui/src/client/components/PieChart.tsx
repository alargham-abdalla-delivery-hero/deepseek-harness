/** React implementation of the curated `PieChart` OpenUI component: plain SVG, no charting dependency. */
import type { ChartDatum } from '@deepseek-ai/dsh-openui-lang'
import { chartColor } from './chart-colors.ts'

export interface PieChartProps {
  data: ChartDatum[]
  title?: string
}

const CENTER = 100
const RADIUS = 80

/** A point on a circle of `radius` around `(cx, cy)`, `angleDeg` clockwise from the top. */
function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) }
}

/** An SVG path for one pie slice spanning `[startAngle, endAngle)` degrees clockwise from the top. */
function slicePath(startAngle: number, endAngle: number): string {
  const start = pointOnCircle(CENTER, CENTER, RADIUS, endAngle)
  const end = pointOnCircle(CENTER, CENTER, RADIUS, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

/** Render an OpenUI `PieChart` as a plain SVG pie with a text legend. */
export function PieChart({ data, title }: PieChartProps) {
  const total = data.reduce((sum, point) => sum + point.value, 0) || 1
  let cursor = 0
  const slices = data.map((point, index) => {
    const angle = (point.value / total) * 360
    // A single slice spanning the whole circle degenerates to a zero-length
    // arc (identical start/end points); draw a full circle instead.
    const path = data.length === 1
      ? `M ${CENTER - RADIUS} ${CENTER} A ${RADIUS} ${RADIUS} 0 1 0 ${CENTER + RADIUS} ${CENTER} A ${RADIUS} ${RADIUS} 0 1 0 ${CENTER - RADIUS} ${CENTER} Z`
      : slicePath(cursor, cursor + angle)
    cursor += angle
    return { path, color: chartColor(index), label: point.label, value: point.value }
  })
  return (
    <div data-openui-component="PieChart">
      {title !== undefined && <h3>{title}</h3>}
      <svg viewBox={`0 0 ${CENTER * 2} ${CENTER * 2}`} role="img" aria-label={title ?? 'Pie chart'}>
        {slices.map(slice => <path key={slice.label} d={slice.path} fill={slice.color} />)}
      </svg>
      <ul>
        {slices.map(slice => (
          <li key={slice.label}>
            <span style={{ backgroundColor: slice.color, display: 'inline-block', width: '0.75em', height: '0.75em', marginRight: '0.4em' }} />
            {slice.label}: {slice.value}
          </li>
        ))}
      </ul>
    </div>
  )
}
