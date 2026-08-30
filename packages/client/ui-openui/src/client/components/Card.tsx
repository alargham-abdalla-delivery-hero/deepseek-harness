/** React implementation of the curated `Card` OpenUI component. */
import type { ReactNode } from 'react'
import css from './Card.module.css'

export interface CardProps {
  children: ReactNode[]
  title?: string
}

/** Render an OpenUI `Card` as a titled section around its already-rendered children. */
export function Card({ children, title }: CardProps) {
  return (
    <section className={css.card} data-openui-component="Card">
      {title !== undefined && <h3 className={css.title}>{title}</h3>}
      <div className={css.content}>{children}</div>
    </section>
  )
}
