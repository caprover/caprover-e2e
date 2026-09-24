import { createServer, connect } from 'node:net'
import { once } from 'node:events'
import { expect, test } from 'vitest'
import { SshClient } from '../../src/clients/ssh'

test('local forwarding sends HTTP to the SSH destination and closes cleanly', async () => {
    const destination = createServer((socket) => {
        socket.once('data', () => {
            socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')
        })
    })
    destination.listen(0, '127.0.0.1')
    await once(destination, 'listening')
    const address = destination.address()
    if (!address || typeof address === 'string') throw new Error('No port')

    const ssh = new SshClient({
        host: 'example.test',
        port: 22,
        username: 'root',
        privateKey: 'unused',
    })
    const internal = ssh as unknown as {
        connected: boolean
        client: {
            forwardOut: (
                srcHost: string,
                srcPort: number,
                destHost: string,
                destPort: number,
                callback: (
                    error: Error | undefined,
                    socket?: ReturnType<typeof connect>
                ) => void
            ) => void
        }
    }
    internal.connected = true
    internal.client.forwardOut = (
        _srcHost,
        _srcPort,
        destHost,
        destPort,
        callback
    ) => {
        expect(destHost).toBe('127.0.0.1')
        expect(destPort).toBe(address.port)
        callback(undefined, connect(destPort, destHost))
    }

    try {
        const tunnel = await ssh.forwardLocalPort(address.port)
        try {
            expect(new URL(tunnel.url).hostname).toBe('127.0.0.1')
            expect(await (await fetch(tunnel.url)).text()).toBe('ok')
        } finally {
            await tunnel.close()
        }
    } finally {
        internal.connected = false
        destination.close()
    }
})
