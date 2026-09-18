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
Cloudflare wildcard DNS record, installs Docker, starts a fresh CapRover
instance, configures its root domain and HTTPS, and generates a temporary
CapRover password. The generated cleanup state is stored locally in
`.e2e-provisioning-state.json` and is gitignored.

See [Provisioning design](provisioning/README.md) for the full lifecycle,
failure-recovery behavior, credential flow, and code layout.

The default provisioning configuration uses `nyc3`, `s-1vcpu-2gb`,
`ubuntu-24-04-x64`, and `caprover/caprover-edge`. These can be overridden with
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
exactly the same E2E suite, and destroys the temporary DNS record and droplet
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

## Development checks

```bash
npm run typecheck
npm run format
```

The test creates unique application names and performs best-effort cleanup for
both the original and renamed names. Cleanup warnings preserve the original test
failure.
