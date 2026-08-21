## ADDED Requirements

### Requirement: Default quick-action row
The system SHALL render a row of quick-action buttons stacked above the composer card for every active session, containing at minimum three buttons labeled "Lead generation", "Income Statements", and "Balance sheet", followed by a "More" button.

#### Scenario: Row renders with an active session
- **WHEN** a session becomes the current session and its composer is visible
- **THEN** the quick-action row renders under the transcript and above the composer card with the three default buttons and the "More" button, in that order

#### Scenario: Row hidden without a current session
- **WHEN** no session is current (the blank/hero state)
- **THEN** the quick-action row does not render

### Requirement: Selecting a quick action fills the composer
Selecting a quick-action button, whether one of the default buttons or an entry from the "More" overflow menu, SHALL write that action's associated text into the current session's composer draft without submitting it.

#### Scenario: Clicking a default button
- **WHEN** the user clicks the "Balance sheet" button
- **THEN** the composer draft is set to that action's associated text and the message is not submitted
- **AND** the user can further edit the draft before sending

#### Scenario: Selecting an overflow entry
- **WHEN** the user opens "More" and selects an entry from the resulting menu
- **THEN** the composer draft is set to that entry's associated text, the menu closes, and the message is not submitted

### Requirement: More button opens a side-anchored overflow menu
Clicking "More" SHALL open a menu anchored to the "More" button, positioned to its side, listing any quick actions not shown as a top-level button.

#### Scenario: Opening the overflow menu
- **WHEN** the user clicks "More" while the overflow menu is closed
- **THEN** a menu opens anchored to the "More" button on its side, listing the overflow quick-action entries

#### Scenario: Dismissing the overflow menu
- **WHEN** the overflow menu is open and the user clicks outside it or presses Escape
- **THEN** the menu closes without changing the composer draft

### Requirement: Quick actions are contributed through an extensible registry
The system SHALL expose a registry other plugins can add quick-action entries to; the row SHALL reflect additions without requiring changes to the plugin that renders the row.

#### Scenario: A separate plugin registers an additional action
- **WHEN** another plugin adds an entry to the quick-action registry during composition
- **THEN** that entry appears in the quick-action row or its "More" overflow menu at the next render, without modifying the rendering plugin's source

### Requirement: Quick actions respect composer availability
Quick-action buttons SHALL be disabled whenever the composer itself refuses input (blocked or disabled), and SHALL NOT write to the draft while disabled.

#### Scenario: Composer is blocked
- **WHEN** the current session's composer is in a blocked state
- **THEN** all quick-action buttons and the "More" button render as disabled
- **AND** clicking a disabled button has no effect on the composer draft
