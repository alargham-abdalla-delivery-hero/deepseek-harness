## Purpose

Defines the observable lifecycle and capability posture of the Container-backed Durable Object that runs the `dsh` Host per Workspace, so the Workspace owner and operators can reason about availability, tool capability, and data durability of a cloud-hosted Workspace.

## ADDED Requirements

### Requirement: One Workspace maps to exactly one running Host container
The system SHALL run at most one Host container instance per Workspace at a time, and SHALL route every Session within a Workspace to that same instance.

#### Scenario: Multiple Sessions in one Workspace
- **WHEN** a Workspace has more than one active Session
- **THEN** all of those Sessions run against the same Host container instance

#### Scenario: Two different Workspaces
- **WHEN** two distinct Workspaces are both active
- **THEN** their Host containers are separate instances with no shared in-container state

### Requirement: Idle Workspaces stop and resume without losing durable data
The system SHALL stop a Workspace's Host container after a period of inactivity, and SHALL resume it on the next request without loss of any data that the system defines as durable (Workspace registry and session history).

#### Scenario: Resume after idle stop
- **WHEN** a Workspace's container has stopped after being idle, and a new request arrives for that Workspace
- **THEN** the container restarts and the Workspace's registry entry and session history are available exactly as before the stop

### Requirement: Cloud-hosted tool capability is scoped to the container's own disk
The system SHALL execute filesystem, shell, and subprocess tool calls for a cloud-hosted Workspace only against that Workspace's own container disk, never against a path on the end user's local machine.

#### Scenario: Filesystem tool call in a cloud-hosted Workspace
- **WHEN** a Session in a cloud-hosted Workspace issues a filesystem, shell, or subprocess tool call
- **THEN** the call reads and writes only within that Workspace's own container disk

### Requirement: Container disk is not a durability guarantee
The system SHALL NOT represent container disk contents as durable across a stop/restart; only data written to the Workspace-persistence and session-persistence capabilities SHALL be guaranteed to survive a restart.

#### Scenario: Restart drops disk-only state
- **WHEN** a Workspace's container restarts after an idle stop
- **THEN** any state that existed only on the container's disk and was never written through Workspace persistence or session persistence is not guaranteed to survive, while the Workspace registry entry and session history remain available

### Requirement: A container start failure is an observable, distinct state
The system SHALL expose a Workspace's Host container start failure as a distinct, queryable state rather than leaving a request pending indefinitely.

#### Scenario: Host container fails to start
- **WHEN** a Workspace's Host container fails to start
- **THEN** the Workspace's state reflects a distinct failure status that a caller or operator can observe, rather than an indefinitely pending request
