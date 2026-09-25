# CapRover E2E Next Engineering Tracker

This tracker contains the next focused E2E engineering work after the original expansion plan was completed and removed.

Last reviewed: 2026-09-25

## Current baseline

The repository currently has five manual workflows:

- `e2e.yml`: ordinary non-destructive coverage against an existing server.
- `e2e-ephemeral.yml`: full fresh-server coverage. HTTP is the default; HTTPS mode also runs Pro and 2FA coverage.
- `e2e-ssl-and-registry.yml`: dedicated trusted SSL and self-hosted registry lifecycle coverage.
- `e2e-multi-node.yml`: multi-node placement, self-hosted registry, and persistent-volume coverage.
- `e2e-upgrade.yml`: pinned release-to-edge and edge-to-edge upgrade coverage.

Fresh-server provisioning already accepts `CAPROVER_IMAGE` and defaults to `caprover/caprover-edge`. Provisioning records the requested CapRover image and the resolved image digest after startup. The Fresh Server GitHub Actions workflow does not currently expose that image as a workflow input.

The upgrade workflow currently pins:

- released baseline: `1.15.4`
- edge A: `37fe03e3267d381342da14a6c9bab543590cc4f3`
- edge B: `a45cce6b7fc0d30ca431a8d8ce83bef72a5a9913`

The registry coverage includes add, invalid credential rejection, default-push behavior, delete protections, and the self-hosted registry lifecycle. The published `caprover-api` SDK also exposes `updateDockerRegistry()`, but the E2E client and suites do not currently exercise that operation.

## Status

| Item | Status | Primary repo | Dependency |
| --- | --- | --- | --- |
| PR19: Parameterized release-candidate testing | [ ] Todo | `caprover/caprover-e2e` | None |
| PR20: Connect E2E to the release process | [ ] Todo | `caprover/caprover` + `caprover/caprover-e2e` | PR19 |
| PR21: Close `updateDockerRegistry()` SDK coverage gap | [ ] Todo | `caprover/caprover-e2e` | None |
| Maintenance: rotate edge upgrade fixtures | [ ] Recurring | `caprover/caprover-e2e` | A newer edge image must exist |

---

## PR19: Parameterized release-candidate testing

### Goal

Allow the full Fresh Server workflow to run against an exact CapRover image reference, including an immutable digest, before that image is treated as release-ready.

Example:

```bash
gh workflow run e2e-ephemeral.yml \
  --repo caprover/caprover-e2e \
  -f caprover_image=caprover/caprover@sha256:...
```

A tag should also work:

```bash
gh workflow run e2e-ephemeral.yml \
  --repo caprover/caprover-e2e \
  -f caprover_image=caprover/caprover:1.16.0-rc.1
```

### Implementation

1. Add a string `workflow_dispatch` input named `caprover_image` to `.github/workflows/e2e-ephemeral.yml`.
2. Keep the normal behavior unchanged by defaulting the input to `caprover/caprover-edge`.
3. Export the selected value as `CAPROVER_IMAGE` for provisioning.
4. Validate the requested image reference before creating paid infrastructure. A bad tag or digest should fail on the GitHub runner before a DigitalOcean droplet is provisioned.
5. Continue using the existing provisioning path. Do not introduce a second CapRover installation implementation for release-candidate runs.
6. Preserve the existing requested-image and resolved-running-digest output so a completed run can be tied to the exact image that actually ran.
7. Update README usage examples for both the UI and `gh workflow run`.

### Validation

Add unit coverage around any new workflow/config plumbing that is represented in TypeScript. The workflow itself should be reviewed for these cases:

- omitted `caprover_image` uses `caprover/caprover-edge`
- explicit image tag reaches provisioning unchanged
- explicit digest reaches provisioning unchanged
- nonexistent image fails before droplet creation
- normal HTTP Fresh Server behavior is unchanged
- `enable_https=true` still composes correctly with an explicit image and still runs Pro + 2FA

### Acceptance criteria

- A maintainer can dispatch Fresh Server against an exact tag or digest.
- The run output makes the requested image and resolved running digest visible.
- Invalid image references fail before infrastructure provisioning.
- Existing callers that provide no new input behave exactly as they do today.
- No new scheduled workflow is added.

---

## PR20: Connect E2E to the CapRover release process

### Goal

Turn the pinned-image Fresh Server run from an ad hoc command into a release gate, while keeping infrastructure spend tied to actual releases.

### Important current release-flow constraint

`caprover/caprover/.github/workflows/publish_release.yml` currently builds and pushes the release image to Docker Hub in `build-publish-docker-hub`, then creates the draft GitHub release.

That means a true "test this exact release image before publishing it" gate requires an immutable candidate image to exist first. The eventual automated design should explicitly model a candidate/promotion flow instead of claiming to gate an image that has not been built yet.

### Phase A: documented manual release step

Start with a manual process and use it across a few releases before making it an automatic blocking dependency.

Document a release checklist similar to:

1. Produce or identify the immutable candidate image that corresponds to the release commit.
2. Resolve and retain its digest.
3. Dispatch `caprover/caprover-e2e` Fresh Server with `caprover_image=<candidate tag or digest>`.
4. Require the complete fresh-server suite to pass.
5. Record the E2E workflow URL and tested digest with the release notes/checklist.
6. Proceed with the normal release publication steps.

The manual phase should answer the candidate-image question explicitly. Good options include a temporary release-candidate tag or another immutable image produced from the exact release inputs. Testing a mutable `latest` or `edge` tag is insufficient for a release gate.

### Phase B: automatic release gate

After the manual process has proven stable, update the CapRover release workflow so release execution performs the same sequence automatically.

Target architecture:

1. Build the exact release candidate image once.
2. Push it under an immutable candidate reference.
3. Capture the registry digest.
4. Dispatch the Fresh Server workflow in `caprover/caprover-e2e` with that digest.
5. Wait for the E2E run result.
6. Continue publication/promotion only after success.
7. On failure, retain enough metadata to identify the candidate digest and E2E run while preventing release promotion.
8. Reuse the already-tested image/digest for publication. Avoid rebuilding different bytes after E2E succeeds.

Implementation will require selecting a secure cross-repository dispatch/authentication mechanism with the minimum permissions necessary. The release workflow should not receive the E2E repository's infrastructure secrets.

### Cost and reliability rules

- Trigger the expensive E2E gate only from a release-driven path.
- Do not add nightly or cron release-candidate provisioning.
- Keep E2E infrastructure ownership and secrets inside `caprover/caprover-e2e`.
- Preserve unconditional cleanup of temporary infrastructure.
- Prefer immutable digests at the boundary between the release workflow and E2E workflow.
- Surface the E2E run URL and tested digest in the release job summary.

### Acceptance criteria

Phase A:

- The release documentation contains a concrete command using PR19.
- The checklist requires the exact tested digest to be retained.
- Maintainers have a clear rule for what qualifies as the candidate image.

Phase B:

- The CapRover release path automatically dispatches E2E for the exact candidate digest.
- Release promotion waits for E2E success.
- A failed E2E run stops promotion.
- The published release is byte-for-byte the candidate that passed E2E.
- No E2E infrastructure credentials are copied into the CapRover repository.

---

## PR21: Close the `updateDockerRegistry()` SDK coverage gap

### Goal

Exercise the published SDK's registry update contract against a real CapRover server and correct the coverage claim around remote registry operations.

Current SDK contract:

```ts
updateDockerRegistry(dockerRegistry: IRegistryInfo): Promise<void>
```

It sends `POST /user/registries/update`.

Backend behavior worth testing directly:

- the backend authenticates against the supplied registry before persisting the update
- `id`, `registryUser`, `registryPassword`, and `registryDomain` are required
- missing required fields produce `captainStatus: 1110`
- an unknown registry ID produces `captainStatus: 1111`, provided registry authentication succeeds first
- failed registry authentication produces `captainStatus: 1112`
- attempting to update a `LOCAL_REG` produces `captainStatus: 1108` after authentication succeeds
- rejected updates must leave persisted registry state unchanged

### Test-fixture strategy

Use the existing self-hosted registry created by `tests/specialized/ssl-and-registry.test.ts` as the authenticated registry endpoint. This avoids adding Docker Hub/GHCR credentials or a new external dependency.

The specialized test already has:

- a trusted HTTPS registry endpoint at `registry.<rootDomain>:996`
- a generated valid username/password
- a verified authenticated `/v2/` endpoint
- cleanup logic for the self-hosted registry

Create a second registry record through `addDockerRegistry()` that points at the same authenticated endpoint. The insert route stores user-created entries as `REMOTE_REG`, so this gives the test a real, valid remote-registry record while the original self-hosted entry remains `LOCAL_REG`.

This fixture lets the same specialized run test both successful remote updates and local-registry update protection without new secrets or infrastructure.

### Implementation

1. Add `updateDockerRegistry(registry)` to `src/clients/caprover.ts` and route it through the existing request/error wrapper.
2. Add unit coverage in `tests/unit/caprover-client.test.ts` proving the client delegates to the SDK method with the complete registry object.
3. Extend the SSL/registry specialized test after the self-hosted registry is confirmed healthy:
   - create a remote registry record using the local registry's working domain and credentials
   - identify the newly created `REMOTE_REG` entry by its unique test prefix
   - update a mutable field such as `registryImagePrefix` while retaining valid authentication fields
   - read the registry list back and verify the same ID contains the updated state
4. Exercise required-field rejection using the remote registry and verify the registry list is unchanged.
5. Exercise invalid-credential rejection and verify the registry list is unchanged.
6. Exercise an unknown ID with valid credentials and expect `1111`; valid credentials matter because authentication happens before the datastore checks the ID.
7. Call `updateDockerRegistry()` on the actual `LOCAL_REG` entry using its valid current credentials and expect `1108`.
8. Verify the local registry entry remains unchanged after the rejected mutation.
9. Delete the temporary `REMOTE_REG` entry before disabling the self-hosted registry.
10. Keep credentials out of assertion messages, diagnostics, snapshots, and logs.

### State-preservation assertions

For every rejected mutation, capture a normalized registry state before the call and compare it with the state afterward.

Avoid printing decrypted registry passwords on failure. Normalize comparisons so secret values are either compared in memory without serialization or removed/redacted from diagnostic output.

### Acceptance criteria

- `CapRoverClient` exposes the SDK update method.
- A successful authenticated `REMOTE_REG` update is verified by a subsequent GET.
- Empty required-field rejection is covered.
- Invalid authentication rejection is covered.
- Unknown-ID rejection is covered using valid authentication.
- `LOCAL_REG` update protection is covered.
- Every rejected update proves state preservation.
- No new external registry account or secret is required.
- The README coverage map accurately describes registry CRUD/update coverage after the tests land.

---

## Maintenance: rotate edge-to-edge upgrade fixtures

### Purpose

The upgrade suite currently proves two different paths:

1. released CapRover `1.15.4` to a pinned edge image
2. pinned edge A to pinned edge B

The second path only remains useful if A and B represent two real successive edge builds. Once a newer edge build is available, rotate the fixture forward so the current edge build itself has a tested forward-upgrade path.

### Rotation procedure

Given current edge fixtures A and B and a new edge build C:

1. move the old B SHA/digest into `E2E_UPGRADE_EDGE_FROM_SHA`
2. set `E2E_UPGRADE_EDGE_TO_SHA` to C
3. run `scripts/check-upgrade-images.mjs` through the normal workflow preflight so both references resolve to immutable digests
4. run `e2e-upgrade.yml`
5. require the full release-to-edge and edge-to-edge data-preservation suite to pass
6. record the successful run before treating the fixture rotation as complete

Do not set both sides to the same mutable `caprover-edge` tag. The test needs two distinct immutable builds to prove an actual upgrade occurred.

### Recurrence

This is maintenance rather than a one-time feature PR. Rotate when a meaningful newer edge image exists and especially before relying on the latest edge build as an upgrade destination for a release.

---

## Recommended sequencing

PR19 is the immediate next implementation item.

PR20 depends on PR19. PR21 is independent and can be implemented while the manual PR20 release process is being exercised.

A practical sequence is:

1. PR19
2. PR21
3. PR20 Phase A documentation/manual gate
4. use the manual gate for a few real releases
5. PR20 Phase B automation
6. rotate edge upgrade fixtures whenever a new edge build makes the current A/B pair stale
