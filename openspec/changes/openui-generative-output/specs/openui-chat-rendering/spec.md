## ADDED Requirements

### Requirement: Web client owns rendering of `render_ui` via the keyed toolview slot
The system SHALL register a web-client plugin that claims the `tool.call.toolview` slot for the key `render_ui`, so a settled `render_ui` call renders as interactive UI inside the chat turn instead of the generic fallback card.

#### Scenario: `render_ui` result displayed in the web chat client
- **WHEN** a `render_ui` tool call settles successfully in a session viewed through the web chat client
- **THEN** the chat turn displays the rendered UI produced from the call's persisted element tree, in place of the generic card

#### Scenario: Web client without the plugin installed
- **WHEN** the web chat client has not installed the `render_ui` keyed toolview plugin
- **THEN** the tool call falls back to the generic card, exactly as any other unclaimed tool name does

### Requirement: Rendering is a pure, replay-safe function of the persisted result
The system SHALL derive the rendered UI only from the `render_ui` tool call's persisted arguments and result value, performing no I/O, session-state reads, or nondeterministic computation, so the same rendering reproduces identically on live streaming and on session-log replay.

#### Scenario: Replaying a past session
- **WHEN** a previously logged session containing a settled `render_ui` call is replayed in the web chat client
- **THEN** the client reproduces the same rendered UI as it did when the call first settled, using only the logged call and result

### Requirement: Client renderer's component set matches the shared vocabulary exactly
The system SHALL implement a React component for every component in the shared OpenUI component vocabulary used by server-side validation, and SHALL NOT silently drop or substitute an unrecognized element while rendering a validated tree.

#### Scenario: Tree uses only vocabulary components
- **WHEN** the persisted element tree contains only components from the shared vocabulary
- **THEN** every element in the tree renders using its corresponding React component

#### Scenario: Tree contains an element outside the current renderer's component set
- **WHEN** the persisted element tree contains a component the client's current renderer does not implement (e.g. the client is running an older version than the vocabulary that validated the tree)
- **THEN** the client renders a visible fallback for that element instead of silently omitting it or throwing an unhandled error that breaks the rest of the chat turn
