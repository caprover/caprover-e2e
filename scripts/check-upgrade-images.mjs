import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const release = process.env.E2E_UPGRADE_RELEASE_TAG
const from = process.env.E2E_UPGRADE_EDGE_FROM_SHA
const to = process.env.E2E_UPGRADE_EDGE_TO_SHA

if (!/^\d+\.\d+\.\d+$/.test(release ?? '')) {
    throw new Error('E2E_UPGRADE_RELEASE_TAG must be a pinned release version')
}
if (!/^[a-f0-9]{40}$/.test(from ?? '') || !/^[a-f0-9]{40}$/.test(to ?? '')) {
    throw new Error('Edge upgrades require two complete commit SHA tags')
}
if (from === to) throw new Error('Edge source and target must differ')

function inspectDigest(image) {
    const output = execFileSync(
        'docker',
        ['buildx', 'imagetools', 'inspect', image],
        {
            encoding: 'utf8',
            timeout: 60_000,
            stdio: ['ignore', 'pipe', 'inherit'],
        }
    )
    const digest = /^Digest:\s+(sha256:[a-f0-9]{64})$/m.exec(output)?.[1]
    if (
        !digest ||
        !/^\s+Platform:\s+linux\/amd64(?:\/[^\s]+)?\s*$/m.test(output)
    ) {
        throw new Error(`Missing digest or linux/amd64 manifest for ${image}`)
    }
    return digest
}

const releaseImage = `caprover/caprover:${release}`
const fromImage = `caprover/caprover-edge:${from}`
const toImage = `caprover/caprover-edge:${to}`
const releaseDigest = inspectDigest(releaseImage)
const fromDigest = inspectDigest(fromImage)
const toDigest = inspectDigest(toImage)
if (fromDigest === toDigest) {
    throw new Error('Edge source and target resolve to the same image digest')
}

console.log(`Release: ${releaseImage}@${releaseDigest}`)
console.log(`Edge source: ${fromImage}@${fromDigest}`)
console.log(`Edge target: ${toImage}@${toDigest}`)

if (process.env.GITHUB_ENV) {
    appendFileSync(
        process.env.GITHUB_ENV,
        [
            `CAPROVER_IMAGE=${releaseImage}@${releaseDigest}`,
            `E2E_UPGRADE_RELEASE_DIGEST=${releaseDigest}`,
            `E2E_UPGRADE_EDGE_FROM_DIGEST=${fromDigest}`,
            `E2E_UPGRADE_EDGE_TO_DIGEST=${toDigest}`,
            '',
        ].join('\n')
    )
}
