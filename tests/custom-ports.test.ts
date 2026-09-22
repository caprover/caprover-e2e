import dgram from 'node:dgram'
import net from 'node:net'
import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'
import {
    nextVersion,
    waitForDeployment,
    waitForServiceStable,
} from '../src/helpers/deployment'
import { allocateCustomPorts, createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { customPortsSourceArchive } from '../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { PublishedPort } from '../src/inspectors/docker'
import { requireEphemeral } from '../src/test-selection'

const TCP_CONTAINER_PORT = 7000
const UDP_CONTAINER_PORT = 7001
const SOCKET_TIMEOUT_MS = 3_000

test('custom TCP and UDP port mappings persist, route traffic, and are removed', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const { initialAppName: name, runId } = createTestNames()
        const allocated = allocateCustomPorts(runId)
        const config = loadConfig()
        const initialMappings = [
            {
                containerPort: TCP_CONTAINER_PORT,
                hostPort: allocated.tcpIngress,
                protocol: 'tcp' as const,
                publishMode: 'ingress' as const,
            },
            {
                containerPort: UDP_CONTAINER_PORT,
                hostPort: allocated.udpIngress,
                protocol: 'udp' as const,
                publishMode: 'ingress' as const,
            },
            {
                containerPort: TCP_CONTAINER_PORT,
                hostPort: allocated.tcpHost,
                protocol: 'tcp' as const,
                publishMode: 'host' as const,
            },
        ]
        const replacement = {
            containerPort: TCP_CONTAINER_PORT,
            hostPort: allocated.replacementTcpIngress,
            protocol: 'tcp' as const,
            publishMode: 'ingress' as const,
        }

        cleanUpApp(context, cleanup, name)
        await context.caprover.createApp(name)
        const version = nextVersion(await context.caprover.getApp(name))
        await context.caprover.uploadSource(
            name,
            await customPortsSourceArchive(),
            false
        )
        await waitForDeployment(context, name, version)
        await waitForServiceStable(context, name)

        await context.caprover.updateApp(name, { ports: initialMappings })
        await expectMappings(context, name, initialMappings)
        await waitForServiceStable(context, name)

        await tcpEcho(
            config.sshHost,
            allocated.tcpIngress,
            `tcp-ingress-${runId}`
        )
        await udpEcho(
            config.sshHost,
            allocated.udpIngress,
            `udp-ingress-${runId}`
        )
        await tcpEcho(config.sshHost, allocated.tcpHost, `tcp-host-${runId}`)

        await context.caprover.updateApp(name, { ports: [replacement] })
        await expectMappings(context, name, [replacement])
        await waitForServiceStable(context, name)
        await tcpEcho(
            config.sshHost,
            allocated.replacementTcpIngress,
            `tcp-replacement-${runId}`
        )
        await eventually(
            async () => {
                await expectTcpUnavailable(
                    config.sshHost,
                    allocated.tcpIngress,
                    `removed-tcp-ingress-${runId}`
                )
                await expectTcpUnavailable(
                    config.sshHost,
                    allocated.tcpHost,
                    `removed-tcp-host-${runId}`
                )
            },
            { description: 'removed TCP mappings to stop accepting traffic' }
        )
        await eventually(
            async () => {
                expect(
                    await context.docker.getServicePublishedPorts(name)
                ).not.toContainEqual(normalizePort(initialMappings[1]))
                await expectUdpUnavailable(
                    config.sshHost,
                    allocated.udpIngress,
                    `removed-udp-${runId}`
                )
            },
            { description: 'removed UDP mapping to disappear and stop echoing' }
        )

        await context.caprover.updateApp(name, { ports: [] })
        await expectMappings(context, name, [])
        await eventually(
            () =>
                expectTcpUnavailable(
                    config.sshHost,
                    allocated.replacementTcpIngress,
                    `removed-replacement-${runId}`
                ),
            {
                description:
                    'cleared replacement TCP mapping to stop accepting traffic',
            }
        )

        for (const invalid of [
            { containerPort: TCP_CONTAINER_PORT, protocol: 'tcp' },
            { hostPort: allocated.tcpIngress, protocol: 'tcp' },
            {
                containerPort: TCP_CONTAINER_PORT,
                hostPort: 0,
                protocol: 'tcp',
            },
            {
                containerPort: TCP_CONTAINER_PORT,
                hostPort: 65_536,
                protocol: 'tcp',
            },
        ]) {
            await expect(
                context.caprover.updateApp(name, {
                    ports: [invalid] as never,
                })
            ).rejects.toMatchObject({ captainStatus: 1000 })
            expect((await context.caprover.getApp(name)).ports).toEqual([])
        }
    })
})

async function expectMappings(
    context: import('../src/context').TestContext,
    name: string,
    mappings: Array<{
        containerPort: number
        hostPort: number
        protocol: 'tcp' | 'udp'
        publishMode: 'ingress' | 'host'
    }>
): Promise<void> {
    const expected = mappings.map(normalizePort)
    await eventually(
        async () => {
            expect((await context.caprover.getApp(name)).ports).toEqual(
                mappings
            )
            expect(await context.docker.getServicePublishedPorts(name)).toEqual(
                expect.arrayContaining(expected)
            )
            expect(
                (await context.docker.getServicePublishedPorts(name)).length
            ).toBe(expected.length)
        },
        { description: `${name} custom port mappings` }
    )
}

function normalizePort(mapping: {
    containerPort: number
    hostPort: number
    protocol: 'tcp' | 'udp'
    publishMode: 'ingress' | 'host'
}): PublishedPort {
    return {
        targetPort: mapping.containerPort,
        publishedPort: mapping.hostPort,
        protocol: mapping.protocol,
        publishMode: mapping.publishMode,
    }
}

function tcpEcho(host: string, port: number, marker: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port })
        const expected = Buffer.from(marker)
        let received = Buffer.alloc(0)
        let settled = false
        const timeout = setTimeout(
            () => finish(new Error('TCP echo timed out')),
            SOCKET_TIMEOUT_MS
        )

        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            socket.destroy()
            if (error) reject(error)
            else resolve()
        }

        socket.once('connect', () => socket.write(marker))
        socket.on('data', (data) => {
            if (received.length + data.length > expected.length) {
                finish(
                    new Error(
                        `TCP echo returned an unexpected payload on port ${port}`
                    )
                )
                return
            }
            received = Buffer.concat([received, data])
            if (received.length < expected.length) return
            if (!received.equals(expected)) {
                finish(
                    new Error(
                        `TCP echo returned an unexpected payload on port ${port}`
                    )
                )
                return
            }
            finish()
        })
        socket.once('error', finish)
        socket.once('close', () => {
            if (!settled)
                finish(
                    new Error(
                        `TCP connection closed before echo on port ${port}`
                    )
                )
        })
    })
}

function udpEcho(host: string, port: number, marker: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4')
        let settled = false
        const timeout = setTimeout(
            () => finish(new Error('UDP echo timed out')),
            SOCKET_TIMEOUT_MS
        )

        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            socket.close()
            if (error) reject(error)
            else resolve()
        }

        socket.once('message', (message) => {
            if (message.toString() !== marker) {
                finish(
                    new Error(
                        `UDP echo returned an unexpected payload on port ${port}`
                    )
                )
                return
            }
            finish()
        })
        socket.once('error', finish)
        socket.send(marker, port, host, (error) => {
            if (error) finish(error)
        })
    })
}

async function expectTcpUnavailable(
    host: string,
    port: number,
    marker: string
): Promise<void> {
    await expect(tcpEcho(host, port, marker)).rejects.toThrow()
}

async function expectUdpUnavailable(
    host: string,
    port: number,
    marker: string
): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
            udpEcho(host, port, `${marker}-${attempt}`)
        ).rejects.toThrow()
    }
}
