/** React implementation of the curated `Text` OpenUI component. */
import css from './Text.module.css'

export interface TextProps {
  text: string
}

/** Render an OpenUI `Text` as a plain paragraph. */
export function Text({ text }: TextProps) {
  return <p className={css.text} data-openui-component="Text">{text}</p>
}
