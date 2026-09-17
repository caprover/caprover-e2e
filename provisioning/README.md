# Provisioning code

The provisioning code is organized by responsibility:

- `commands/` contains the executable entry points used by the npm scripts.
- `environment/` owns the create, destroy, and persisted-state lifecycle.
- `infrastructure/` contains the DigitalOcean, Cloudflare, and SSH adapters.
- `caprover.ts` configures the installed CapRover instance.
- `config.ts`, `types.ts`, and `retry.ts` are shared across those layers.

The fresh-server path starts in `commands/provision.ts`, which loads the
configuration and delegates to `environment/provision.ts`. Provisioning records
each resource in `environment/state.ts` before continuing, allowing
`commands/destroy.ts` and `environment/destroy.ts` to recover and remove partial
infrastructure after a failure.
