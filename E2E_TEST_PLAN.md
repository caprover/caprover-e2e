# CapRover E2E Test Expansion Plan

This document tracks expansion of the CapRover end-to-end test suite.

The existing suite covers login, application creation, rename, one environment update, image deployment, scaling, redeployment, and deletion. Provisioning also covers root-domain configuration, root SSL, global force SSL, and password change.

Future agents should check each implementation item as it lands. A PR is complete when its required checkboxes are checked. Deferred work should link to a follow-up issue.

## Implementation rules

- Keep the existing full-update lifecycle using `updateConfigAndSave()`.
- Test PATCH through a separate regression path focused on preserving omitted fields.
- Validate important mutations through CapRover API state.
- Validate relevant mutations through Docker state over SSH.
- Validate routing and application behavior through public HTTP where applicable.
- Run mutating tests serially.
- Generate unique names for apps, projects, themes, domains, images, ports, and volumes.
- Register cleanup immediately after creating each resource.
- Run cleanup in LIFO order and preserve the original test failure.
- Save and restore global settings modified by tests.
- Restrict global or destructive tests to freshly provisioned ephemeral servers.
- Use small images pinned by digest where practical.
- Use bounded polling with a concrete terminal condition.
- Keep each PR independently reviewable and green.
- Increase workflow timeouts from measured runtime rather than speculation.
- Keep credentials, backup contents, and decrypted configuration out of test output.

## Execution tiers

The suite should expose these commands:

- `npm run test:unit`: local unit tests with no CapRover instance.
- `npm run test:smoke`: the existing application lifecycle.
- `npm run test:core`: deterministic tests safe for a dedicated existing test server.
- `npm run test:destructive`: global configuration and resource-deletion tests.
- `npm run test:all`: unit, smoke, and core; also destructive when `CAPROVER_E2E_ENVIRONMENT=ephemeral`. Exclude destructive files before execution on persistent servers.

Provisioned runs should set `CAPROVER_E2E_ENVIRONMENT=ephemeral` in `provisionEnvironment().testEnvironment`, which the provisioning command exports to `$GITHUB_ENV`. Explicit `test:destructive` invocations and direct execution of destructive files must fail before any mutation unless that exact value is present.

The existing-server workflow should run smoke and core tests. The fresh-server workflow can run smoke, core, and destructive tests.

Assign every test file to exactly one tier using explicit file lists or non-overlapping patterns. The existing lifecycle file belongs to smoke. Helper unit tests belong to unit. Each feature section below names its E2E files and tiers; mixed-tier PRs use separate files. Core assumes a dedicated test server and may create and delete uniquely owned apps and projects. Volume deletion, host-port changes, and global mutations require destructive mode.

PR18 files belong to destructive and are specialized opt-in suites. Exclude them from the default destructive selection and `test:all`; run each through its dedicated workflow with an ephemeral guard and explicit prerequisites. Missing required configuration in an explicitly selected workflow must fail clearly.

## PR1: Upgrade the API package and add minimal safety foundations

Tier: unit for selection/guard/cleanup tests; smoke for the existing lifecycle.

- [ ] Consume a published `caprover-api` version with PATCH support (at least `0.0.21`); preserve any newer version already installed.
- [ ] Update `package-lock.json` if the dependency changes.
- [ ] Add the execution-tier scripts and explicit file selection described above.
- [ ] Add `CAPROVER_E2E_ENVIRONMENT` to test configuration and provisioning's returned test environment.
- [ ] Add a guard used by every destructive or global-state test before mutation.
- [ ] Test persistent/ephemeral suite selection, specialized-suite exclusion, and direct destructive invocation rejection.
- [ ] Add workflow concurrency for the existing-server workflow.
- [ ] Add a lightweight LIFO cleanup registry and test ordering and cleanup after failure.
- [ ] Keep the existing full-update lifecycle unchanged and confirm it passes.
- [ ] Update workflow suite commands and README safety instructions.

Add feature-specific wrappers, HTTP options, naming support, restore logic, assertions, and diagnostics in the consuming PR. Reuse existing helpers where sufficient. Measure runtime before changing workflow timeouts.

## PR2: Add authentication and API contract tests

Create `tests/authentication.test.ts`.

Tier: core.

- [ ] Test valid login.
- [ ] Verify wrong-password errors expose status `1105`.
- [ ] Verify empty-password validation.
- [ ] Verify password-length validation.
- [ ] Avoid enough repeated failures to trigger the global login backoff.
- [ ] Verify one representative SDK error propagates the server's `captainStatus` and `captainMessage`; add a small assertion helper here if reused.
- [ ] Verify an unauthenticated user endpoint returns the expected authorization status.
- [ ] Document root domain, root SSL, global force SSL, and password change as provisioning coverage.

### Companion SDK unit coverage (`caprover-api`)

Tier: unit in the SDK repository; these tests do not require a CapRover server.

- [ ] Add or confirm deterministic tests for automatic login without a cached token and one reauthentication after a stale token.
- [ ] Verify the retry is bounded and repeated authorization failure is propagated.
- [ ] Cover generic error-shape behavior with mocked HTTP responses.
- [ ] Link the SDK test PR or existing coverage here.

## PR3: Test full-update and PATCH semantics

Create `tests/app-configuration.test.ts`.

Tier: core.

- [ ] Add `CapRoverClient.patchApp()` using `patchAppDefinition()` while keeping `updateApp()` on POST.
- [ ] Add unit tests proving the two wrappers use their respective HTTP methods.
- [ ] Add minimal raw API request support for the missing-`appName` response assertion.

### Full-update behavior

- [ ] Create an app with several non-default metadata fields.
- [ ] Update description.
- [ ] Update multiple environment variables.
- [ ] Update multiple tags.
- [ ] Verify every field through the CapRover API.
- [ ] Verify environment variables through Docker.
- [ ] Verify explicitly supplied empty arrays clear environment variables.
- [ ] Verify explicitly supplied empty arrays clear tags.

### PATCH preservation

- [ ] Configure several non-default fields through the full update path.
- [ ] PATCH only `instanceCount`.
- [ ] Verify PATCH preserves environment variables, description, tags, container port, WebSocket support, web exposure, update override, and deploy-token configuration.
- [ ] PATCH instance count to zero.
- [ ] Verify API desired count is zero.
- [ ] Verify Docker desired and running counts converge to zero.
- [ ] PATCH back to one and verify recovery.
- [ ] PATCH `envVars: []` and verify explicit clearing.
- [ ] PATCH multiple fields in one request.
- [ ] Verify PATCH for a missing app fails.
- [ ] Verify a raw PATCH without `appName` returns status `1110`.

### Representative validation

- [ ] Reject a duplicate app name.
- [ ] Reject an uppercase app name.
- [ ] Reject a reserved `captain-*` name.
- [ ] Reject a double-hyphen name.
- [ ] Reject rename to an existing app.
- [ ] Reject rename of a missing app.
- [ ] Reject deletion of a missing app.

## PR4: Add project lifecycle tests

Create `tests/projects.test.ts`.

Tier: core.

- [ ] Add project API wrappers to the E2E client.
- [ ] Create a root project.
- [ ] Create a child project.
- [ ] Verify IDs, names, descriptions, and parent relationship.
- [ ] Update the child project.
- [ ] Create an app assigned to the child.
- [ ] Move the app to the root project.
- [ ] Remove the app from all projects.
- [ ] Reject unknown project IDs during app creation and update.
- [ ] Reject deletion of a project containing an app.
- [ ] Reject deletion of a parent containing a child.
- [ ] Reject self-parenting and an unknown parent UUID.
- [ ] Delete the child and root projects.
- [ ] Verify cleanup after partial failure.

## PR5: Add deployment-state and failure-recovery tests

Create `tests/deployments.test.ts`.

Tier: core.

- [ ] Add a reusable build-completion poller.
- [ ] Add or reuse raw API response-envelope access for detached status assertions.
- [ ] Include bounded build-log tails and Docker service/task state in deployment failure diagnostics.
- [ ] Deploy a pinned image synchronously.
- [ ] Supply a unique Git hash.
- [ ] Verify `deployedVersion` increments exactly once.
- [ ] Verify the version entry contains the Git hash and deployed image.
- [ ] Verify Docker and public HTTP state.
- [ ] Start a detached deployment.
- [ ] Assert successful envelope status `101`.
- [ ] Poll the detached deployment to a terminal state.
- [ ] Verify final API, Docker, and HTTP state.
- [ ] Trigger a failed deployment using a deterministic missing tag.
- [ ] Verify a failed terminal state and useful build logs.
- [ ] Verify the previously working service remains available with its previous image.
- [ ] Deploy a valid image afterward.
- [ ] Verify full recovery.

Avoid timing-based assertions that merely compare request duration with build duration.

## PR6: Add source-upload and runtime-log tests

Create `tests/source-upload-and-logs.test.ts`.

Tier: core.

- [ ] Add source-upload and configurable log-encoding wrappers as needed by this file.

### Deterministic source fixture

- [ ] Check in a tiny fixture under `tests/fixtures/source-app`.
- [ ] Create its tar archive with the runner's `tar` executable.
- [ ] Load the archive into a real Node `File`.
- [ ] Generate a unique response and log marker for each run.
- [ ] Keep fixture images and dependencies small and pinned.

### Source upload

- [ ] Test attached upload.
- [ ] Test detached upload.
- [ ] Verify the built image executes.
- [ ] Verify public response and build logs.
- [ ] Test an alternate `captainDefinitionRelativeFilePath`.
- [ ] Reject deployment with neither tarball nor captain-definition.
- [ ] Reject deployment with both tarball and captain-definition.
- [ ] Reject malformed captain-definition content.

### Runtime logs

- [ ] Verify ASCII logs contain the unique marker.
- [ ] Verify `utf8` logs preserve a Unicode marker.
- [ ] Verify hex logs decode to the same content.
- [ ] Verify missing-app log retrieval fails.
- [ ] Keep raw log output bounded in diagnostics.

## PR7: Add persistent-storage and volume-safety tests

Create `tests/persistent-storage.test.ts`.

Tier: destructive.

- [ ] Resolve the physical volume source from Docker service inspection.
- [ ] Add Docker helpers for volume existence and marker reads/writes.
- [ ] Create a persistent app and attach a named volume.
- [ ] Verify API and Docker mount configuration.
- [ ] Verify a full POST update with `volumes: []` clears mounts while retaining the named volume, then reattach it before the persistence checks.
- [ ] Write a unique marker into the volume.
- [ ] Redeploy another image, verify Docker replaced the application task with the new image, and verify the marker remains.
- [ ] Delete the app while retaining the volume.
- [ ] Attach the retained volume to another app and verify the marker.
- [ ] Delete the second app and request volume deletion.
- [ ] Verify Docker removes the volume.
- [ ] Verify a non-persistent app rejects volume configuration.
- [ ] Reject invalid volume definitions.
- [ ] Verify an in-use shared volume appears in `volumesFailedToDelete`.
- [ ] Verify the shared volume remains.

## PR8: Add routing and HTTP behavior tests

Create `tests/app-routing.test.ts`.

Tier: core.

- [ ] Extend the HTTP helper with custom request headers, manual redirects, and response headers as needed here.
- [ ] Deploy an image listening on a port other than 80.
- [ ] Set `containerHttpPort` and verify the public route.
- [ ] Set `notExposeAsWebApp: true`.
- [ ] Verify the service stays healthy while public routing disappears.
- [ ] Re-enable exposure and verify recovery.
- [ ] Configure HTTP authentication.
- [ ] Verify anonymous and incorrect credentials are rejected.
- [ ] Verify correct credentials succeed.
- [ ] Change and clear HTTP authentication.
- [ ] Configure `redirectDomain`.
- [ ] Verify the status and `Location` header without following redirects.
- [ ] Clear the redirect and verify normal proxying.
- [ ] Enable `websocketSupport`.
- [ ] Verify API persistence.
- [ ] Add a tiny WebSocket echo fixture and perform a real upgrade and echo exchange through the public CapRover proxy with bounded timeouts and connection cleanup.

## PR9: Add custom-domain and app-level Nginx tests

Create `tests/app-nginx.test.ts`.

Tier: core.

- [ ] Attach a unique hostname under the test server's configured wildcard domain.
- [ ] Verify API state and public routing.
- [ ] Reject attaching the same domain to another app.
- [ ] Remove the custom domain and verify routing disappears.
- [ ] Add a harmless app-level response header.
- [ ] Verify the header publicly.
- [ ] Submit invalid app-level Nginx syntax.
- [ ] Verify status `1116`; add or confirm the corresponding SDK status constant in a small companion SDK change if needed.
- [ ] Verify the previous working configuration remains active.
- [ ] Clear the customization.

Certificate issuance remains in the controlled SSL workflow.

## PR10: Fix backend custom-port persistence

This prerequisite change belongs in `caprover/caprover`.

Tier: unit in the backend repository; PR11 supplies destructive E2E coverage.

- [ ] Preserve `protocol` in `AppsDataStore.updateAppDefinitionInDb()`.
- [ ] Preserve `publishMode` in `AppsDataStore.updateAppDefinitionInDb()`.
- [ ] Propagate `publishMode` into `EndpointSpec.Ports[].PublishMode` during Docker service updates, for explicit protocol and omitted-protocol mappings.
- [ ] Keep the existing service-creation handling of both fields and existing update handling of `protocol`.
- [ ] Preserve legacy TCP-plus-UDP behavior when protocol is omitted.
- [ ] Add backend unit tests for datastore round trips of both fields and Docker create/update requests constructed from persisted mappings.
- [ ] Cover explicit TCP/UDP, ingress/host mode, and omitted optional fields.
- [ ] Link the backend PR here after creation.
- [ ] Merge the backend fix before PR11.

## PR11: Add custom-port E2E tests

Create `tests/custom-ports.test.ts` after PR10 lands and the server image used by E2E contains the fix.

Tier: destructive.

- [ ] Add deterministic high-port allocation scoped to the run.
- [ ] Configure and verify a TCP ingress mapping.
- [ ] Configure and verify a UDP ingress mapping using Node's `dgram` client.
- [ ] Configure and verify a TCP host-mode mapping.
- [ ] Verify API persistence and Docker `EndpointSpec`.
- [ ] Verify real TCP and UDP connectivity.
- [ ] Replace and remove mappings.
- [ ] Verify removed ports close.
- [ ] Verify a full POST update with `ports: []` clears configured mappings.
- [ ] Reject invalid or incomplete port definitions.

## PR12: Add advanced application-setting tests

Create `tests/advanced-app-settings.test.ts`.

Tier: core.

- [ ] Pin an app to the current manager `nodeId`.
- [ ] Verify the Docker placement constraint.
- [ ] Apply a deterministic `serviceUpdateOverride`.
- [ ] Verify the resulting Docker `UpdateConfig`.
- [ ] Apply a minimal deterministic `preDeployFunction`.
- [ ] Verify its actual effect on the Docker update object.
- [ ] Enable app deploy-token configuration.
- [ ] Use the generated token to deploy.
- [ ] Reject an invalid token.
- [ ] Disable the token and verify the old token fails.
- [ ] Create two apps and delete them through the bulk `appNames` API.
- [ ] Verify both API definitions and services disappear.
- [ ] Verify sending both `appName` and `appNames` fails.

## PR13: Add theme tests

Create `tests/themes.test.ts`.

Tier: destructive.

### SDK prerequisite

- [ ] Verify `caprover-api.saveTheme()` sends `extra` and `headEmbed` along with `oldName`, `name`, and `content`; fix the payload if still missing.
- [ ] Add or confirm SDK unit coverage for supplied and omitted optional fields.
- [ ] Link the SDK fix and consume a published version containing it before implementing the field round-trip assertions.

### E2E coverage

- [ ] Save the original current theme.
- [ ] List built-in themes.
- [ ] Create a custom theme with content, extra data, and head embed through the SDK.
- [ ] Verify all three fields round-trip through the API.
- [ ] Verify it becomes current.
- [ ] Retrieve it through the public unauthenticated endpoint.
- [ ] Rename or update it.
- [ ] Select another theme.
- [ ] Verify deleting the active custom theme clears the current theme.
- [ ] Reject editing or deleting a built-in theme.
- [ ] Reject selecting a missing theme.
- [ ] Restore the original theme, including an originally empty selection.

## PR14: Add backup and system-read tests

Create `tests/backup.test.ts` (Tier: destructive) and `tests/system-info.test.ts` (Tier: core).

Backup creation/download touches server-wide backup state; keep it ephemeral.

### Backup

- [ ] Add binary HTTP response support for archive downloads.
- [ ] Create identifiable test configuration.
- [ ] Request a backup.
- [ ] Download it as binary through the one-time endpoint.
- [ ] Validate the tar archive and expected file structure.
- [ ] Inspect selected fields without logging the archive or secrets.
- [ ] Verify an invalid token fails.
- [ ] Verify a second download with the same token fails after the backup file is removed.

### System reads

- [ ] Test captain info, version info, load-balancer info, and node listing.
- [ ] Verify root-domain and SSL state matches provisioning.
- [ ] Verify version fields and non-negative load-balancer counters.
- [ ] Generate traffic and verify counters increase.
- [ ] Verify the single-node environment contains one leader manager.
- [ ] Verify the node ID matches Docker over SSH.
- [ ] Verify the default free Pro feature state.
- [ ] Verify default Pro configuration can be read without changing it.

## PR15: Add destructive disk-cleanup and global Nginx tests

Create `tests/disk-cleanup.test.ts` and `tests/system-nginx.test.ts`.

Tier: destructive for both files. Require ephemeral mode.

### Disk cleanup

- [ ] Preserve the original cleanup settings.
- [ ] Test valid settings, normalization, invalid cron, and negative limits.
- [ ] Build a uniquely tagged test image over SSH.
- [ ] Verify no service references its image ID.
- [ ] Verify `getUnusedImages()` returns it.
- [ ] Verify deployed images are excluded.
- [ ] Delete only the uniquely owned image ID.
- [ ] Verify only that image disappears.
- [ ] Restore the original settings.

### Global Nginx

- [ ] Preserve base and captain overrides.
- [ ] Apply a reviewed harmless customization.
- [ ] Verify API and observable behavior.
- [ ] Submit invalid syntax.
- [ ] Verify the last valid configuration remains active.
- [ ] Restore original values in guaranteed cleanup.

## PR16: Add one-click deployment and repository tests

Create `tests/one-click.test.ts` (Tier: core) and `tests/one-click-repositories.test.ts` (Tier: destructive).

Keep inline deployments in the core file and global repository mutations in the destructive file.

### Inline deployment

- [ ] Always supply a values array, including `[]` when empty.
- [ ] Start a self-contained deployment and obtain a job ID.
- [ ] Poll progress to success or error.
- [ ] Verify observed progress is monotonic.
- [ ] Verify app configuration, Docker state, and public HTTP behavior.
- [ ] Exercise variables, environment values, and a two-service dependency.
- [ ] Reject missing templates and missing or unknown job IDs.
- [ ] Delete every generated app.
- [ ] Delete the project generated by multi-service deployment.

### Custom repository

- [ ] Serve a test-owned `/v4/list` and template endpoint using the source fixture.
- [ ] Add and list the repository.
- [ ] List and fetch its template.
- [ ] Deploy the returned template.
- [ ] Reject duplicate insertion.
- [ ] Delete the repository and reject a second deletion.
- [ ] Clean up the repository-serving app.

- [ ] File a backend or SDK issue for optional `values` if `undefined` still causes `valuesArray.forEach()` to throw.

## PR17: Add registry and observability workflows

Create `tests/registries.test.ts`, `tests/goaccess.test.ts`, and `tests/netdata.test.ts`.

Tier: destructive for all three files. Require ephemeral mode.

### SDK prerequisite

- [ ] Correct `defaultRegistryId` versus backend `defaultPushRegistryId` in `caprover-api`.
- [ ] Publish and consume the corrected package.

### Lightweight registry contracts

- [ ] Read the initial registry list.
- [ ] Reject an unknown default registry ID.
- [ ] Reject invalid remote credentials.
- [ ] Verify expected registry error statuses.

### GoAccess

- [ ] Preserve settings.
- [ ] Enable GoAccess and generate traffic.
- [ ] Retrieve report listings and a live report.
- [ ] Verify missing-app and missing-report behavior.
- [ ] Restore settings.

### NetData

- [ ] Preserve settings.
- [ ] Enable NetData with notifications disabled.
- [ ] Verify service and proxied endpoint.
- [ ] Disable NetData and verify removal.
- [ ] Restore settings.

Full self-hosted registry build-and-push coverage belongs in the controlled SSL workflow because enabling it requests a real certificate.

## PR18: Add specialized external workflows

Tier: destructive, specialized opt-in only. Each workflow provisions its own ephemeral environment and runs only its assigned file. Keep these files under `tests/specialized/` and outside default suite selection.

### Git webhook workflow

File: `tests/specialized/git-webhooks.test.ts`. Tier: destructive (specialized).

- [ ] Configure a dedicated repository and credentials.
- [ ] Test HTTPS and SSH repository authentication.
- [ ] Verify the intended sensitive-field response contract.
- [ ] Trigger a matching-branch build.
- [ ] Verify a nonmatching branch causes no deployment.
- [ ] Verify invalid token behavior.
- [ ] Verify rename rotates the webhook token.
- [ ] Verify clearing repository settings disables the webhook.

### Controlled SSL and self-hosted registry workflow

File: `tests/specialized/ssl-and-registry.test.ts`. Tier: destructive (specialized).

Fresh-server provisioning already requests a real certificate for `captain.<rootDomain>` through `enableRootSsl()`. Certificate-rate management must account for every fresh-server run as well as this workflow's additional app, custom-domain, and registry certificates.

- [ ] Document issuance volume and configure workflow cadence/concurrency with provisioning included in the budget.
- [ ] Call `enableSslForBaseDomain(appName)` and verify a trusted certificate and HTTPS response for `<app>.<rootDomain>`. Dashboard/root SSL remains provisioning coverage.
- [ ] Enable app-level force SSL and verify redirect behavior.
- [ ] Enable custom-domain SSL and verify the certificate.
- [ ] Enable the self-hosted registry.
- [ ] Verify its service, TLS endpoint, and API entry.
- [ ] Set it as default, build an app, and verify the image is pushed.
- [ ] Verify local-registry deletion protections.
- [ ] Disable the registry and verify cleanup.
- [ ] Remove the custom domain and verify cleanup behavior.

### Multi-node workflow

File: `tests/specialized/multi-node.test.ts`. Tier: destructive (specialized).

- [ ] Provision a second droplet.
- [ ] Ensure a usable default registry exists.
- [ ] Add the node as a worker.
- [ ] Verify node listing and task placement.
- [ ] Verify stateless and persistent app pinning.
- [ ] Clean up the node and infrastructure.

### Pro and 2FA workflow

File: `tests/specialized/pro-and-2fa.test.ts`. Tier: destructive (specialized).

- [ ] Use a dedicated Pro key.
- [ ] Verify Pro state and configuration.
- [ ] Enable 2FA.
- [ ] Verify login without OTP returns `1114`.
- [ ] Verify login with generated TOTP succeeds.
- [ ] Disable 2FA in guaranteed cleanup.

### Upgrade workflow

File: `tests/specialized/upgrade.test.ts`. Tier: destructive (specialized).

- [ ] Provision a pinned older CapRover version.
- [ ] Create applications, projects, and persistent data.
- [ ] Upgrade to a pinned newer version.
- [ ] Wait for captain recovery.
- [ ] Verify authentication, configuration, routing, and persistent data.

## API coverage map

This table should be updated whenever `caprover-api` adds or removes a public method.

| API area | Methods | Coverage |
| --- | --- | --- |
| Authentication | `login`, automatic retry, `changePass` | PR2 server contracts; SDK unit tests for automatic retry; password change during provisioning |
| Themes | `getAllThemes`, `getCurrentTheme`, `setCurrentTheme`, `saveTheme`, `deleteTheme` | PR13 |
| Pro | state/configuration/OTP methods | PR14 and PR18 |
| System setup | captain info, root domain, root SSL, force SSL | Provisioning and PR14 |
| Applications | list, register, full update, PATCH, rename, delete, bulk delete | Existing suite, PR3, PR12 |
| Deployments | captain-definition, source upload, build status, runtime logs, deploy token | PR5, PR6, PR12 |
| Projects | list, register, update, delete | PR4 |
| Domains and Nginx | base/custom domains, app/global Nginx, redirects, HTTP auth | PR8, PR9, PR15, PR18 |
| Images and cleanup | unused images, image deletion, cleanup configuration | PR15 |
| Registries | list, local/remote registry operations, default push registry | PR17 and PR18 |
| One-click | lists, repositories, template fetch, deployment, progress | PR16 |
| Nodes | list and add node | PR14 and PR18 |
| Observability | load balancer, NetData, GoAccess and reports | PR14 and PR17 |
| Backup and upgrade | backup creation/download, captain update | PR14 and PR18 |
| Git webhooks | repository configuration and force build | PR18 |
| Generic API | GET, POST, and PATCH generic commands | SDK unit tests; representative E2E error propagation in PR2 and raw contract assertions in PR3/PR5 |

## Completion tracking

- [ ] PR1 merged
- [ ] PR2 merged
- [ ] PR3 merged
- [ ] PR4 merged
- [ ] PR5 merged
- [ ] PR6 merged
- [ ] PR7 merged
- [ ] PR8 merged
- [ ] PR9 merged
- [ ] PR10 merged in `caprover/caprover`
- [ ] PR11 merged
- [ ] PR12 merged
- [ ] PR13 merged
- [ ] PR14 merged
- [ ] PR15 merged
- [ ] PR16 merged
- [ ] PR17 merged
- [ ] PR18 specialized workflows implemented or tracked individually
