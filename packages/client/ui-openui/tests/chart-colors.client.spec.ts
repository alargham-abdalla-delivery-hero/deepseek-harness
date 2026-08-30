import { describe, expect, it } from 'vitest'
import { chartColor } from '../src/client/components/chart-colors.ts'

describe('chartColor', () => {
  it('wraps around the fixed palette by index', () => {
    expect(chartColor(0)).toBe('#4C6EF5')
    expect(chartColor(8)).toBe(chartColor(0))
  })

  it('falls back to the first palette color for an out-of-range index', () => {
    // JS `%` can return a negative result for a negative operand (`-1 % 8 === -1`),
    // which indexes before the array — a real, if unlikely, misuse of the public
    // function rather than dead code, since callers are not restricted to `.map()` indices.
    expect(chartColor(-1)).toBe('#4C6EF5')
  })
})
