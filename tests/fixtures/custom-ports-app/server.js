const dgram = require('node:dgram')
const net = require('node:net')

const tcpServer = net.createServer((socket) => socket.pipe(socket))
tcpServer.listen(7000, '0.0.0.0')

const udpServer = dgram.createSocket('udp4')
udpServer.on('message', (message, remote) => {
    udpServer.send(message, remote.port, remote.address)
})
udpServer.bind(7001, '0.0.0.0')
