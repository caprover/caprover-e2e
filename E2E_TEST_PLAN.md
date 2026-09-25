# CapRover E2E Test Expansion Plan

This document tracks expansion of the CapRover end-to-end test suite.

The suite covers authentication; application and project lifecycle; deployments; routing and Nginx; storage and ports; themes, backups, system settings, and one-click deployments; plus registry validation, GoAccess, and NetData. Provisioning covers root-domain configuration and password change on every fresh run. Root SSL and global force SSL are covered when HTTPS is enabled.

Future agents should check each implementation item as it lands. A PR is complete when its required checkboxes are checked. Deferred work should link to a follow-up issue.

## Implementation sequence and prerequisites

PR1 through PR6 were merged and validated through [PR #23](https://github.com/caprover/caprover-e2e/pull/23). The CapRover NGINX keep-alive fix landed in [CapRover PR #2491](https://github.com/caprover/caprover/pull/2491), and [PR #24](https://github.com/caprover/caprover-e2e/pull/24) removed the temporary API serialization and spacing mitigation after the full unmitigated suite passed.

Confirmed second batch: PR7 through PR9 are merged as [PR #25](https://github.com/caprover/caprover-e2e/pull/25), [PR #26](https://github.com/caprover/caprover-e2e/pull/26), and [PR #27](https://github.com/caprover/caprover-e2e/pull/27). The delayed NGINX reload and connection-reuse regression was added in [PR #28](https://github.com/caprover/caprover-e2e/pull/28), with backend support in [CapRover PR #2494](https://github.com/caprover/caprover/pull/2494). PR10 through PR18d are implemented, with [PR #36](https://github.com/caprover/caprover-e2e/pull/36) adding one-click deployment and repository coverage, [PR #38](https://github.com/caprover/caprover-e2e/pull/38) adding registry and observability coverage, [PR #39](https://github.com/caprover/caprover-e2e/pull/39) adding Git webhook coverage, [PR #41](https://github.com/caprover/caprover-e2e/pull/41) adding controlled SSL and self-hosted registry coverage, validated by its [specialized run](https://github.com/caprover/caprover-e2e/actions/runs/36072876777), [PR #43](https://github.com/caprover/caprover-e2e/pull/43) adding multi-node coverage, and [PR #46](https://github.com/caprover/caprover-e2e/pull/46) adding Pro and 2FA coverage, validated by its [specialized run](https://github.com/caprover/caprover-e2e/actions/runs/36091515980). [PR #47](https://github.com/caprover/caprover-e2e/pull/47) implements PR18e upgrade coverage; its live run is pending.

- Confirm the existing DigitalOcean, Cloudflare, and SSH provisioning secrets are present and valid in GitHub Actions. Update missing or expired values in GitHub; keep credentials out of this document and PR discussions.
- Keep the backend custom-port fix (PR10) and SDK prerequisites (PR13 and PR17) as separate repository changes. Link their PRs and the consumed package versions or server images before enabling dependent assertions.
- The PR18a dedicated Git test repository and HTTPS/SSH credentials are configured and validated. The additional PR18c worker is opt-in and limited to its manual workflow. The PR18d Pro key is provided as a dedicated Actions secret and its workflow is manual-only. PR18e pins release `1.15.4` and two edge commit SHA tags, and checks their manifests before provisioning.
- Implement PR18 as five independently reviewable follow-up PRs, tracked below as PR18a through PR18e.

## First-batch implementation status

The first six implementation items were merged together through PR #23 after a successful fresh-server run of 16 files and 49 tests.

| Plan item | Pull request                                                                 | Validation status       |
| --------- | ---------------------------------------------------------------------------- | ----------------------- |
| PR1       | [Safety foundations](https://github.com/caprover/caprover-e2e/pull/11)       | Complete through PR #23 |
| PR2       | [Authentication contracts](https://github.com/caprover/caprover-e2e/pull/12) | Complete through PR #23 |
| PR3       | [App configuration](https://github.com/caprover/caprover-e2e/pull/13)        | Complete through PR #23 |
| PR4       | [Project lifecycle](https://github.com/caprover/caprover-e2e/pull/14)        | Complete through PR #23 |
| PR5       | [Deployment recovery](https://github.com/caprover/caprover-e2e/pull/15)      | Complete through PR #23 |
| PR6       | [Source upload and logs](https://github.com/caprover/caprover-e2e/pull/16)   | Complete through PR #23 |

Merged companion SDK changes (included in version `0.0.22`):

- [Authentication retry/error tests](https://github.com/caprover/caprover-api/pull/8): 14 SDK tests passed on that branch.
- [Native FormData transport fix](https://github.com/caprover/caprover-api/pull/9): published `caprover-api@0.0.21` sends Node's native FormData as `[object FormData]` with `text/plain` content type. The fix pairs native FormData with native fetch; a local HTTP-server regression verifies multipart headers and binary file bytes. All 11 SDK tests passed on that branch.

SDK version `0.0.22` contains the merged FormData fix and authentication test changes. The [release workflow](https://github.com/caprover/caprover-api/actions/runs/35488986770) successfully submitted that package to npm. The current E2E suite pins `caprover-api@0.0.25` with a regenerated lockfile; the later SDK prerequisites are tracked in PR13 and PR17 below.

## Implementation rules

- Keep the existing full-update lifecycle using `updateConfigAndSave()`.
- Test PATCH through a separate regression path focused on preserving omitted fields.
- Validate important mutations through CapRover API state.
- Validate relevant mutations through Docker state over SSH.
- Validate routing and application behavior through public HTTP where applicable.
- Run mutating tests serially.
- Generate unique names for apps, projects, themes, domains, images, ports, and volumes.
- For resources with predetermined unique names, register ownership-scoped cleanup before the create request so a lost or timed-out response cannot bypass cleanup. For server-assigned IDs, register cleanup as soon as the ID is known and reconcile ambiguous creation outcomes using the unique run identity.
- Run every cleanup action in LIFO order even if another cleanup fails. Preserve and report the original test failure alongside cleanup errors; fail an otherwise successful test if cleanup fails. Treat an already-absent owned resource as successfully cleaned up.
- Save and restore global settings modified by tests.
- Restrict global or destructive tests to freshly provisioned ephemeral servers.
- Use small images pinned by digest where practical.
- Record the requested CapRover server image and its resolved running digest for each run. Use a known image containing prerequisite backend fixes when validating dependent PRs; retain that image reference with the results.
- Use bounded polling with a concrete terminal condition.
- Keep each PR independently reviewable and green.
- Increase workflow timeouts from measured runtime rather than speculation.
- Keep credentials, backup contents, and decrypted configuration out of test output.

## Execution tiers

The suite should expose these commands:

- `npm test`: run type checking, then the same safe suite selection as `test:all`. The local ephemeral runner must use this entry point or an equivalent path that preserves both checks.
- `npm run test:unit`: local unit tests with no CapRover instance.
- `npm run test:smoke`: the existing application lifecycle.
- `npm run test:core`: deterministic tests safe for a dedicated existing test server.
- `npm run test:destructive`: global configuration and resource-deletion tests.
- `npm run test:all`: unit, smoke, and core; also destructive when `CAPROVER_E2E_ENVIRONMENT=ephemeral`. Exclude destructive files before execution on persistent servers.

Provisioned runs should set `CAPROVER_E2E_ENVIRONMENT=ephemeral` in `provisionEnvironment().testEnvironment`, which the provisioning command exports to `$GITHUB_ENV`. Explicit `test:destructive` invocations and direct execution of destructive files must fail before any mutation unless that exact value is present.

The existing-server workflow should run smoke and core tests. The fresh-server workflow can run smoke, core, and destructive tests.

Assign every test file to exactly one tier using explicit file lists or non-overlapping patterns. The existing lifecycle file belongs to smoke. Helper unit tests belong to unit. Each feature section below names its E2E files and tiers; mixed-tier PRs use separate files. Core assumes a dedicated test server and may create and delete uniquely owned apps and projects. Volume deletion, host-port changes, and global mutations require destructive mode.

PR18a belongs to the ordinary destructive tier and runs in the default fresh-server suite after its Git fixture prerequisites are validated before provisioning. PR18b through PR18e are specialized opt-in suites: exclude them from the default destructive selection and `test:all`, and run each through its dedicated workflow with an ephemeral guard and explicit prerequisites. Missing required configuration must fail clearly before provisioning.

## PR1: Upgrade the API package and add minimal safety foundations

Tier: unit for selection/guard/cleanup tests; smoke for the existing lifecycle.

- [x] Consume a published `caprover-api` version with PATCH support (at least `0.0.21`); preserve any newer version already installed.
- [x] Update `package-lock.json` if the dependency changes.
- [x] Add the execution-tier scripts and explicit file selection described above, including safe selection for `npm test` while retaining type checking.
- [x] Confirm the local ephemeral runner and both workflows use the intended suite selection.
- [x] Record the requested server image and resolved running digest in run diagnostics without exposing credentials.
- [x] Add `CAPROVER_E2E_ENVIRONMENT` to test configuration and provisioning's returned test environment.
- [x] Add a guard used by every destructive or global-state test before mutation.
- [x] Test persistent/ephemeral suite selection through the default entry point, specialized-suite exclusion, and direct destructive invocation rejection.
- [x] Add workflow concurrency for the existing-server workflow.
- [x] Add a lightweight LIFO cleanup registry and test ordering, cleanup after an ambiguous create failure, continuation after a cleanup error, and failure reporting when cleanup is the only failure.
- [x] Keep the existing full-update lifecycle unchanged and confirm it passes.
- [x] Update workflow suite commands and README safety instructions.

Add feature-specific wrappers, HTTP options, naming support, restore logic, assertions, and diagnostics in the consuming PR. Reuse existing helpers where sufficient. Measure runtime before changing workflow timeouts.

## PR2: Add authentication and API contract tests

Create `tests/authentication.test.ts`.

Tier: core.

- [x] Test valid login.
- [x] Verify wrong-password errors expose status `1105`.
- [x] Verify empty-password validation.
- [x] Verify password-length validation.
- [x] Avoid enough repeated failures to trigger the global login backoff.
- [x] Verify one representative SDK error propagates the server's `captainStatus` and `captainMessage`; add a small assertion helper here if reused.
- [x] Verify an unauthenticated user endpoint returns the expected authorization status.
- [x] Document root domain and password change as provisioning coverage, with root SSL and global force SSL covered by HTTPS-enabled runs.

### Companion SDK unit coverage (`caprover-api`)

Tier: unit in the SDK repository; these tests do not require a CapRover server.

- [x] Add or confirm deterministic tests for automatic login without a cached token and one reauthentication after a stale token.
- [x] Verify the retry is bounded and repeated authorization failure is propagated.
- [x] Cover generic error-shape behavior with mocked HTTP responses.
- [x] Link the SDK test PR or existing coverage here.

## PR3: Test full-update and PATCH semantics

Create `tests/app-configuration.test.ts`.

Tier: core.

- [x] Add `CapRoverClient.patchApp()` using `patchAppDefinition()` while keeping `updateApp()` on POST.
- [x] Add unit tests proving the two wrappers use their respective HTTP methods.
- [x] Add minimal raw API request support for the missing-`appName` response assertion.

### Full-update behavior

- [x] Create an app with several non-default metadata fields.
- [x] Update description.
- [x] Update multiple environment variables.
- [x] Update multiple tags.
- [x] Verify every field through the CapRover API.
- [x] Verify environment variables through Docker.
- [x] Verify explicitly supplied empty arrays clear environment variables.
- [x] Verify explicitly supplied empty arrays clear tags.

### PATCH preservation

- [x] Configure several non-default fields through the full update path.
- [x] PATCH only `instanceCount`.
- [x] Verify PATCH preserves environment variables, description, tags, container port, WebSocket support, web exposure, update override, and deploy-token configuration.
- [x] PATCH instance count to zero.
- [x] Verify API desired count is zero.
- [x] Verify Docker desired and running counts converge to zero.
- [x] PATCH back to one and verify recovery.
- [x] PATCH `envVars: []` and verify explicit clearing.
- [x] PATCH multiple fields in one request.
- [x] Verify PATCH for a missing app fails.
- [x] Verify a raw PATCH without `appName` returns status `1110`.

### Representative validation

- [x] Reject a duplicate app name.
- [x] Reject an uppercase app name.
- [x] Reject a reserved `captain-*` name.
- [x] Reject a double-hyphen name.
- [x] Reject rename to an existing app.
- [x] Reject rename of a missing app.
- [x] Reject deletion of a missing app.

## PR4: Add project lifecycle tests

Create `tests/projects.test.ts`.

Tier: core.

- [x] Add project API wrappers to the E2E client.
- [x] Create a root project.
- [x] Create a child project.
- [x] Verify IDs, names, descriptions, and parent relationship.
- [x] Update the child project.
- [x] Create an app assigned to the child.
- [x] Move the app to the root project.
- [x] Remove the app from all projects.
- [x] Reject unknown project IDs during app creation and update.
- [x] Reject deletion of a project containing an app.
- [x] Reject deletion of a parent containing a child.
- [x] Reject self-parenting and an unknown parent UUID.
- [x] Delete the child and root projects.
- [x] Verify cleanup after partial failure.

## PR5: Add deployment-state and failure-recovery tests

Create `tests/deployments.test.ts`.

Tier: core.

- [x] Add a reusable build-completion poller that correlates completion with the requested deployment using the expected version, unique Git hash, or fixture marker alongside app-level build state. An idle state alone is insufficient, and observing an intermediate building state must not be required for fast deployments.
- [x] Correlate failed builds with fresh logs containing the current attempt's unique marker so stale failure state cannot satisfy the poller.
- [x] Add or reuse raw API response-envelope access for detached status assertions.
- [x] Include bounded build-log tails and Docker service/task state in deployment failure diagnostics.
- [x] Deploy a pinned image synchronously.
- [x] Supply a unique Git hash.
- [x] Verify `deployedVersion` increments exactly once.
- [x] Verify the version entry contains the Git hash and deployed image.
- [x] Verify Docker and public HTTP state.
- [x] Start a detached deployment.
- [x] Assert successful envelope status `101`.
- [x] Poll the detached deployment to a terminal state.
- [x] Verify final API, Docker, and HTTP state.
- [x] Trigger a controlled build failure using a tiny captain-definition with a pinned base image and a build step that emits a unique marker and deliberately exits nonzero.
- [x] Separately test missing-image handling with a unique nonexistent tag on a specified reachable registry. Require evidence of the missing image; DNS failures, authentication failures, and timeouts fail the test.
- [x] Verify a failed terminal state and useful build logs.
- [x] Verify the previously working service remains available with its previous image.
- [x] Deploy a valid image afterward.
- [x] Verify full recovery.

Avoid timing-based assertions that merely compare request duration with build duration.

## PR6: Add source-upload and runtime-log tests

Create `tests/source-upload-and-logs.test.ts`.

Tier: core.

- [x] Add source-upload and configurable log-encoding wrappers as needed by this file.

### Deterministic source fixture

- [x] Check in a tiny fixture under `tests/fixtures/source-app`.
- [x] Create its tar archive with the runner's `tar` executable.
- [x] Load the archive into a real Node `File`.
- [x] Generate a unique response and log marker for each run.
- [x] Keep fixture images and dependencies small and pinned.

### Source upload

- [x] Test attached upload.
- [x] Test detached upload.
- [x] Verify the built image executes.
- [x] Verify public response and build logs.
- [x] Test an alternate `captainDefinitionRelativeFilePath`.
- [x] Reject deployment with neither tarball nor captain-definition.
- [x] Reject deployment with both tarball and captain-definition.
- [x] Reject malformed captain-definition content.

### Runtime logs

- [x] Verify ASCII logs contain the unique marker.
- [x] Verify `utf8` logs preserve a Unicode marker.
- [x] Verify hex logs decode to the same content.
- [x] Verify missing-app log retrieval fails.
- [x] Keep raw log output bounded in diagnostics.

## PR7: Add persistent-storage and volume-safety tests

Create `tests/persistent-storage.test.ts`.

Tier: destructive.

- [x] Resolve the physical volume source from Docker service inspection.
- [x] Add Docker helpers for volume existence and marker reads/writes.
- [x] Create a persistent app and attach a named volume.
- [x] Verify API and Docker mount configuration.
- [x] Verify a full POST update with `volumes: []` clears mounts while retaining the named volume, then reattach it before the persistence checks.
- [x] Write a unique marker into the volume.
- [x] Redeploy another image, verify Docker replaced the application task with the new image, and verify the marker remains.
- [x] Delete the app while retaining the volume.
- [x] Attach the retained volume to another app and verify the marker.
- [x] Delete the second app and request volume deletion.
- [x] Verify Docker removes the volume.
- [x] Verify a non-persistent app rejects volume configuration.
- [x] Reject invalid volume definitions.
- [x] Verify an in-use shared volume appears in `volumesFailedToDelete`.
- [x] Verify the shared volume remains.

## PR8: Add routing and HTTP behavior tests

Create `tests/app-routing.test.ts`.

Tier: core.

- [x] Extend the HTTP helper with custom request headers, manual redirects, and response headers as needed here.
- [x] Deploy an image listening on a port other than 80.
- [x] Set `containerHttpPort` and verify the public route.
- [x] Set `notExposeAsWebApp: true`.
- [x] Verify the service stays healthy while public routing disappears.
- [x] Re-enable exposure and verify recovery.
- [x] Configure HTTP authentication.
- [x] Verify anonymous and incorrect credentials are rejected.
- [x] Verify correct credentials succeed.
- [x] Change and clear HTTP authentication.
- [x] Configure `redirectDomain`.
- [x] Verify the status and `Location` header without following redirects.
- [x] Clear the redirect and verify normal proxying.
- [x] Enable `websocketSupport`.
- [x] Verify API persistence.
- [x] Add a tiny WebSocket echo fixture and perform a real upgrade and echo exchange through the public CapRover proxy with bounded timeouts and connection cleanup.

## PR9: Add custom-domain and app-level Nginx tests

Create `tests/app-nginx.test.ts`.

Tier: core.

- [x] Attach a unique hostname under the test server's configured wildcard domain.
- [x] Verify API state and public routing.
- [x] Reject attaching the same domain to another app.
- [x] Remove the custom domain and verify routing disappears.
- [x] Add a harmless app-level response header.
- [x] Verify the header publicly.
- [x] Submit invalid app-level Nginx syntax.
- [x] Verify status `1116`; add or confirm the corresponding SDK status constant in a small companion SDK change if needed.
- [x] Verify the previous working configuration remains active.
- [x] Clear the customization.

Certificate issuance remains in the controlled SSL workflow.

## PR10: Fix backend custom-port persistence

This prerequisite change belongs in `caprover/caprover`.

Tier: unit in the backend repository; PR11 supplies destructive E2E coverage.

- [x] Preserve `protocol` in `AppsDataStore.updateAppDefinitionInDb()`.
- [x] Preserve `publishMode` in `AppsDataStore.updateAppDefinitionInDb()`.
- [x] Propagate `publishMode` into `EndpointSpec.Ports[].PublishMode` during Docker service updates, for explicit protocol and omitted-protocol mappings.
- [x] Keep the existing service-creation handling of both fields and existing update handling of `protocol`.
- [x] Preserve legacy TCP-plus-UDP behavior when protocol is omitted.
- [x] Add backend unit tests for datastore round trips of both fields and Docker create/update requests constructed from persisted mappings.
- [x] Cover explicit TCP/UDP, ingress/host mode, and omitted optional fields.
- [x] Link the merged [CapRover PR #2492](https://github.com/caprover/caprover/pull/2492).
- [x] Merge the backend fix before PR11; it landed in CapRover PR #2492.

## PR11: Add custom-port E2E tests

Create `tests/custom-ports.test.ts` after PR10 lands and the server image used by E2E contains the fix.

Tier: destructive.

- [x] Add deterministic high-port allocation scoped to the run.
- [x] Configure and verify a TCP ingress mapping.
- [x] Configure and verify a UDP ingress mapping using Node's `dgram` client.
- [x] Configure and verify a TCP host-mode mapping.
- [x] Verify API persistence and Docker `EndpointSpec`.
- [x] Verify real TCP and UDP connectivity.
- [x] Replace and remove mappings.
- [x] Verify removed TCP mappings disappear from Docker and new TCP connections fail within a bounded timeout.
- [x] Verify removed UDP mappings disappear from Docker and repeated bounded echo probes stop receiving replies after connectivity was established. Use both checks because lack of a UDP reply alone does not prove port closure.
- [x] Verify a full POST update with `ports: []` clears configured mappings.
- [x] Reject invalid or incomplete port definitions.

## PR12: Add advanced application-setting tests

Create `tests/advanced-app-settings.test.ts`.

Tier: core.

- [x] Pin an app to the current manager `nodeId`.
- [x] Verify the Docker placement constraint.
- [x] Apply a deterministic `serviceUpdateOverride`.
- [x] Verify the resulting Docker `UpdateConfig`.
- [x] Apply a minimal deterministic `preDeployFunction`.
- [x] Verify its actual effect on the Docker update object.
- [x] Enable app deploy-token configuration.
- [x] Use the generated token to deploy.
- [x] Reject an invalid token.
- [x] Disable the token and verify the old token fails.
- [x] Create two apps and delete them through the bulk `appNames` API.
- [x] Verify both API definitions and services disappear.
- [x] Verify sending both `appName` and `appNames` fails.

## PR13: Add theme tests

Create `tests/themes.test.ts`.

Tier: destructive. Implemented and merged in [PR #32](https://github.com/caprover/caprover-e2e/pull/32).

### SDK prerequisite

- [x] Verify `caprover-api.saveTheme()` sends `extra` and `headEmbed` along with `oldName`, `name`, and `content`; fix the payload if still missing.
- [x] Add or confirm SDK unit coverage for supplied and omitted optional fields.
- [x] Link the SDK fix ([caprover-api PR #10](https://github.com/caprover/caprover-api/pull/10)) and consume published `caprover-api@0.0.23` before implementing the field round-trip assertions.

### E2E coverage

- [x] Save the original current theme.
- [x] List built-in themes.
- [x] Create a custom theme with content, extra data, and head embed through the SDK.
- [x] Verify all three fields round-trip through the API.
- [x] Verify it becomes current.
- [x] Retrieve it through the public unauthenticated endpoint.
- [x] Rename or update it.
- [x] Select another theme.
- [x] Verify deleting the active custom theme clears the current theme.
- [x] Reject editing or deleting a built-in theme.
- [x] Reject selecting a missing theme.
- [x] Restore the original theme, including an originally empty selection.

## PR14: Add backup and system-read tests

Create `tests/backup.test.ts` (Tier: destructive), `tests/system-info.test.ts` (Tier: core), and `tests/system-defaults.test.ts` (Tier: destructive, ephemeral-only).

Backup creation/download touches server-wide backup state; keep it ephemeral. Implemented and merged in [PR #33](https://github.com/caprover/caprover-e2e/pull/33).

### Backup

- [x] Add binary HTTP response support for archive downloads.
- [x] Create identifiable test configuration.
- [x] Request a backup.
- [x] Download it as binary through the one-time endpoint.
- [x] Validate the tar archive and expected file structure.
- [x] Inspect selected fields without logging the archive or secrets.
- [x] Verify an invalid token fails.
- [x] Verify a second download with the same token fails after the backup file is removed.

### System reads (core)

- [x] Test captain info, version info, load-balancer info, and node listing.
- [x] Verify root-domain and SSL fields are internally consistent with the server under test; existing servers may have different valid settings.
- [x] Verify version fields and non-negative load-balancer counters.
- [x] Generate traffic and verify cumulative request counters increase.
- [x] Verify API node identity and manager/leader information against Docker over SSH without assuming a single-node cluster.
- [x] Verify the current Pro feature state and configuration can be read without changing them or assuming a free installation.

### Fresh-install defaults (ephemeral-only)

- [x] Require the ephemeral guard and run before any global-setting tests that could change the expected defaults.
- [x] Verify root-domain and SSL state matches the provisioning result.
- [x] Verify the freshly provisioned single-node environment contains one leader manager.
- [x] Verify the default free Pro feature state and default Pro configuration.

## PR15: Add destructive disk-cleanup and global Nginx tests

Create `tests/disk-cleanup.test.ts` and `tests/system-nginx.test.ts`.

Tier: destructive for both files. Require ephemeral mode. Implemented and merged in [PR #35](https://github.com/caprover/caprover-e2e/pull/35).

### Disk cleanup

- [x] Preserve the original cleanup settings.
- [x] Test valid settings, normalization, invalid cron, and negative limits.
- [x] Build a uniquely tagged test image over SSH.
- [x] Verify no service references its image ID.
- [x] Verify `getUnusedImages()` returns it.
- [x] Verify deployed images are excluded.
- [x] Delete only the uniquely owned image ID.
- [x] Verify only that image disappears.
- [x] Restore the original settings.

### Global Nginx

- [x] Preserve base and captain overrides.
- [x] Apply a reviewed harmless customization.
- [x] Verify API and observable behavior.
- [x] Submit invalid syntax.
- [x] Verify the last valid configuration remains active.
- [x] Restore original values in guaranteed cleanup.

## PR16: Add one-click deployment and repository tests

Create `tests/one-click.test.ts` (Tier: core) and `tests/one-click-repositories.test.ts` (Tier: destructive).

Keep inline deployments in the core file and global repository mutations in the destructive file.

### Inline deployment

- [x] Always supply a values array, including `[]` when empty.
- [x] Start a self-contained deployment and obtain a job ID.
- [x] Poll progress to success or error.
- [x] Verify observed progress is monotonic.
- [x] Verify app configuration, Docker state, and public HTTP behavior.
- [x] Exercise variables, environment values, and a two-service dependency.
- [x] Reject missing templates and missing or unknown job IDs.
- [x] Delete every generated app.
- [x] Delete the project generated by multi-service deployment.

### Custom repository

- [x] Serve a test-owned `/v4/list` and template endpoint using the source fixture.
- [x] Add and list the repository.
- [x] List and fetch its template.
- [x] Deploy the returned template.
- [x] Reject duplicate insertion.
- [x] Delete the repository and reject a second deletion.
- [x] Clean up the repository-serving app.

- [x] File a backend or SDK issue for optional `values` if `undefined` still causes `valuesArray.forEach()` to throw ([caprover/caprover#2498](https://github.com/caprover/caprover/issues/2498)).

## PR17: Add registry and observability workflows

Create `tests/registries.test.ts`, `tests/goaccess.test.ts`, and `tests/netdata.test.ts`.

Tier: destructive for all three files. Require ephemeral mode. Implemented and merged in [PR #38](https://github.com/caprover/caprover-e2e/pull/38) after a [fresh-server run](https://github.com/caprover/caprover-e2e/actions/runs/35820353928) passed 36 files and 104 tests.

### SDK prerequisite

- [x] Correct `defaultRegistryId` versus backend `defaultPushRegistryId` in [`caprover-api` PR #17](https://github.com/caprover/caprover-api/pull/17).
- [x] Publish and consume `caprover-api@0.0.25` through the [release PR #19](https://github.com/caprover/caprover-api/pull/19).

### Lightweight registry contracts

- [x] Read the initial registry list.
- [x] Reject an unknown default registry ID.
- [x] Specify a reachable registry endpoint and deliberately invalid credentials; verify the expected authentication rejection and registry error status.
- [x] Treat DNS failures, connection failures, and timeouts as test failures. They must not satisfy the invalid-credentials assertion.

### GoAccess

- [x] Preserve settings.
- [x] Enable GoAccess and generate traffic.
- [x] Retrieve report listings and a live report.
- [x] Verify missing-app and missing-report behavior.
- [x] Restore settings.

### NetData

- [x] Preserve settings.
- [x] Enable NetData with notifications disabled.
- [x] Verify the standalone container and proxied endpoint.
- [x] Disable NetData and verify removal.
- [x] Restore settings.

Full self-hosted registry build-and-push coverage belongs in the controlled SSL workflow because enabling it requests a real certificate.

## PR18: Add external-integration coverage

Implement the following five areas in separate follow-up PRs (PR18a through PR18e). Each has its own prerequisites and completion entry.

Tier: destructive. PR18a joins the default fresh-server suite. PR18b through PR18e remain specialized opt-in workflows that provision their own ephemeral environments and run only their assigned files under `tests/specialized/`.

### PR18a: Git webhook workflow

File: `tests/git-webhooks.test.ts`. Tier: destructive. Validate the private Git fixture and both authentication methods before provisioning, then run this file as part of the standard fresh-server suite.

- [x] Configure a dedicated repository and credentials.
- [x] Test HTTPS and SSH repository authentication.
- [x] Verify the intended sensitive-field response contract.
- [x] Trigger a matching-branch build.
- [x] Verify a nonmatching branch causes no deployment.
- [x] Verify invalid token behavior.
- [x] Verify rename rotates the webhook token.
- [x] Verify clearing repository settings disables the webhook.

### PR18b: Controlled SSL and self-hosted registry workflow

File: `tests/specialized/ssl-and-registry.test.ts`. Tier: destructive (specialized).

Fresh-server provisioning defaults to HTTP. This controlled SSL workflow must enable `E2E_ENABLE_HTTPS=true` to request a real dashboard certificate for `captain.<rootDomain>` through `enableRootSsl()`. Certificate-rate management must account for its dashboard, app, custom-domain, and registry certificates.

- [x] Document issuance volume and configure workflow cadence/concurrency with provisioning included in the budget.
- [x] Call `enableSslForBaseDomain(appName)` and verify a trusted certificate and HTTPS response for `<app>.<rootDomain>`. Dashboard/root SSL remains provisioning coverage.
- [x] Enable app-level force SSL and verify redirect behavior.
- [x] Enable custom-domain SSL and verify the certificate.
- [x] Enable the self-hosted registry.
- [x] Verify its service, TLS endpoint, and API entry.
- [x] Set it as default, build an app, and verify the image is pushed.
- [x] Verify local-registry deletion protections.
- [x] Disable the registry and verify cleanup.
- [x] Remove the custom domain and verify cleanup behavior.

### PR18c: Multi-node workflow

File: `tests/specialized/multi-node.test.ts`. Tier: destructive (specialized).

- [x] Provision a second droplet.
- [x] Ensure a usable default registry exists.
- [x] Add the node as a worker.
- [x] Verify node listing and task placement.
- [x] Verify stateless and persistent app pinning.
- [x] Clean up the node and infrastructure.

### PR18d: Pro and 2FA workflow

File: `tests/specialized/pro-and-2fa.test.ts`. Tier: destructive (specialized).

- [x] Use a dedicated Pro key.
- [x] Verify Pro state and configuration.
- [x] Enable 2FA.
- [x] Verify login without OTP returns `1114`.
- [x] Verify login with generated TOTP succeeds.
- [x] Disable 2FA in guaranteed cleanup.

### PR18e: Upgrade workflow

File: `tests/specialized/upgrade.test.ts`. Tier: destructive (specialized).

- [x] Provision a pinned older CapRover version.
- [x] Create applications, projects, and persistent data.
- [x] Upgrade to a pinned newer version, then upgrade edge commit A to B through the edge API.
- [x] Wait for captain recovery and verify the running image digest and image ID.
- [x] Verify authentication, configuration, routing, and persistent data.

The release-to-edge transition uses Docker because the released server's update
API selects the `caprover/caprover` repository. The edge-to-edge transition
uses `performUpdate` and the SHA tag for the target edge commit. The latest
edge image's own forward-upgrade path can be verified after its next build
publishes; refresh the SHA pair to test that transition.

## API coverage map

This table should be updated whenever `caprover-api` adds or removes a public method.

| API area           | Methods                                                                          | Coverage                                                                                           |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Authentication     | `login`, automatic retry, `changePass`                                           | PR2 server contracts; SDK unit tests for automatic retry; password change during provisioning      |
| Themes             | `getAllThemes`, `getCurrentTheme`, `setCurrentTheme`, `saveTheme`, `deleteTheme` | PR13                                                                                               |
| Pro                | state/configuration/OTP methods                                                  | PR14 and PR18d                                                                                     |
| System setup       | captain info, root domain, root SSL, force SSL                                   | Provisioning and PR14                                                                              |
| Applications       | list, register, full update, PATCH, rename, delete, bulk delete                  | Existing suite, PR3, PR12                                                                          |
| Deployments        | captain-definition, source upload, build status, runtime logs, deploy token      | PR5, PR6, PR12                                                                                     |
| Projects           | list, register, update, delete                                                   | PR4                                                                                                |
| Domains and Nginx  | base/custom domains, app/global Nginx, redirects, HTTP auth                      | PR8, PR9, PR15, PR18                                                                               |
| Images and cleanup | unused images, image deletion, cleanup configuration                             | PR15                                                                                               |
| Registries         | list, local/remote registry operations, default push registry                    | PR17 and PR18                                                                                      |
| One-click          | lists, repositories, template fetch, deployment, progress                        | PR16                                                                                               |
| Nodes              | list and add node                                                                | PR14 and PR18                                                                                      |
| Observability      | load balancer, NetData, GoAccess and reports                                     | PR14 and PR17                                                                                      |
| Backup and upgrade | backup creation/download, captain update                                         | PR14 and PR18                                                                                      |
| Git webhooks       | repository configuration and force build                                         | PR18                                                                                               |
| Generic API        | GET, POST, and PATCH generic commands                                            | SDK unit tests; representative E2E error propagation in PR2 and raw contract assertions in PR3/PR5 |

## Completion tracking

- [x] PR1 merged ([caprover-e2e PR #23](https://github.com/caprover/caprover-e2e/pull/23))
- [x] PR2 merged ([caprover-e2e PR #23](https://github.com/caprover/caprover-e2e/pull/23))
- [x] PR3 merged ([caprover-e2e PR #23](https://github.com/caprover/caprover-e2e/pull/23))
- [x] PR4 merged ([caprover-e2e PR #23](https://github.com/caprover/caprover-e2e/pull/23))
- [x] PR5 merged ([caprover-e2e PR #23](https://github.com/caprover/caprover-e2e/pull/23))
- [x] PR6 merged ([caprover-e2e PR #23](https://github.com/caprover/caprover-e2e/pull/23))
- [x] PR7 merged ([caprover-e2e PR #25](https://github.com/caprover/caprover-e2e/pull/25))
- [x] PR8 merged ([caprover-e2e PR #26](https://github.com/caprover/caprover-e2e/pull/26))
- [x] PR9 merged ([caprover-e2e PR #27](https://github.com/caprover/caprover-e2e/pull/27))
- [x] PR10 merged in `caprover/caprover` ([PR #2492](https://github.com/caprover/caprover/pull/2492))
- [x] PR11 merged ([caprover-e2e PR #30](https://github.com/caprover/caprover-e2e/pull/30))
- [x] PR12 merged ([caprover-e2e PR #31](https://github.com/caprover/caprover-e2e/pull/31))
- [x] PR13 merged ([caprover-e2e PR #32](https://github.com/caprover/caprover-e2e/pull/32))
- [x] PR14 merged ([caprover-e2e PR #33](https://github.com/caprover/caprover-e2e/pull/33))
- [x] PR15 merged ([caprover-e2e PR #35](https://github.com/caprover/caprover-e2e/pull/35))
- [x] PR16 merged ([caprover-e2e PR #36](https://github.com/caprover/caprover-e2e/pull/36))
- [x] PR17 merged ([caprover-e2e PR #38](https://github.com/caprover/caprover-e2e/pull/38); [fresh-server run](https://github.com/caprover/caprover-e2e/actions/runs/35820353928): 36 files, 104 tests)
- [x] PR18a implemented ([caprover-e2e PR #39](https://github.com/caprover/caprover-e2e/pull/39); [fresh-server run](https://github.com/caprover/caprover-e2e/actions/runs/35954049277): 37 files, 106 tests)
- [x] PR18b SSL and self-hosted registry workflow implemented ([caprover-e2e PR #41](https://github.com/caprover/caprover-e2e/pull/41); [specialized run](https://github.com/caprover/caprover-e2e/actions/runs/36072876777): 1 file, 1 test)
- [x] PR18c multi-node workflow implemented ([caprover-e2e PR #43](https://github.com/caprover/caprover-e2e/pull/43))
- [x] PR18d Pro and 2FA workflow implemented ([caprover-e2e PR #46](https://github.com/caprover/caprover-e2e/pull/46); [specialized run](https://github.com/caprover/caprover-e2e/actions/runs/36091515980))
- [x] PR18e upgrade workflow implemented ([caprover-e2e PR #47](https://github.com/caprover/caprover-e2e/pull/47); specialized live run pending)
