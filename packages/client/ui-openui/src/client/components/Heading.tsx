/** React implementation of the curated `Heading` OpenUI component. */
import { createElement } from 'react'

export interface HeadingProps {
  text: string
  level?: 1 | 2 | 3
}

/** Render an OpenUI `Heading` as the matching `h1`/`h2`/`h3` element. */
export function Heading({ text, level = 2 }: HeadingProps) {
  return createElement(`h${level}`, { 'data-openui-component': 'Heading' }, text)
}
