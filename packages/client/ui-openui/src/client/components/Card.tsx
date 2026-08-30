/** React implementation of the curated `Card` OpenUI component. */
import type { ReactNode } from 'react'

export interface CardProps {
  children: ReactNode[]
  title?: string
}

/** Render an OpenUI `Card` as a titled container around its already-rendered children. */
export function Card({ children, title }: CardProps) {
  return (
    <section data-openui-component="Card">
      {title !== undefined && <h3>{title}</h3>}
      {children}
    </section>
  )
}
