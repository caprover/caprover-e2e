// Temporary mitigation for CapRover API socket resets during NGINX reloads.
// Set this to 0 to disable the mitigation and reproduce the underlying race.
export const CAPROVER_API_MIN_INTERVAL_MS = 1_000
