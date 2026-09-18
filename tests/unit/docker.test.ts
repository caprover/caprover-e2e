import { describe, expect, test } from 'vitest'
import { SshClient } from '../../src/clients/ssh'
import { DockerInspector } from '../../src/inspectors/docker'

const docker = new DockerInspector({} as SshClient)

describe('DockerInspector.imageMatches', () => {
    test('matches an exact image tag', () => {
        expect(
            docker.imageMatches('nginx:1.29.8-alpine', 'nginx:1.29.8-alpine')
        ).toBe(true)
    })

    test('matches Docker digest resolution for the expected tag', () => {
        expect(
            docker.imageMatches(
                'nginx:1.29.8-alpine@sha256:abc123',
                'nginx:1.29.8-alpine'
            )
        ).toBe(true)
    })

    test('rejects another image version', () => {
        expect(
            docker.imageMatches('nginx:1.28.3-alpine', 'nginx:1.29.8-alpine')
        ).toBe(false)
    })
})
