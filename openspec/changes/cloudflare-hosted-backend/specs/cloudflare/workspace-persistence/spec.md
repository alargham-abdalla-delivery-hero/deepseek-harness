## Purpose

A D1-backed Service Provider for the existing storage-domain seam so a Workspace registry (create/rename/reorder/archive) durably persists in Cloudflare D1 and reloads from there, with no change to the storage-domain Service Definition or the Workspace Remote surface.

## ADDED Requirements

### Requirement: Workspace mutations commit to D1 before success is reported
The system SHALL persist a Workspace create, rename, reorder, or archive mutation to Cloudflare D1 before returning a success outcome to the caller, and SHALL return a `WorkspaceError` rather than a silent success when the D1 write fails.

#### Scenario: Successful create
- **WHEN** a caller creates a Workspace against the Cloudflare backend
- **THEN** the success response is returned only after the new Workspace record has committed to D1

#### Scenario: D1 write failure
- **WHEN** a Workspace mutation's D1 write fails
- **THEN** the caller receives a `WorkspaceError` and no partial or inconsistent record is left visible to later reads

### Requirement: Workspace state reloads from D1 across restarts
The system SHALL make every previously committed Workspace mutation visible to a subsequent read of the Workspace registry, including after the Worker or the owning container restarts.

#### Scenario: Read after restart
- **WHEN** a Workspace was created, renamed, or reordered, and the Worker or its container subsequently restarts
- **THEN** listing Workspaces afterward returns the same state as before the restart, sourced from D1

### Requirement: The D1 provider is a drop-in Service Provider
The system SHALL satisfy the existing storage-domain Service Definition contract with the D1 provider such that `@deepseek-ai/dsh-workspace` and `packages/api/workspace-controller` require no behavioral change to consume it.

#### Scenario: Workspace-controller behavior is unchanged
- **WHEN** the storage-domain provider backing a Workspace is Cloudflare D1 instead of local JSON or SQLite
- **THEN** `workspace-controller`'s create, rename, remove, reorder, archive, and `follow()` methods behave per their existing contract with no caller-visible difference beyond persistence location

### Requirement: Concurrent Workspace mutations resolve deterministically
The system SHALL resolve concurrent mutations against the same Workspace registry without losing an update or producing a duplicate or corrupted record.

#### Scenario: Concurrent creates
- **WHEN** two Workspaces are created concurrently with distinct names
- **THEN** both succeed and each appears exactly once in the registry

#### Scenario: Concurrent renames of the same Workspace
- **WHEN** two rename requests for the same Workspace are issued concurrently
- **THEN** the Workspace ends in one consistent, fully-formed name reflecting one of the two requests, never a corrupted or partial record
