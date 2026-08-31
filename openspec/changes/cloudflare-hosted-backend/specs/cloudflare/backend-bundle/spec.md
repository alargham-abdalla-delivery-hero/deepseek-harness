## Purpose

The opt-in profile bundle that installs the entire Cloudflare-hosted backend as a single plugin, so enabling or removing cloud-hosted Workspaces is one deliberate choice that leaves every other profile untouched.

## ADDED Requirements

### Requirement: The Cloudflare backend is available only through a dedicated profile bundle
The system SHALL expose the edge-gateway, host-container, workspace-persistence, and session-persistence capabilities only when the `dsh-cloudflare-app` profile bundle is selected or explicitly added to a profile, and SHALL NOT mount any of them as part of the default `web`, `headless`, `acp`, or `sdk` profiles.

#### Scenario: Default profile without the bundle
- **WHEN** a user starts `dsh` with any default profile (`web`, `headless`, `acp`, `sdk`) without adding the Cloudflare bundle
- **THEN** none of the edge-gateway, host-container, D1 storage, or D1 session-persistence plugins are mounted, and the session behaves exactly as it does today

#### Scenario: Cloudflare profile selected
- **WHEN** a user starts `dsh --profile cloudflare` (or adds `@deepseek-ai/dsh-cloudflare-app` to another profile)
- **THEN** all four capabilities are mounted together as one unit

### Requirement: The bundle is fully removable
The system SHALL register every plugin the Cloudflare bundle mounts through `ctx.effect()`/`ctx.on()`, so removing the bundle from a profile leaves no residual registration, service, or listener behind.

#### Scenario: Bundle removed
- **WHEN** the `dsh-cloudflare-app` bundle is removed from a profile that previously included it
- **THEN** none of its services, routes, or event listeners remain registered

### Requirement: Enabling the bundle does not alter existing profile bundles
The system SHALL NOT require any edit to `dsh-base` or any existing profile bundle package (`dsh-web-app`, `dsh-headless`, `dsh-acp-app`, `dsh-sdk-app`, `dsh-sdk-minimal`) to add the Cloudflare capability to a profile.

#### Scenario: Existing bundle packages are unmodified
- **WHEN** the Cloudflare bundle is introduced
- **THEN** no existing profile bundle package's patch document changes to reference it
