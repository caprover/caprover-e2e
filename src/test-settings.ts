// Temporary mitigation for CapRover API socket resets during NGINX reloads.
// Set CAPROVER_E2E_DISABLE_API_STABILITY_MITIGATION=true to reproduce the race.
export const ENABLE_CAPROVER_API_STABILITY_MITIGATION =
    process.env.CAPROVER_E2E_DISABLE_API_STABILITY_MITIGATION !== 'true'
export const CAPROVER_API_MIN_INTERVAL_MS = 1_000
