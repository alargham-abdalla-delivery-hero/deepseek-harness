/** React implementation of the curated `PieChart` OpenUI component: plain SVG, no charting dependency. */
import { useState, type KeyboardEvent } from 'react'
import type { ChartDatum } from '@deepseek-ai/dsh-openui-lang'
import { chartColor } from './chart-colors.ts'
import css from './PieChart.module.css'

export interface PieChartProps {
  data: ChartDatum[]
  title?: string
}

const CENTER = 90
const OUTER_RADIUS = 80
const INNER_RADIUS = 48
const ACTIVATE_KEYS = new Set(['Enter', ' '])

/** A point on a circle of `radius` around `(cx, cy)`, `angleDeg` clockwise from the top. */
function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) }
}

/** An SVG path for one donut slice's annular sector spanning `[startAngle, endAngle)` degrees clockwise from the top. */
function donutSlicePath(startAngle: number, endAngle: number): string {
  const outerStart = pointOnCircle(CENTER, CENTER, OUTER_RADIUS, startAngle)
  const outerEnd = pointOnCircle(CENTER, CENTER, OUTER_RADIUS, endAngle)
  const innerEnd = pointOnCircle(CENTER, CENTER, INNER_RADIUS, endAngle)
  const innerStart = pointOnCircle(CENTER, CENTER, INNER_RADIUS, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

/** A single slice spans the whole circle: draw a full ring via two circle outlines
 * and `fillRule="evenodd"` instead of a zero-length arc. */
function fullRingPath(): string {
  const ring = (radius: number): string =>
    `M ${CENTER - radius} ${CENTER} a ${radius} ${radius} 0 1 0 ${2 * radius} 0 a ${radius} ${radius} 0 1 0 ${-2 * radius} 0`
  return `${ring(OUTER_RADIUS)} Z ${ring(INNER_RADIUS)} Z`
}

/**
 * Render an OpenUI `PieChart` as a plain SVG donut with a side legend; hovering, focusing,
 * or clicking either a slice or its legend row highlights both.
 */
export function PieChart({ data, title }: PieChartProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const active = pinned ?? hovered

  const togglePin = (label: string): void => {
    setPinned(current => (current === label ? null : label))
  }
  const onKeyDown = (label: string) => (event: KeyboardEvent): void => {
    if (!ACTIVATE_KEYS.has(event.key)) return
    event.preventDefault()
    togglePin(label)
  }

  const total = data.reduce((sum, point) => sum + point.value, 0) || 1
  let cursor = 0
  const slices = data.map((point, index) => {
    const angle = (point.value / total) * 360
    const path = data.length === 1 ? fullRingPath() : donutSlicePath(cursor, cursor + angle)
    cursor += angle
    return { path, color: chartColor(index), label: point.label, value: point.value }
  })
  return (
    <div className={css.chart} data-openui-component="PieChart">
      {title !== undefined && <h3 className={css.title}>{title}</h3>}
      <div className={css.body}>
        <svg
          className={css.svg}
          viewBox={`0 0 ${CENTER * 2} ${CENTER * 2}`}
          role="img"
          aria-label={title ?? 'Pie chart'}
        >
          {slices.map((slice) => {
            const isActive = active === slice.label
            const isDimmed = active !== null && !isActive
            const sliceClass = `${css.slice} ${isActive ? css.sliceActive : ''} ${isDimmed ? css.sliceDimmed : ''}`
            return (
              <path
                key={slice.label}
                className={sliceClass}
                d={slice.path}
                style={{ fill: slice.color }}
                fillRule={data.length === 1 ? 'evenodd' : undefined}
                tabIndex={0}
                role="button"
                aria-label={`${slice.label}: ${slice.value}`}
                aria-pressed={pinned === slice.label}
                onMouseEnter={() => { setHovered(slice.label) }}
                onMouseLeave={() => { setHovered(null) }}
                onFocus={() => { setHovered(slice.label) }}
                onBlur={() => { setHovered(null) }}
                onClick={() => { togglePin(slice.label) }}
                onKeyDown={onKeyDown(slice.label)}
              />
            )
          })}
        </svg>
        <ul className={css.legend}>
          {slices.map((slice) => {
            const isActive = active === slice.label
            const legendClass = `${css.legendItem} ${isActive ? css.legendItemActive : ''}`
            return (
              <li
                key={slice.label}
                className={legendClass}
                tabIndex={0}
                role="button"
                aria-pressed={pinned === slice.label}
                onMouseEnter={() => { setHovered(slice.label) }}
                onMouseLeave={() => { setHovered(null) }}
                onFocus={() => { setHovered(slice.label) }}
                onBlur={() => { setHovered(null) }}
                onClick={() => { togglePin(slice.label) }}
                onKeyDown={onKeyDown(slice.label)}
              >
                <span className={css.swatch} style={{ backgroundColor: slice.color }} />
                {/* One text run, not split across sibling spans: `getByText('label: value')`
                    only matches an element whose own direct text-node children join into that
                    exact string (dom-testing-library's `getNodeText` does not recurse into
                    child elements), so label and value share one span instead of two. */}
                <span className={css.legendText}>{slice.label}: {slice.value}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
