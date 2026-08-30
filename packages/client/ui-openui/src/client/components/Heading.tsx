/** React implementation of the curated `Heading` OpenUI component. */
import { createElement } from 'react'
import css from './Heading.module.css'

export interface HeadingProps {
  text: string
  level?: 1 | 2 | 3
}

const LEVEL_CLASS = { 1: css.level1, 2: css.level2, 3: css.level3 } as const

/** Render an OpenUI `Heading` as the matching `h1`/`h2`/`h3` element. */
export function Heading({ text, level = 2 }: HeadingProps) {
  const className = `${css.heading} ${LEVEL_CLASS[level]}`
  return createElement(`h${level}`, { className, 'data-openui-component': 'Heading' }, text)
}
