const { createServer } = require('node:http')
const data = require('./repository-data.json')

const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://repository.local')
    if (request.method !== 'GET') {
        response.writeHead(405)
        response.end()
        return
    }

    if (url.pathname === '/v4/list') {
        sendJson(response, 200, data.list)
        return
    }

    const prefix = '/v4/apps/'
    if (url.pathname.startsWith(prefix)) {
        let templateName
        try {
            templateName = decodeURIComponent(url.pathname.slice(prefix.length))
        } catch {
            sendJson(response, 400, { error: 'invalid template path' })
            return
        }
        const template = data.templates[templateName]
        if (template) {
            sendJson(response, 200, template)
            return
        }
    }

    sendJson(response, 404, { error: 'template not found' })
})

server.listen(8080, '0.0.0.0')

function sendJson(response, status, value) {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
}
