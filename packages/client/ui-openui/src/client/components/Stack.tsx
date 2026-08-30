/** React implementation of the curated `Stack` OpenUI component — always the root element. */
import type { ReactNode } from 'react'
import css from './Stack.module.css'

export interface StackProps {
  children: ReactNode[]
}

/** Render an OpenUI `Stack` as a vertical layout of its already-rendered children. */
export function Stack({ children }: StackProps) {
  return <div className={css.stack} data-openui-component="Stack">{children}</div>
}
