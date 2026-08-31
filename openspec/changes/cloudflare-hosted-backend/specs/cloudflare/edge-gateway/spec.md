## Purpose

The Worker entrypoint that authenticates callers and routes Client Connection traffic to the Durable Object owning the requested Workspace, so a browser client can reach a cloud-hosted Workspace without a local Host process.

## ADDED Requirements

### Requirement: Unauthenticated requests are rejected
The system SHALL reject any Client Connection request that does not carry valid credentials for a Cloudflare-hosted Workspace, before routing it to any Durable Object.

#### Scenario: Request without credentials
- **WHEN** a request arrives with no credentials or expired/invalid credentials
- **THEN** the Worker rejects the request without contacting any Workspace's Durable Object

#### Scenario: Request with valid credentials
- **WHEN** a request arrives with credentials valid for the caller
- **THEN** the Worker proceeds to route the request toward the named Workspace

### Requirement: A caller naming an explicit Workspace is routed only to Workspaces that exist
This deployment targets a single owner (Cloudflare Access already restricts the whole Worker to one authorized principal or allowlist, per design.md's Non-Goals — there is no per-Workspace owner field in `dsh-workspace`'s data model). Given that, the Worker SHALL verify an explicitly-named Workspace (a request carrying an explicit `/w/<id>/` path) exists in the D1-backed registry before routing to its Durable Object, and SHALL NOT create or wake a container for an explicitly-named Workspace id that does not resolve to a registry record. **Revised during implementation:** this check does not apply to the deployment's `DEFAULT_WORKSPACE_ID` fallback (used when a request names no Workspace explicitly) — `@deepseek-ai/dsh-workspace` assigns every real Workspace a random id, so a literal configured default value never equals one, and existence-checking it would permanently reject a fresh single-Workspace deployment before its first Workspace is ever created. The fallback names this deployment's one Container routing slot, not a specific Workspace record to verify — there is no "wrong Workspace" it could route to.

#### Scenario: Caller explicitly requests a Workspace id that does not exist
- **WHEN** an authenticated caller requests an explicit `/w/<id>/` Workspace id with no matching record in the D1-backed registry
- **THEN** the Worker rejects the request and does not route it to, start, or wake any Durable Object or container

#### Scenario: Caller explicitly requests a Workspace that exists
- **WHEN** an authenticated caller requests an explicit `/w/<id>/` Workspace id with a matching record in the D1-backed registry
- **THEN** the Worker routes the request to that Workspace's Durable Object

#### Scenario: Caller relies on the deployment's default Workspace slot
- **WHEN** an authenticated caller's request names no Workspace explicitly, and the deployment has `DEFAULT_WORKSPACE_ID` configured
- **THEN** the Worker routes the request to that Container slot's Durable Object without checking the D1-backed registry, whether or not it has ever held a Workspace record

### Requirement: Requests for the same Workspace consistently reach the same session state
The system SHALL route every request naming a given Workspace id to the single Durable Object instance that owns that Workspace's live state, regardless of which Worker instance or Cloudflare location handled the request.

#### Scenario: Consecutive calls for the same Workspace
- **WHEN** two consecutive requests name the same Workspace id, from the same or different Worker instances
- **THEN** both requests reach the same Workspace state, including any in-progress session or `follow()` projection

### Requirement: Container unavailability is a distinct, surfaced outcome
The system SHALL surface a distinct status to the caller when a Workspace's Host container is starting, restarting, or has failed to start, rather than silently dropping the request or conflating it with an authentication or authorization failure.

#### Scenario: Cold start in progress
- **WHEN** a request reaches a Workspace whose container is still starting
- **THEN** the caller receives an explicit "starting" status distinguishable from a completed response or a timeout

#### Scenario: Container fails to start
- **WHEN** a Workspace's container fails to start
- **THEN** the caller receives a distinct failure status naming the cause category, not an authentication or authorization error
