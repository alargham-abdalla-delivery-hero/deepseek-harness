/** React implementation of the curated `BarChart` OpenUI component: plain SVG, no charting dependency. */
import { useState, type KeyboardEvent } from 'react'
import type { ChartDatum } from '@deepseek-ai/dsh-openui-lang'
import css from './BarChart.module.css'

export interface BarChartProps {
  data: ChartDatum[]
  title?: string
}

const VIEW_WIDTH = 480
const VIEW_HEIGHT = 220
const AXIS_LEFT = 36
const AXIS_BOTTOM = 24
const PLOT_TOP = 8
const BAR_GAP = 16
const TICK_COUNT = 4
const TICK_FORMAT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const ACTIVATE_KEYS = new Set(['Enter', ' '])

/** Round a rough tick step up to a "nice" 1/2/5×10ⁿ value. */
function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const fraction = roughStep / magnitude
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return niceFraction * magnitude
}

/** Evenly spaced axis ticks from 0 up to a "nice" round number at or above `max`. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0]
  const step = niceStep(max / TICK_COUNT)
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = 0; value <= niceMax + step / 2; value += step) ticks.push(value)
  return ticks
}

/** Render an OpenUI `BarChart` as a plain SVG bar chart with axis gridlines and a hover/click readout. */
export function BarChart({ data, title }: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const active = pinned ?? hovered
  const activePoint = active !== null ? data[active] : undefined

  const togglePin = (index: number): void => {
    setPinned(current => (current === index ? null : index))
  }
  const onKeyDown = (index: number) => (event: KeyboardEvent<SVGGElement>): void => {
    if (!ACTIVATE_KEYS.has(event.key)) return
    event.preventDefault()
    togglePin(index)
  }

  const max = Math.max(1, ...data.map(point => point.value))
  const ticks = ticksFor(max)
  const niceMax = ticks[ticks.length - 1] ?? max
  const plotWidth = VIEW_WIDTH - AXIS_LEFT
  const plotHeight = VIEW_HEIGHT - AXIS_BOTTOM - PLOT_TOP
  const plotBottom = VIEW_HEIGHT - AXIS_BOTTOM
  const barWidth = data.length > 0 ? (plotWidth - BAR_GAP * (data.length + 1)) / data.length : 0
  const yFor = (value: number): number => plotBottom - (value / niceMax) * plotHeight

  return (
    <div className={css.chart} data-openui-component="BarChart">
      <div className={css.header}>
        {title !== undefined && <h3 className={css.title}>{title}</h3>}
        {activePoint !== undefined && (
          <span className={css.readout}>{activePoint.label}: {activePoint.value}</span>
        )}
      </div>
      <svg className={css.svg} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={title ?? 'Bar chart'}>
        {ticks.map(tick => (
          <g key={tick}>
            <line className={css.gridline} x1={AXIS_LEFT} x2={VIEW_WIDTH} y1={yFor(tick)} y2={yFor(tick)} />
            <text className={css.axisLabel} x={AXIS_LEFT - 6} y={yFor(tick)} textAnchor="end" dominantBaseline="middle">
              {TICK_FORMAT.format(tick)}
            </text>
          </g>
        ))}
        {data.map((point, index) => {
          const barHeight = (point.value / niceMax) * plotHeight
          const x = AXIS_LEFT + BAR_GAP + index * (barWidth + BAR_GAP)
          const y = plotBottom - barHeight
          const isActive = index === active
          const isDimmed = active !== null && !isActive
          const barClass = `${css.bar} ${isActive ? css.barActive : ''} ${isDimmed ? css.barDimmed : ''}`
          return (
            <g
              key={point.label}
              className={css.barGroup}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value}`}
              aria-pressed={pinned === index}
              onMouseEnter={() => { setHovered(index) }}
              onMouseLeave={() => { setHovered(null) }}
              onFocus={() => { setHovered(index) }}
              onBlur={() => { setHovered(null) }}
              onClick={() => { togglePin(index) }}
              onKeyDown={onKeyDown(index)}
            >
              <rect className={barClass} x={x} y={y} width={barWidth} height={barHeight} rx={3} />
              <text className={css.categoryLabel} x={x + barWidth / 2} y={plotBottom + 16}>
                {point.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
