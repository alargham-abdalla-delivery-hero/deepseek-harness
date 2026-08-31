## Purpose

A D1-backed Service Provider mirroring the existing SQLite session-persistence schema and versioning discipline, so cloud-hosted session event logs durably persist in and reload from Cloudflare D1.

## ADDED Requirements

### Requirement: Session events durably write to D1 as they occur
The system SHALL write each session event for a cloud-hosted Workspace to Cloudflare D1 as it occurs, rather than holding it only in the container's memory or ephemeral disk.

#### Scenario: Event readable immediately after a turn
- **WHEN** an agent turn completes in a cloud-hosted Session
- **THEN** the resulting session events are readable from D1 immediately afterward, even if the container subsequently stops

### Requirement: Session history reloads identically after a container restart
The system SHALL reproduce a Session's complete event history from D1 after its Workspace's container restarts, identical to the history visible before the restart.

#### Scenario: Reopen after idle restart
- **WHEN** a Workspace's container idles out and restarts, and a client reopens one of its Sessions
- **THEN** the displayed history is identical to what the client would have seen without the restart

### Requirement: The D1 schema is explicitly versioned and refuses incompatible data
The system SHALL carry an explicit schema version marker in its D1 session-persistence schema, analogous to `SCHEMA_VERSION`, and SHALL refuse to load session data written by an incompatible schema version rather than misinterpreting it.

#### Scenario: Incompatible schema version encountered
- **WHEN** a running build encounters a D1 database whose session-persistence schema version it does not recognize as compatible
- **THEN** the system refuses to load that data and reports a versioning error rather than producing corrupted or misinterpreted session events

### Requirement: The D1 provider is a drop-in Service Provider
The system SHALL satisfy the existing session-persistence Service Definition contract with the D1 provider such that `packages/session` consumers require no behavioral change to consume it.

#### Scenario: Consumer behavior is unchanged
- **WHEN** a Workspace's session persistence is backed by Cloudflare D1 instead of local SQLite or JSONL
- **THEN** every `packages/session` consumer observes the same behavior it would against the existing local providers, with no caller-visible difference beyond persistence location
