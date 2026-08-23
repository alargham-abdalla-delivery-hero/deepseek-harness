/** React implementation of the curated `Text` OpenUI component. */

export interface TextProps {
  text: string
}

/** Render an OpenUI `Text` as a plain paragraph. */
export function Text({ text }: TextProps) {
  return <p data-openui-component="Text">{text}</p>
}
