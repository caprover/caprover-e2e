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

function inspectImage(image) {
    const output = execFileSync(
        'docker',
        ['buildx', 'imagetools', 'inspect', image],
        {
            encoding: 'utf8',
            timeout: 60_000,
            stdio: ['ignore', 'pipe', 'inherit'],
        }
    )
    const indexDigest = /^Digest:\s+(sha256:[a-f0-9]{64})$/m.exec(output)?.[1]
    if (!indexDigest) {
        throw new Error(`Missing registry digest for ${image}`)
    }

    const raw = execFileSync(
        'docker',
        ['buildx', 'imagetools', 'inspect', '--raw', image],
        {
            encoding: 'utf8',
            timeout: 60_000,
            stdio: ['ignore', 'pipe', 'inherit'],
        }
    )
    let manifest
    try {
        manifest = JSON.parse(raw)
    } catch {
        throw new Error(`Registry returned an invalid manifest for ${image}`)
    }
    const amd64Digest = manifest.manifests?.find(
        (entry) =>
            entry.platform?.os === 'linux' &&
            entry.platform?.architecture === 'amd64'
    )?.digest
    if (!/^sha256:[a-f0-9]{64}$/.test(amd64Digest ?? '')) {
        throw new Error(`Missing linux/amd64 manifest for ${image}`)
    }
    return { indexDigest, amd64Digest }
}

const releaseImage = `caprover/caprover:${release}`
const fromImage = `caprover/caprover-edge:${from}`
const toImage = `caprover/caprover-edge:${to}`
const releaseDetails = inspectImage(releaseImage)
const fromDetails = inspectImage(fromImage)
const toDetails = inspectImage(toImage)
if (fromDetails.amd64Digest === toDetails.amd64Digest) {
    throw new Error(
        'Edge source and target resolve to the same linux/amd64 image'
    )
}

console.log(
    `Release: ${releaseImage}@${releaseDetails.indexDigest} (linux/amd64 ${releaseDetails.amd64Digest})`
)
console.log(
    `Edge source: ${fromImage}@${fromDetails.indexDigest} (linux/amd64 ${fromDetails.amd64Digest})`
)
console.log(
    `Edge target: ${toImage}@${toDetails.indexDigest} (linux/amd64 ${toDetails.amd64Digest})`
)

if (process.env.GITHUB_ENV) {
    appendFileSync(
        process.env.GITHUB_ENV,
        [
            `CAPROVER_IMAGE=${releaseImage}@${releaseDetails.indexDigest}`,
            `E2E_UPGRADE_RELEASE_DIGEST=${releaseDetails.indexDigest}`,
            `E2E_UPGRADE_EDGE_FROM_DIGEST=${fromDetails.indexDigest}`,
            `E2E_UPGRADE_EDGE_TO_DIGEST=${toDetails.indexDigest}`,
            '',
        ].join('\n')
    )
}
