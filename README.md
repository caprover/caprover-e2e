# CapRover E2E

External end-to-end tests for CapRover. The suite can run against an existing
disposable server or provision a fresh DigitalOcean server and Cloudflare DNS
record for a clean-room run.

The suite validates each lifecycle change from three independent perspectives:

- CapRover API state through the published `caprover-api` package
- Docker Swarm state over SSH
- Publicly observable HTTP behavior

## Covered lifecycle

The initial suite runs one sequential application lifecycle:

1. Validate CapRover, SSH, Docker, and Swarm manager access.
2. Create an app and wait for its placeholder service.
3. Rename the app.
4. Add and verify an environment variable.
5. Deploy a pinned Alpine-based Nginx image.
6. Scale to two instances.
7. Scale back to one instance.
8. Deploy a different pinned Nginx image.
9. Delete the app and verify its Nginx response disappears.

The suite supports the current `<appName>` Docker service naming and the legacy
`srv-captain--<appName>` naming used by older CapRover installations.

## Requirements

- Node.js 22.12 or newer
- For existing-server runs: a disposable CapRover installation with a configured
  root domain
- Public wildcard DNS for application subdomains
- Ports 80 and 443 reachable from the test runner
- SSH access to the Docker Swarm manager
- Docker access for the configured SSH user

The CapRover URL must use HTTPS and be the dashboard origin, for example:

```text
https://captain.example.com
```

Do not include `/api/v2`, a trailing path, query parameters, or a fragment.

## Local development

Install dependencies:

```bash
npm ci
```

To run against an existing disposable CapRover server, create your local
environment file and fill in the server values:

```bash
cp .env.template .env
npm test
```

`.env` is gitignored and is loaded automatically only for local runs. CI systems
such as GitHub Actions provide their environment variables directly and do not
load `.env`.

The SSH host defaults to the hostname from `CAPROVER_URL`. Set `SSH_HOST`
explicitly only when SSH is exposed through a different hostname or IP address.
`SSH_PORT` is optional and defaults to `22`.

To provision a fresh server, run the tests, and destroy the temporary
infrastructure in one command, fill in the ephemeral provisioning values in
`.env` and run:

```bash
npm run test:ephemeral
```

The workflow uses `npm run provision` and `npm run destroy` as lower-level
commands. For local end-to-end runs, prefer `npm run test:ephemeral` so the
generated connection details are passed directly to the test process.

`provision` creates one DigitalOcean droplet, creates a unique unproxied
Cloudflare wildcard DNS record, verifies Docker is available, starts a fresh
CapRover instance, configures its root domain and HTTPS, and generates a temporary
CapRover password. The default DigitalOcean image has Docker preinstalled; custom
images still use the existing Docker installation fallback when needed. The generated cleanup state is stored locally in
`.e2e-provisioning-state.json` and is gitignored.

See [Provisioning design](provisioning/README.md) for the full lifecycle,
failure-recovery behavior, credential flow, and code layout.

The default provisioning configuration uses `nyc3`, `s-1vcpu-2gb`,
`docker-20-04`, and `caprover/caprover-edge`. These can be overridden with
`DIGITALOCEAN_REGION`, `DIGITALOCEAN_SIZE`, `DIGITALOCEAN_IMAGE`, and
`CAPROVER_IMAGE`.

The test output never prints the CapRover password or SSH private key. Failure
diagnostics include sanitized CapRover state, Docker service state, task state,
and a bounded tail of logs from the generated test application.

## GitHub Actions

### Existing server

The existing **CapRover E2E** workflow runs manually through **Actions → CapRover
E2E → Run workflow** and reuses an already-provisioned server.

Configure these repository secrets first:

| Secret                         | Description                                           |
| ------------------------------ | ----------------------------------------------------- |
| `CAPROVER_E2E_PASSWORD`        | Password configured on the disposable CapRover server |
| `CAPROVER_E2E_SSH_PRIVATE_KEY` | Private key matching an authorized key on the server  |

Each run asks for:

- CapRover dashboard URL
- SSH user
- SSH port

The SSH host is derived from the CapRover dashboard URL. The workflow only
supplies configuration and runs `npm test`; all test logic lives in the
TypeScript suite.

### Fresh server

The **CapRover E2E - Fresh Server** workflow provisions a new environment, runs
the smoke, core, and ordinary destructive suites, and destroys the temporary DNS record and droplet
even when the test step fails.

Configure these repository secrets:

| Secret                         | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `DIGITALOCEAN_TOKEN`           | DigitalOcean API token with droplet access                     |
| `DIGITALOCEAN_SSH_KEY_ID`      | DigitalOcean ID of the public key matching the SSH private key |
| `CLOUDFLARE_API_TOKEN`         | Cloudflare API token with DNS edit access                      |
| `CLOUDFLARE_ZONE_ID`           | Cloudflare zone ID containing the E2E base domain              |
| `E2E_BASE_DOMAIN`              | Base domain under which temporary wildcard records are created |
| `CAPROVER_E2E_SSH_PRIVATE_KEY` | Private key matching the DigitalOcean SSH key                  |

The fresh-server workflow uses a generated CapRover password for each run. The
existing-server workflow remains available for fast repeated test runs without
reprovisioning infrastructure.

### Git webhook workflow (specialized)

The manually triggered **CapRover E2E - Git Webhooks** workflow provisions a
fresh server, runs only `tests/specialized/git-webhooks.test.ts`, and destroys
the infrastructure. It is excluded from `npm test` and `test:destructive`.

Create a dedicated **private** GitHub repository with the file
[`tests/fixtures/git-webhook-repo/captain-definition`](tests/fixtures/git-webhook-repo/captain-definition)
at its root on the configured branch. Pin the branch to that fixture commit
while running this workflow. Give CapRover read access through both a
fine-grained read-only GitHub token and a read-only deploy key. Use a separate
key from the one used to SSH into the DigitalOcean server. No GitHub webhook
needs to be installed: the test sends the GitHub push payload directly to
CapRover and verifies the resulting Git clone and deployment.

Configure the fresh-server secrets listed above and these additional secrets
in the `caprover-e2e` repository:

| Secret                    | Value                                                   |
| ------------------------- | ------------------------------------------------------- |
| `E2E_GIT_HTTPS_REPO`      | `https://github.com/owner/private-fixture.git`          |
| `E2E_GIT_SSH_REPO`        | `git@github.com:owner/private-fixture.git`              |
| `E2E_GIT_BRANCH`          | Branch containing the pinned fixture commit             |
| `E2E_GIT_HTTP_USER`       | Git username, commonly `x-access-token`                 |
| `E2E_GIT_HTTP_PASSWORD`   | Read-only fine-grained GitHub token for that repository |
| `E2E_GIT_SSH_PRIVATE_KEY` | Unencrypted private key for the read-only deploy key    |
| `E2E_GIT_EXPECTED_COMMIT` | Full 40-character SHA of the fixture commit             |

The workflow checks that settings exist before creating a droplet. The test
also checks both URLs point to the same repository and compares the Git hash
from each build to the expected commit. Git credentials and webhook tokens are
never included in assertions or diagnostic output. The generic `diagnose`
command is deliberately omitted because captain build logs can contain Git
credentials after a failed clone. Running `npm run test:git-webhooks` directly
requires `CAPROVER_E2E_ENVIRONMENT=ephemeral` and the same fixture settings.

## Development checks

```bash
npm run typecheck
npm run format
```

The test creates unique application names and performs best-effort cleanup for
both the original and renamed names. Cleanup warnings preserve the original test
failure.

## Test tiers and safety

| Command                    | Selection                                                               |
| -------------------------- | ----------------------------------------------------------------------- |
| `npm test`                 | Type checking, then `test:all`                                          |
| `npm run test:unit`        | Local unit tests, no server required                                    |
| `npm run test:smoke`       | Existing application lifecycle                                          |
| `npm run test:core`        | Explicitly listed app-scoped tests on a dedicated test server           |
| `npm run test:destructive` | Explicitly listed global and destructive tests; requires ephemeral mode |
| `npm run test:all`         | Unit, smoke, core; adds ordinary destructive tests in ephemeral mode    |

Provisioning sets `CAPROVER_E2E_ENVIRONMENT=ephemeral` for the test process.
Leave this unset for existing servers. This flag declares a disposable environment;
set it only for a freshly provisioned server owned by the run. Never point the suite
at a production server. Each future destructive file must call `requireEphemeral()`
before creating a context or mutating resources. Direct file filters cannot expand
the selected tier. Specialized workflows under `tests/specialized/` are excluded
from all default selections and will have their own explicit configuration.

Core and destructive commands fail with no tests until their files are implemented.
Existing-server workflow runs are serialized without cancelling an active run.
Coordinate local runs separately to avoid concurrent mutations of the same server.

New resource tests use `withCleanup()`: register cleanup before a named resource's
create request, scope it to that run's exact resource, and tolerate an already-absent
resource. Cleanup runs in reverse order and attempts all actions. A cleanup failure
fails the run, and an original test failure is retained alongside cleanup failures.
The existing smoke lifecycle keeps its original best-effort cleanup behavior.

Provisioning logs the requested CapRover image, and environment validation logs
the running service image reference including its digest when Docker resolves one.
For reproducible prerequisite validation, set `CAPROVER_IMAGE` to a known digest
containing the required backend fix and retain the run's image output.

Authentication coverage exercises valid login, empty/oversized password validation,
one wrong-password attempt, SDK error propagation, and an unauthenticated request.
Rapid repeated runs can encounter the server's global failed-login backoff; wait
for that window to expire before retrying. Root-domain setup, root SSL, global
force SSL, and password change are covered by fresh-server provisioning.

## Source uploads

Source uploads require `caprover-api@0.0.22` or newer, which includes the merged
[native FormData fix](https://github.com/caprover/caprover-api/pull/9).
The fixture uses the runner's `tar` executable and a digest-pinned Nginx image;
it creates unique HTTP and Unicode startup-log markers without extra dependencies.
