## ADDED Requirements

### Requirement: `render_ui` tool accepts OpenUI Lang source
The system SHALL register a model-facing tool named `render_ui` whose input parameter is a single required string field containing OpenUI Lang source text, and whose description tells the model to use it to present structured or visual content instead of prose.

#### Scenario: Model calls the tool with a source string
- **WHEN** the model issues a `render_ui` call with a non-empty OpenUI Lang source string argument
- **THEN** the tool accepts the call and proceeds to server-side parsing without requiring any other argument

### Requirement: Server-side parse and validation against the fixed component vocabulary
The system SHALL parse and validate every `render_ui` call's source against the one shared, fixed component vocabulary before returning any result, and SHALL reject any component reference not present in that vocabulary.

#### Scenario: Valid source using only vocabulary components
- **WHEN** the source text uses only component names and props declared in the shared component vocabulary
- **THEN** the tool returns a successful result whose value contains the parsed, typed element tree

#### Scenario: Source references an unknown component
- **WHEN** the source text calls a component name that is not part of the shared component vocabulary
- **THEN** the tool returns a result marked as a parse failure identifying the unknown component, and does not return a partial or best-effort element tree

### Requirement: Parse failure is a domain outcome, not a thrown error
The system SHALL represent a syntax or validation failure in `render_ui`'s canonical result value rather than throwing, so the call is not marked `isError` for a recoverable model mistake; the system SHALL still throw for a genuine infrastructure failure such as the parser implementation crashing.

#### Scenario: Malformed OpenUI Lang syntax
- **WHEN** the source text does not conform to OpenUI Lang syntax
- **THEN** `execute` returns a value describing the failure with enough detail (e.g. line/location and reason) for the model to correct it on a later turn, and the call is not reported as `isError`

#### Scenario: Parser implementation failure
- **WHEN** the underlying parser throws for a reason unrelated to the model's input (e.g. an internal error)
- **THEN** the tool call is reported as `isError`

### Requirement: System-prompt guidance is generated from the same vocabulary the validator enforces
The system SHALL contribute a system-prompt section, present only when the `render_ui` tool is registered, whose OpenUI Lang syntax rules and component signatures are generated from the identical shared component vocabulary used for server-side validation.

#### Scenario: Tool registered in a session
- **WHEN** a session's plugin composition registers the `render_ui` tool
- **THEN** the assembled system prompt includes a section describing OpenUI Lang syntax and exactly the components the server-side validator accepts

#### Scenario: Tool not registered in a session
- **WHEN** a session's plugin composition does not register the `render_ui` tool
- **THEN** the assembled system prompt contains no OpenUI Lang guidance section

### Requirement: Non-rendering hosts receive a readable fallback presentation
The system SHALL project `render_ui` calls and results to the shared `generic` card render intent, so hosts without a rich renderer show a readable pending state and a readable success or failure summary.

#### Scenario: Pending call on any host
- **WHEN** a `render_ui` call is in flight
- **THEN** its presentation is a `generic` card indicating a UI is being rendered, derived only from the call arguments

#### Scenario: Settled result on a host without a rich renderer
- **WHEN** a `render_ui` call succeeds or fails and the host has not registered a rich renderer for this tool
- **THEN** the host displays a `generic` card summarizing the rendered component or the parse errors, using only the persisted result value
