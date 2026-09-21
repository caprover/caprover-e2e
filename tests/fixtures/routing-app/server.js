const { createHash } = require('node:crypto')
const { createServer } = require('node:http')

const marker = 'caprover-routing-fixture'
const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end(marker)
})

server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key']
    if (!key) {
        socket.destroy()
        return
    }

    const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64')
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )

    socket.on('data', (frame) => {
        const opcode = frame[0] & 0x0f
        if (opcode === 0x8) {
            socket.end(Buffer.from([0x88, 0x00]))
            return
        }
        if (opcode !== 0x1 || frame.length < 6) {
            socket.destroy()
            return
        }

        const length = frame[1] & 0x7f
        if (length >= 126 || frame.length < 6 + length) {
            socket.destroy()
            return
        }
        const mask = frame.subarray(2, 6)
        const payload = Buffer.from(frame.subarray(6, 6 + length))
        for (let index = 0; index < payload.length; index += 1) {
            payload[index] ^= mask[index % 4]
        }
        socket.write(Buffer.concat([Buffer.from([0x81, length]), payload]))
    })
})

server.listen(8080, '0.0.0.0')
