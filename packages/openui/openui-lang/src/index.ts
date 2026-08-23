/**
 * Shared OpenUI Lang component vocabulary. Owns the one curated component
 * graph (name, Zod props schema, description) that both the server-side
 * `render_ui` tool (validation + system-prompt generation) and the web
 * client's renderer build their respective `Library` from, so the taught
 * grammar, the server validator, and the drawable component set cannot
 * silently drift apart. No component here accepts a URL, raw markup, or
 * arbitrary script — see README "Known Limitations and Deferred Work".
 * @module @deepseek-ai/dsh-openui-lang
 */

import { createLibrary, createParser, defineComponent } from '@openuidev/lang-core'
import type { Library, PromptOptions } from '@openuidev/lang-core'
import { z } from 'zod'
export type * from './types.ts'
import type { ComponentRenderers, OpenUIRenderResult } from './types.ts'

/**
 * Build the curated OpenUI component library from one renderer-payload map.
 * Every call site supplies a value for every component name — the server
 * passes an all-`undefined` map (lang-core never inspects `component`), the
 * web client passes real React components — so both sides construct the
 * identical component graph and can never register a different vocabulary.
 * @param renderers - one renderer payload per curated component name.
 * @returns the constructed OpenUI `Library`.
 */
export function buildLibrary<C>(renderers: ComponentRenderers<C>): Library<C> {
  const Heading = defineComponent({
    name: 'Heading',
    description: 'A section heading.',
    props: z.object({
      text: z.string().describe('Heading text.'),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)])
        .optional()
        .describe('Heading level, 1 (largest) to 3 (smallest). Defaults to 2.'),
    }),
    component: renderers.Heading,
  })

  const Text = defineComponent({
    name: 'Text',
    description: 'A paragraph of plain text.',
    props: z.object({
      text: z.string().describe('The paragraph text.'),
    }),
    component: renderers.Text,
  })

  const ListItem = defineComponent({
    name: 'ListItem',
    description: 'One item in a List.',
    props: z.object({
      text: z.string().describe('The item text.'),
    }),
    component: renderers.ListItem,
  })

  const List = defineComponent({
    name: 'List',
    description: 'A bulleted list of ListItem entries.',
    props: z.object({
      items: z.array(ListItem.ref).describe('The list items, in display order.'),
    }),
    component: renderers.List,
  })

  const Table = defineComponent({
    name: 'Table',
    description: 'A simple data table of plain-text cells.',
    props: z.object({
      columns: z.array(z.string()).describe('Column header labels, in display order.'),
      rows: z.array(z.array(z.string())).describe('Row data; each row is an array of cell text matching the column order.'),
    }),
    component: renderers.Table,
  })

  const chartData = z.array(z.object({
    label: z.string().describe('The data point label.'),
    value: z.number().describe('The data point value.'),
  })).describe('The chart data points, in display order.')

  const BarChart = defineComponent({
    name: 'BarChart',
    description: 'A bar chart comparing labeled numeric values.',
    props: z.object({
      data: chartData,
      title: z.string().optional().describe('Optional chart title.'),
    }),
    component: renderers.BarChart,
  })

  const PieChart = defineComponent({
    name: 'PieChart',
    description: 'A pie chart showing labeled values as proportions of a whole.',
    props: z.object({
      data: chartData,
      title: z.string().optional().describe('Optional chart title.'),
    }),
    component: renderers.PieChart,
  })

  const Card = defineComponent({
    name: 'Card',
    description: 'A titled container grouping related content.',
    // OpenUI Lang arguments are strictly positional (no named/colon syntax) and
    // "optional arguments can be omitted from the end" — the required field
    // MUST precede the optional one, or a positional call omitting `title`
    // mis-binds its first argument (the children array) to `title` instead.
    props: z.object({
      children: z.array(z.union([Heading.ref, Text.ref, List.ref, Table.ref, BarChart.ref, PieChart.ref]))
        .describe('The card body content, in display order.'),
      title: z.string().optional().describe('Optional card title.'),
    }),
    component: renderers.Card,
  })

  const Stack = defineComponent({
    name: 'Stack',
    description: 'The top-level vertical layout. Always the root element.',
    props: z.object({
      children: z.array(z.union([Card.ref, Heading.ref, Text.ref, List.ref, Table.ref, BarChart.ref, PieChart.ref]))
        .describe('The top-level content blocks, in display order.'),
    }),
    component: renderers.Stack,
  })

  return createLibrary({
    components: [Heading, Text, ListItem, List, Table, BarChart, PieChart, Card, Stack],
    root: 'Stack',
  })
}

/** Every curated component's server-side renderer payload: lang-core never inspects it. */
const SERVER_RENDERERS: ComponentRenderers<undefined> = {
  Heading: undefined,
  Text: undefined,
  ListItem: undefined,
  List: undefined,
  Table: undefined,
  BarChart: undefined,
  PieChart: undefined,
  Card: undefined,
  Stack: undefined,
}

/** The one server-side `Library` instance, built once and reused for every parse/prompt call. */
const SERVER_LIBRARY = buildLibrary(SERVER_RENDERERS)

/** Parser bound to the server library's JSON Schema, built once and reused across calls. */
const PARSER = createParser(SERVER_LIBRARY.toJSONSchema())

/**
 * Generate the OpenUI Lang system-prompt text (syntax rules + component
 * signatures) from the exact vocabulary the server-side parser validates
 * against, so the taught grammar and the validator cannot drift apart.
 * @param options - optional preamble/examples/rules passed through to `Library.prompt`.
 * @returns the prompt text to contribute as a system-prompt section.
 */
export function promptText(options?: PromptOptions): string {
  return SERVER_LIBRARY.prompt(options)
}

/**
 * Parse and validate one OpenUI Lang source string against the curated
 * component vocabulary. Never throws for malformed or partially invalid
 * model output — an unknown component or invalid prop is dropped from the
 * tree and reported in `errors` (OpenUI's own lenient parse behavior); only
 * a genuine parser implementation failure should propagate as a thrown error.
 * @param source - the OpenUI Lang source text to parse.
 * @returns the root element tree (or `null`), any validation errors, and whether the input looked incomplete.
 */
export function parseSource(source: string): OpenUIRenderResult {
  const result = PARSER.parse(source)
  return { root: result.root, errors: result.meta.errors, incomplete: result.meta.incomplete }
}
