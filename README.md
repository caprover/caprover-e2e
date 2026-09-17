# CapRover E2E

External end-to-end tests for a fully provisioned, disposable CapRover server.

The suite validates each lifecycle change from three independent perspectives:

- CapRover API state through the published `caprover-api` package
- Docker Swarm state over SSH
- Publicly observable HTTP behavior

Provisioning is outside this repository's current scope.

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
- A disposable CapRover installation with a configured root domain
- Public wildcard DNS for application subdomains
- Ports 80 and 443 reachable from the test runner
- SSH access to the Docker Swarm manager
- Docker access for the configured SSH user

The CapRover URL must use HTTPS and be the dashboard origin, for example:

```text
https://captain.example.com
```

Do not include `/api/v2`, a trailing path, query parameters, or a fragment.

## Local execution

Install dependencies:

```bash
npm ci
```

Run the suite:

```bash
CAPROVER_URL=https://captain.example.com \
CAPROVER_PASSWORD='password' \
SSH_PORT=22 \
SSH_USER=root \
SSH_PRIVATE_KEY="$(< ~/.ssh/caprover-e2e)" \
npm test
```

The SSH host defaults to the hostname from `CAPROVER_URL`. Set `SSH_HOST`
explicitly only when SSH is exposed through a different hostname or IP address.
`SSH_PORT` is optional and defaults to `22`.

The test output never prints the CapRover password or SSH private key. Failure
diagnostics include sanitized CapRover state, Docker service state, task state,
and a bounded tail of logs from the generated test application.

## GitHub Actions

The workflow runs manually through **Actions → CapRover E2E → Run workflow**.

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

## Development checks

```bash
npm run typecheck
npm run format
```

The test creates unique application names and performs best-effort cleanup for
both the original and renamed names. Cleanup warnings preserve the original test
failure.
