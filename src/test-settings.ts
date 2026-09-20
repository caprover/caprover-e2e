// Temporary mitigation for CapRover API socket resets during NGINX reloads.
// Set this to false to bypass the mitigation and reproduce the underlying race.
export const ENABLE_CAPROVER_API_STABILITY_MITIGATION = true
export const CAPROVER_API_MIN_INTERVAL_MS = 1_000
