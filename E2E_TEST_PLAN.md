# CapRover E2E Test Expansion Plan

This document tracks expansion of the CapRover end-to-end test suite.

The existing suite covers login, application creation, rename, one environment update, image deployment, scaling, redeployment, and deletion. The work below expands coverage across the remaining high-value CapRover API workflows.

Future agents should check each item as it lands. A PR is complete only when every required checkbox in its section is checked or an explicitly deferred item links to a follow-up issue.

## Testing principles

- [ ] Keep the existing full-update lifecycle using `updateConfigAndSave()`.
- [ ] Test PATCH through a separate regression path focused on preserving omitted fields.
- [ ] Validate important mutations through CapRover API state.
- [ ] Validate relevant mutations through Docker state over SSH.
- [ ] Validate routing and application behavior through public HTTP where applicable.
- [ ] Run mutating tests serially.
- [ ] Generate unique names for apps, projects, themes, domains, and volumes.
- [ ] Register cleanup immediately after creating each resource.
- [ ] Run cleanup in LIFO order and preserve the original test failure.
- [ ] Save and restore global settings modified by tests.
- [ ] Use small, pinned container images.
- [ ] Keep each PR independently reviewable and green.
- [ ] Extend workflow timeouts only as actual suite runtime grows.

## PR1: Upgrade the API package and prepare the harness

- [ ] Upgrade `caprover-api` from `0.0.20` to `0.0.21`.
- [ ] Update `package-lock.json`.
- [ ] Add `CapRoverClient.patchApp()` using `patchAppDefinition()`.
- [ ] Keep `CapRoverClient.updateApp()` on the existing full POST update path.
- [ ] Add client wrappers for configurable runtime-log encoding.
- [ ] Add client wrappers for attached and detached source uploads.
- [ ] Add a lightweight LIFO cleanup registry.
- [ ] Add unique-name generation for projects, themes, volumes, and domains.
- [ ] Add helpers for saving and restoring global settings.
- [ ] Extract reusable assertions for app existence, service existence, replicas, image, and HTTP reachability.
- [ ] Expand failure diagnostics with Docker service specification.
- [ ] Expand failure diagnostics with Docker task state.
- [ ] Expand failure diagnostics with build status and a bounded build-log tail.
- [ ] Expand failure diagnostics with a bounded runtime-log tail.
- [ ] Add unit tests for cleanup ordering and cleanup after failure.
- [ ] Add unit tests proving full update uses POST and partial update uses PATCH.
- [ ] Update the README with the planned suite organization.
- [ ] Increase the fresh-server test-step timeout to accommodate the first expansion.
- [ ] Confirm the existing lifecycle passes unchanged.

## PR2: Test full-update and PATCH semantics

Create `tests/app-configuration.test.ts`.

### Full-update behavior

- [ ] Create an app with several non-default fields.
- [ ] Update description.
- [ ] Update multiple environment variables.
- [ ] Update multiple tags.
- [ ] Update container HTTP port.
- [ ] Update WebSocket support.
- [ ] Update `notExposeAsWebApp`.
- [ ] Update service-update override.
- [ ] Enable app deploy-token configuration.
- [ ] Verify every field through the CapRover API.
- [ ] Verify relevant environment and service settings through Docker.
- [ ] Verify explicitly supplied empty arrays clear environment variables.
- [ ] Verify explicitly supplied empty arrays clear tags.
- [ ] Verify explicitly supplied empty arrays clear ports.
- [ ] Verify explicitly supplied empty arrays clear volumes.

### PATCH preservation

- [ ] Configure several non-default fields using the full update path.
- [ ] PATCH only `instanceCount`.
- [ ] Verify PATCH preserves environment variables.
- [ ] Verify PATCH preserves description.
- [ ] Verify PATCH preserves tags.
- [ ] Verify PATCH preserves container HTTP port.
- [ ] Verify PATCH preserves WebSocket support.
- [ ] Verify PATCH preserves `notExposeAsWebApp`.
- [ ] Verify PATCH preserves service-update override.
- [ ] Verify PATCH preserves deploy-token configuration.
- [ ] PATCH instance count to zero.
- [ ] Verify API desired count is zero.
- [ ] Verify Docker desired and running counts converge to zero.
- [ ] PATCH back to one and verify recovery.
- [ ] PATCH `envVars: []` and verify explicit clearing.
- [ ] PATCH multiple fields in one request.
- [ ] Verify PATCH for a missing app fails.
- [ ] Verify a raw PATCH without `appName` returns status `1110`.

### Representative app validation

- [ ] Reject a duplicate app name.
- [ ] Reject an uppercase app name.
- [ ] Reject a reserved `captain-*` name.
- [ ] Reject a double-hyphen name.
- [ ] Reject rename to an existing app.
- [ ] Reject rename of a missing app.
- [ ] Reject deletion of a missing app.

## PR3: Add project lifecycle tests

Create `tests/projects.test.ts`.

- [ ] Add project API wrappers to the E2E client.
- [ ] Create a root project.
- [ ] Create a child project.
- [ ] Verify IDs, names, descriptions, and parent relationship.
- [ ] Update the child project.
- [ ] Create an app assigned to the child.
- [ ] Verify the app's `projectId`.
- [ ] Move the app to the root project.
- [ ] Remove the app from all projects.
- [ ] Reject app creation with an unknown project ID.
- [ ] Reject app update with an unknown project ID.
- [ ] Reject deletion of a project containing an app.
- [ ] Reject deletion of a parent containing a child.
- [ ] Reject self-parenting.
- [ ] Reject an unknown parent UUID.
- [ ] Delete the child project.
- [ ] Delete the root project.
- [ ] Verify cleanup succeeds after partial test failure.

## PR4: Add deployment modes, source uploads, and logs

Create `tests/deployments.test.ts`.

### Helpers

- [ ] Add a reusable build-completion poller.
- [ ] Add helpers for retrieving build logs.
- [ ] Add helpers for ASCII, UTF-8, and hexadecimal runtime logs.
- [ ] Add an in-memory source-tarball builder.
- [ ] Add attached and detached upload helpers.

### Captain-definition deployment

- [ ] Deploy a pinned image synchronously.
- [ ] Supply a unique Git hash.
- [ ] Verify `deployedVersion` increments exactly once.
- [ ] Verify the version entry contains the Git hash.
- [ ] Verify the version entry contains the deployed image.
- [ ] Verify Docker runs the expected image.
- [ ] Verify the application responds publicly.

### Detached deployment

- [ ] Start a detached deployment.
- [ ] Verify the request returns before the deployment completes.
- [ ] Poll build state to completion.
- [ ] Verify `isAppBuilding` returns to false.
- [ ] Verify final API, Docker, and HTTP state.

### Failure and recovery

- [ ] Deploy an intentionally missing image tag.
- [ ] Verify the build reaches a failed terminal state.
- [ ] Verify build logs contain a useful error.
- [ ] Deploy a valid image afterward.
- [ ] Verify API, Docker, and HTTP recovery.

### Runtime logs

- [ ] Deploy a fixture that prints a unique marker.
- [ ] Verify ASCII logs contain the marker.
- [ ] Verify UTF-8 logs preserve a Unicode marker.
- [ ] Verify hex logs decode to the same content.
- [ ] Verify missing-app log retrieval fails.

### Source upload

- [ ] Build a tiny Dockerfile-based source archive.
- [ ] Test attached source upload.
- [ ] Test detached source upload.
- [ ] Verify the built image executes.
- [ ] Verify the public response contains a unique marker.
- [ ] Verify build logs.
- [ ] Reject deployment with neither tarball nor captain-definition.
- [ ] Reject deployment with both tarball and captain-definition.
- [ ] Reject malformed captain-definition content.

## PR5: Add persistent-storage and volume-safety tests

Create `tests/persistent-storage.test.ts`.

- [ ] Add Docker helpers for CapRover volume-name resolution.
- [ ] Add Docker helpers for volume existence.
- [ ] Add Docker helpers for reading and writing a marker through a temporary container.
- [ ] Add Docker helpers for inspecting service mounts.
- [ ] Create a persistent app.
- [ ] Attach a named volume.
- [ ] Verify API and Docker mount configuration.
- [ ] Write a unique marker into the volume.
- [ ] Redeploy another image.
- [ ] Verify the marker remains.
- [ ] Recreate or restart the service and verify persistence.
- [ ] Delete the app while retaining the volume.
- [ ] Verify the volume remains.
- [ ] Attach the retained volume to another app.
- [ ] Verify the marker remains readable.
- [ ] Delete the second app and request volume deletion.
- [ ] Verify Docker removes the volume.
- [ ] Verify a non-persistent app rejects volume configuration.
- [ ] Reject an invalid volume name.
- [ ] Reject a volume missing its container path.
- [ ] Verify an in-use shared volume appears in `volumesFailedToDelete`.
- [ ] Verify the shared volume remains present.

## PR6: Add routing and application-level Nginx tests

Create `tests/app-routing.test.ts`.

### Alternate container port

- [ ] Deploy an image listening on a port other than 80.
- [ ] Set `containerHttpPort`.
- [ ] Verify API persistence.
- [ ] Verify the public route reaches the alternate port.

### Web exposure

- [ ] Set `notExposeAsWebApp: true`.
- [ ] Verify the Docker service remains healthy.
- [ ] Verify the public hostname stops routing to the app.
- [ ] Re-enable exposure.
- [ ] Verify public routing recovers.

### HTTP authentication

- [ ] Configure a username and password.
- [ ] Verify an anonymous request is rejected.
- [ ] Verify incorrect credentials are rejected.
- [ ] Verify correct credentials succeed.
- [ ] Change the password and verify the change.
- [ ] Clear HTTP authentication.

### Redirects

- [ ] Configure `redirectDomain`.
- [ ] Verify the response location.
- [ ] Clear the redirect.
- [ ] Verify normal proxying returns.

### Custom domains

- [ ] Attach a unique hostname under the ephemeral wildcard domain.
- [ ] Verify API state.
- [ ] Verify public routing.
- [ ] Reject attachment of the same domain to another app.
- [ ] Remove the custom domain.
- [ ] Verify routing disappears.

### Custom Nginx configuration

- [ ] Add a harmless response header.
- [ ] Verify the header publicly.
- [ ] Submit invalid Nginx syntax.
- [ ] Verify status `1116`.
- [ ] Verify the previous working configuration remains active.
- [ ] Clear the custom configuration.

### WebSocket support

- [ ] Enable `websocketSupport`.
- [ ] Verify API persistence.
- [ ] Verify generated Nginx configuration contains upgrade directives.
- [ ] Add a real WebSocket handshake fixture when a stable small fixture is available.

## PR7: Fix backend custom-port persistence

This is a prerequisite change in `caprover/caprover`.

- [ ] Preserve `protocol` in `AppsDataStore.updateAppDefinitionInDb()`.
- [ ] Preserve `publishMode` in `AppsDataStore.updateAppDefinitionInDb()`.
- [ ] Pass protocol and publish mode during Docker service creation.
- [ ] Pass protocol and publish mode during Docker service updates.
- [ ] Preserve legacy TCP-plus-UDP behavior when protocol is omitted.
- [ ] Add backend unit tests for persistence.
- [ ] Add backend unit tests for Docker service creation.
- [ ] Add backend unit tests for Docker service updates.
- [ ] Merge the backend fix before PR8.

## PR8: Add custom-port E2E tests

Create `tests/custom-ports.test.ts` after PR7 lands.

- [ ] Configure a TCP ingress mapping.
- [ ] Verify API persistence.
- [ ] Verify Docker `EndpointSpec`.
- [ ] Verify real TCP connectivity.
- [ ] Configure a UDP ingress mapping.
- [ ] Verify API persistence.
- [ ] Verify Docker `EndpointSpec`.
- [ ] Verify real UDP connectivity.
- [ ] Configure a TCP host-mode mapping.
- [ ] Verify Docker `PublishMode`.
- [ ] Replace an existing mapping.
- [ ] Remove all mappings.
- [ ] Verify removed ports close.
- [ ] Reject port zero.
- [ ] Reject a negative port.
- [ ] Reject a port greater than 65534.
- [ ] Reject an entry missing the host port.
- [ ] Reject an entry missing the container port.

## PR9: Add themes, backup, and system-read tests

Create `tests/themes.test.ts`, `tests/backup.test.ts`, and `tests/system-info.test.ts`.

### Themes

- [ ] List built-in themes.
- [ ] Create a custom theme with content, extra data, and head embed.
- [ ] Verify the custom theme becomes current.
- [ ] Retrieve it through the public unauthenticated endpoint.
- [ ] Rename or update the theme.
- [ ] Select another theme.
- [ ] Delete the custom theme.
- [ ] Reject editing a built-in theme.
- [ ] Reject deleting a built-in theme.
- [ ] Reject selecting a missing theme.

### Backup

- [ ] Create identifiable app, project, and theme configuration.
- [ ] Request a backup.
- [ ] Download it through the one-time download endpoint.
- [ ] Validate that the result is a tar archive.
- [ ] Verify expected configuration markers inside the archive.
- [ ] Verify an invalid token fails.
- [ ] Verify a consumed token cannot download the file again.

### System reads

- [ ] Test `getCaptainInfo()`.
- [ ] Test `getVersionInfo()`.
- [ ] Test `getLoadBalancerInfo()`.
- [ ] Test `getAllNodes()`.
- [ ] Verify root domain and captain subdomain.
- [ ] Verify root SSL and force-SSL match provisioning.
- [ ] Verify version fields are populated.
- [ ] Verify load-balancer counters are non-negative.
- [ ] Generate traffic and verify counters increase.
- [ ] Verify the environment contains one leader manager.
- [ ] Verify the reported node ID matches Docker over SSH.

## PR10: Add disk-cleanup and global Nginx tests

Create `tests/disk-cleanup.test.ts` and `tests/system-nginx.test.ts`.

### Disk cleanup

- [ ] Read and preserve the original settings.
- [ ] Set a valid limit, cron expression, and timezone.
- [ ] Read the normalized values back.
- [ ] Disable scheduling and verify normalization.
- [ ] Reject an invalid cron expression.
- [ ] Reject a negative recent-image limit.
- [ ] Pull a disposable unused image over SSH.
- [ ] Verify `getUnusedImages()` returns it.
- [ ] Verify the active application image is excluded.
- [ ] Delete only the resolved disposable image ID.
- [ ] Verify Docker removed it.
- [ ] Restore the original settings.

### Global Nginx

- [ ] Read and preserve base and captain Nginx overrides.
- [ ] Apply a harmless valid customization.
- [ ] Verify API state and observable behavior.
- [ ] Submit invalid syntax.
- [ ] Verify the last valid configuration remains active.
- [ ] Restore the original values in guaranteed cleanup.

## PR11: Add inline one-click deployment tests

Create `tests/one-click.test.ts`.

- [ ] Start deployment with a self-contained template and pinned image.
- [ ] Verify a nonempty job ID.
- [ ] Poll deployment progress.
- [ ] Verify progress never moves backward.
- [ ] Verify the final state reports success.
- [ ] Verify generated app configuration.
- [ ] Verify Docker service state.
- [ ] Verify the public endpoint.
- [ ] Exercise template variables.
- [ ] Exercise environment values.
- [ ] Exercise a two-service dependency template.
- [ ] Reject a missing template.
- [ ] Reject a missing job ID.
- [ ] Reject an unknown job ID.
- [ ] Clean up every generated app.

## PR12: Add custom one-click repository tests

Use the source-upload fixture from PR4 to serve a test-owned repository.

- [ ] Serve `/v4/list`.
- [ ] Serve `/v4/apps/<template>`.
- [ ] Serve any required logo path.
- [ ] Add the repository.
- [ ] Verify it appears in `getAllOneClickAppRepos()`.
- [ ] Verify its app appears in `getAllOneClickApps()`.
- [ ] Fetch its template through `getOneClickAppByName()`.
- [ ] Deploy the returned template.
- [ ] Reject duplicate insertion.
- [ ] Delete the repository.
- [ ] Reject deleting it again.
- [ ] Clean up the repository-serving app.

## PR13: Add registry coverage

### SDK prerequisite

The backend returns `defaultPushRegistryId`, while the SDK currently declares `defaultRegistryId`.

- [ ] Correct the response type in `caprover-api`.
- [ ] Publish the corrected package.
- [ ] Upgrade this repository to the corrected package.

### Self-hosted registry

Create `tests/registry.test.ts`.

- [ ] Enable the local registry.
- [ ] Verify the Docker service.
- [ ] Verify the TLS endpoint.
- [ ] Verify the API registry entry.
- [ ] Reject enabling it twice.
- [ ] Set it as the default push registry.
- [ ] Build an app.
- [ ] Verify the resulting image is pushed to the local registry.
- [ ] Reject direct deletion of the local registry.
- [ ] Change default-registry state as required.
- [ ] Disable the local registry.
- [ ] Verify service and API cleanup.

### Remote registry

Requires dedicated disposable credentials.

- [ ] Add a valid remote registry.
- [ ] Verify first-registry default behavior.
- [ ] Update credentials or image prefix.
- [ ] Switch the default registry.
- [ ] Reject invalid credentials.
- [ ] Reject deletion while default.
- [ ] Delete after changing the default.
- [ ] Verify the intended sensitive-field response contract.

## PR14: Add GoAccess and NetData tests

Create `tests/observability.test.ts`. Run it only against fresh ephemeral servers.

### GoAccess

- [ ] Preserve original settings.
- [ ] Enable GoAccess.
- [ ] Generate traffic for base and custom domains.
- [ ] Retrieve the report list.
- [ ] Fetch a live report.
- [ ] Verify the report contains the expected hostname.
- [ ] Verify missing-app behavior.
- [ ] Verify missing-report behavior.
- [ ] Restore the original settings.

### NetData

- [ ] Preserve original settings.
- [ ] Enable NetData with notifications disabled.
- [ ] Verify the Docker service.
- [ ] Verify the proxied endpoint.
- [ ] Read back configuration.
- [ ] Disable NetData.
- [ ] Verify service removal.
- [ ] Restore the original settings.

## PR15: Add specialized workflows

These scenarios require dedicated infrastructure, credentials, or execution cadence.

### Git webhook workflow

- [ ] Configure a dedicated Git repository and credentials.
- [ ] Test HTTPS repository credentials.
- [ ] Test SSH repository credentials.
- [ ] Verify the intended encrypted or masked response contract.
- [ ] Trigger a build through the generated webhook.
- [ ] Verify a matching branch deploys.
- [ ] Verify a nonmatching branch is acknowledged without deployment.
- [ ] Verify an invalid webhook token fails.
- [ ] Verify rename rotates the webhook token.
- [ ] Verify clearing repository settings disables the webhook.

### SSL workflow

Run at a controlled cadence to manage certificate issuance.

- [ ] Enable base-domain SSL.
- [ ] Verify certificate hostname and HTTPS routing.
- [ ] Enable app-level force SSL.
- [ ] Verify HTTP redirects to HTTPS.
- [ ] Enable custom-domain SSL.
- [ ] Verify certificate hostname and HTTPS routing.
- [ ] Remove the custom domain.
- [ ] Verify routing and certificate cleanup behavior.

### Multi-node workflow

- [ ] Provision a second droplet.
- [ ] Ensure a usable default registry exists.
- [ ] Add the second node as a worker.
- [ ] Verify both nodes through the API.
- [ ] Pin a stateless app to the worker.
- [ ] Verify Docker task placement.
- [ ] Pin a persistent app.
- [ ] Verify Docker task placement and persistence.
- [ ] Clean up the remote node and infrastructure.

### Pro and 2FA workflow

Requires a dedicated Pro key.

- [ ] Verify Pro state.
- [ ] Set the Pro API key.
- [ ] Read and update Pro alert configuration.
- [ ] Enable 2FA.
- [ ] Verify login without OTP returns status `1114`.
- [ ] Generate a valid TOTP.
- [ ] Verify login with TOTP succeeds.
- [ ] Disable 2FA in guaranteed cleanup.

### Upgrade workflow

- [ ] Provision a pinned older CapRover image.
- [ ] Create apps, projects, and persistent data.
- [ ] Upgrade to a pinned newer version through `performUpdate()`.
- [ ] Wait for the captain service to recover.
- [ ] Verify login.
- [ ] Verify applications and projects.
- [ ] Verify routing.
- [ ] Verify persistent data.
- [ ] Verify global settings survive the upgrade.

## Completion tracking

- [ ] PR1 merged
- [ ] PR2 merged
- [ ] PR3 merged
- [ ] PR4 merged
- [ ] PR5 merged
- [ ] PR6 merged
- [ ] PR7 merged in `caprover/caprover`
- [ ] PR8 merged
- [ ] PR9 merged
- [ ] PR10 merged
- [ ] PR11 merged
- [ ] PR12 merged
- [ ] PR13 merged
- [ ] PR14 merged
- [ ] PR15 specialized workflows implemented or tracked individually
