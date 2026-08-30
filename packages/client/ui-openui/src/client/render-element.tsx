/**
 * Recursive renderer over one OpenUI parsed element tree. Deliberately does
 * NOT use `@openuidev/react-lang`'s `<Renderer>` (which re-parses raw OpenUI
 * Lang text client-side): the harness already validated the source
 * server-side (`dsh-tool-openui`), so this walks the already-validated,
 * already-persisted tree from `result.meta` and never re-parses text — see
 * design.md Decision 3/4.
 * @module @deepseek-ai/dsh-client-ui-openui/client/render-element
 */

import { createElement, type ReactNode } from 'react'
import type { ComponentRenderers, ElementNode, SubComponentOf } from '@deepseek-ai/dsh-openui-lang'

/**
 * One curated component's client-side implementation: props in, React nodes
 * out. `any` is deliberate — this is the heterogeneous dispatch boundary
 * unifying differently-typed leaf components (`HeadingProps`, `CardProps`,
 * …) for tree-walking; each concrete component keeps its own typed props.
 */
// oxlint-disable-next-line typescript/no-explicit-any
export type OpenUIComponent = (props: any) => ReactNode

/** The curated component map, keyed by name, supplied to {@link renderElement}. */
export type ClientComponentMap = ComponentRenderers<OpenUIComponent>

function isElementLike(value: unknown): value is ElementNode | SubComponentOf<unknown> {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'element'
}

function elementKey(node: ElementNode | SubComponentOf<unknown>, fallback: string): string {
  // `exactOptionalPropertyTypes` guarantees a present `statementId` is a real
  // string, never explicit `undefined` — the `in` check alone narrows fully.
  return 'statementId' in node ? node.statementId : fallback
}

/**
 * Recursively evaluate one prop value: an array maps each element-like item to
 * its rendered subtree with a stable fallback key, everything else (string,
 * number, nested plain object) passes through untouched. Every curated
 * component's sub-component prop is declared as an array (`z.array(...ref)`)
 * — none nests a single sub-component directly — so a bare element-like value
 * outside an array cannot occur for the current vocabulary and is not handled
 * here; extend this if a future component needs it.
 */
function resolveProp(value: unknown, components: ClientComponentMap, keyPrefix: string): unknown {
  if (!Array.isArray(value)) return value
  // React's ReactElement defaults its type parameters to `any`, so a returned
  // ReactNode reads as any-tainted to the linter even though the value is
  // exactly what renderElement's own ReactNode-typed return promises.
  // oxlint-disable-next-line typescript/no-unsafe-return
  return value.map((item, index) => (
    isElementLike(item) ? renderElement(item, components, `${keyPrefix}-${index}`) : item
  ))
}

/**
 * Render one parsed OpenUI element (and its whole subtree) into React nodes,
 * dispatching on `typeName` against the curated component map. An element
 * outside the current renderer's component set gets a visible fallback
 * instead of being silently dropped or throwing.
 * @param node - the element (or nested sub-component) to render.
 * @param components - the curated name-to-component map.
 * @param fallbackKey - React list key used only when the node carries no `statementId` (an inline element).
 * @returns the rendered subtree.
 */
export function renderElement(
  node: ElementNode | SubComponentOf<unknown>,
  components: ClientComponentMap,
  fallbackKey = 'root',
): ReactNode {
  const key = elementKey(node, fallbackKey)
  const Component = (components as unknown as Record<string, OpenUIComponent | undefined>)[node.typeName]
  if (Component === undefined) {
    return createElement('div', { key, 'data-openui-unknown': node.typeName }, `Unsupported UI element: ${node.typeName}`)
  }
  const resolvedProps: Record<string, unknown> = {}
  for (const [propKey, value] of Object.entries(node.props as Record<string, unknown>)) {
    resolvedProps[propKey] = resolveProp(value, components, `${key}.${propKey}`)
  }
  return createElement(Component, { key, ...resolvedProps }) as ReactNode
}
