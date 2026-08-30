/** React implementation of the curated `ListItem` OpenUI component. */
import css from './ListItem.module.css'

export interface ListItemProps {
  text: string
}

/** Render an OpenUI `ListItem` as an `li` with a leading bullet marker. */
export function ListItem({ text }: ListItemProps) {
  return (
    <li className={css.item} data-openui-component="ListItem">
      <span className={css.bullet} />
      {text}
    </li>
  )
}
