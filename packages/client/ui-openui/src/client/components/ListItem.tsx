/** React implementation of the curated `ListItem` OpenUI component. */

export interface ListItemProps {
  text: string
}

/** Render an OpenUI `ListItem` as an `li`. */
export function ListItem({ text }: ListItemProps) {
  return <li data-openui-component="ListItem">{text}</li>
}
