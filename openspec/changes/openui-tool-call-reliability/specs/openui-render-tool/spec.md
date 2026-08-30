## ADDED Requirements

### Requirement: Reliability mechanism ships inside the existing `render_ui` plugin
The system SHALL implement the worked-example prompt contribution and the turn-completion correction listener as additions to the existing `render_ui`-owning plugin (`dsh-tool-openui`), registered through that plugin's own `apply(ctx)`, and SHALL NOT introduce a new plugin package to host this behavior.

#### Scenario: Plugin composition after this change
- **WHEN** a session's plugin composition registers the `render_ui` tool
- **THEN** the same plugin registration also contributes the worked-example prompt text and the turn-completion correction listener, with no additional plugin package required to enable either

#### Scenario: Disabling the tool disables the correction
- **WHEN** a session's plugin composition does not register `dsh-tool-openui` (and therefore does not register `render_ui`)
- **THEN** no turn-completion correction listener for this behavior is registered either, since it exists solely inside that plugin's own registration

### Requirement: System-prompt guidance scopes OpenUI Lang to the tool argument, not the direct reply
The system SHALL NOT include, in the `render_ui` system-prompt section, any instruction stating or implying that the model's chat reply itself should be OpenUI Lang source; it SHALL instead state that OpenUI Lang is sent only as the `render_ui` tool's `source` argument.

#### Scenario: Tool registered in a session
- **WHEN** a session's plugin composition registers the `render_ui` tool
- **THEN** the assembled system prompt's OpenUI Lang guidance section states that OpenUI Lang source is sent as the `render_ui` tool's argument, and contains no instruction directing the model's own reply text to be OpenUI Lang

### Requirement: System-prompt guidance includes a worked tool-call example
The system SHALL include, in the `render_ui` system-prompt section, at least one concrete worked example demonstrating a correctly-formed `render_ui` tool call using OpenUI Lang source, in addition to the existing grammar rules and component signatures, and that example SHALL itself parse cleanly against the same shared component vocabulary the tool validates against.

#### Scenario: Tool registered in a session
- **WHEN** a session's plugin composition registers the `render_ui` tool
- **THEN** the assembled system prompt's OpenUI Lang guidance section includes a worked example of calling the tool correctly, not only syntax rules and component signatures

#### Scenario: The worked example is itself valid
- **WHEN** the worked example text is parsed against the shared component vocabulary
- **THEN** it resolves to a non-null root with no validation errors

### Requirement: A turn whose assistant text is unrouted OpenUI Lang is corrected before the turn closes
The system SHALL detect, at turn completion, when an assistant message contains text that parses cleanly to a non-trivial OpenUI Lang element tree and that same message contains no corresponding `render_ui` tool call, and SHALL steer the agent to retry that content as a `render_ui` tool call rather than allowing the turn to close with the unrendered text as its final answer.

#### Scenario: Model writes renderable OpenUI Lang as plain text
- **WHEN** a completed turn's assistant message contains a text block that parses to a non-null, error-free, non-trivial element tree, and the same message contains no `render_ui` tool call
- **THEN** the system steers the agent with a corrective instruction identifying the mistake and requesting the content be resent via `render_ui`, forcing another step before the turn closes

#### Scenario: Model calls the tool correctly
- **WHEN** a turn's model output eventually resolves to a `render_ui` tool call for the OpenUI-Lang-shaped content, with no OpenUI-Lang-shaped text left unrouted in the turn's final message
- **THEN** the system does not steer the agent for that turn

#### Scenario: Text does not parse as OpenUI Lang
- **WHEN** a completed turn's assistant message contains text that fails to parse cleanly (a null root, any validation error, or an incomplete parse) against the shared component vocabulary
- **THEN** the system does not steer the agent on account of that text

### Requirement: Correction attempts are bounded per turn
The system SHALL cap the number of consecutive corrective steers triggered by this mechanism and SHALL allow the turn to close with its text answer once that cap is reached, rather than steering indefinitely.

#### Scenario: Model repeatedly fails to call the tool after correction
- **WHEN** the system has already steered the agent the maximum configured number of consecutive times for this condition within the same turn's retry sequence
- **THEN** the system does not steer again and allows the next completed turn to close as-is, even if its text still parses as unrouted OpenUI Lang
