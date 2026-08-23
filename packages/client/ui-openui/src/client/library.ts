/**
 * The web client's component map: the same curated name graph
 * `@deepseek-ai/dsh-openui-lang` validates server-side, bound here to real
 * React implementations. The `ClientComponentMap` (= `ComponentRenderers`)
 * annotation requires a value for every curated name, so adding a component
 * to the shared spec without adding its React implementation here is a
 * compile error, not a silent gap — a pure type-level check, so this module
 * imports only `dsh-openui-lang`'s types (erased at compile time) and never
 * pulls its `@openuidev/lang-core` runtime dependency into the browser bundle.
 * @module @deepseek-ai/dsh-client-ui-openui/client/library
 */

import type { ClientComponentMap } from './render-element.tsx'
import { Card } from './components/Card.tsx'
import { Heading } from './components/Heading.tsx'
import { List } from './components/List.tsx'
import { ListItem } from './components/ListItem.tsx'
import { Stack } from './components/Stack.tsx'
import { Table } from './components/Table.tsx'
import { Text } from './components/Text.tsx'

export const COMPONENTS: ClientComponentMap = { Heading, Text, ListItem, List, Table, Card, Stack }
