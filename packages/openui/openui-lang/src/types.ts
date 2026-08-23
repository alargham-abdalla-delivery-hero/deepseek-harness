/** Type-only exports for the shared OpenUI Lang component vocabulary. @module @deepseek-ai/dsh-openui-lang/types */

import type { ElementNode, SubComponentOf, ValidationError } from '@openuidev/lang-core'

export type { ElementNode, SubComponentOf, ValidationError }

/**
 * One renderer-payload value per curated OpenUI component name. `C` is the
 * opaque per-consumer payload lang-core never inspects: the server library
 * builds this with every field `undefined`, the web client builds it with a
 * real React component per name — both read the identical component graph
 * (name, props schema, description) from this one shared definition.
 */
export interface ComponentRenderers<C> {
  readonly Heading: C
  readonly Text: C
  readonly ListItem: C
  readonly List: C
  readonly Table: C
  readonly Card: C
  readonly Stack: C
}

/**
 * The `render_ui` tool's canonical result shape: OpenUI's own lenient parse
 * outcome, trimmed to the fields the model and the client renderer need.
 * `root` is `null` only when parsing produced no resolvable root element yet
 * (e.g. the source never assigns `root`); a component with invalid or unknown
 * props is dropped from the tree and reported in `errors` instead of failing
 * the whole parse.
 */
export interface OpenUIRenderResult {
  /** The parsed root element tree, or `null` if no root resolved. */
  readonly root: ElementNode | null
  /** Humanized validation errors for any dropped or malformed element. */
  readonly errors: readonly ValidationError[]
  /** True when the parser detected truncated/incomplete input. */
  readonly incomplete: boolean
}
