/** React implementation of the curated `List` OpenUI component. */
import type { ReactNode } from 'react'
import css from './List.module.css'

export interface ListProps {
  items: ReactNode[]
}

/** Render an OpenUI `List` as a `ul` of its already-rendered `ListItem` children. */
export function List({ items }: ListProps) {
  return <ul className={css.list} data-openui-component="List">{items}</ul>
}
