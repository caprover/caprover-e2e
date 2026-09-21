export function addNginxResponseHeader(
    template: string,
    headerName: string,
    headerValue: string
): string {
    if (!/^[A-Za-z0-9-]+$/.test(headerName)) {
        throw new Error('Unsafe Nginx response header name')
    }
    if (!/^[A-Za-z0-9-]+$/.test(headerValue)) {
        throw new Error('Unsafe Nginx response header value')
    }

    const closingBrace = template.trimEnd().lastIndexOf('}')
    if (closingBrace < 0) {
        throw new Error('Default app Nginx template has no server-block close')
    }

    return `${template.slice(0, closingBrace)}    add_header ${headerName} "${headerValue}" always;\n${template.slice(closingBrace)}`
}
