import { expect, test } from 'vitest'
import { addNginxResponseHeader } from '../../src/helpers/nginx'

test('adds a response header inside the final server block', () => {
    expect(
        addNginxResponseHeader(
            'server {\n    location / {}\n}\n',
            'X-Caprover-E2e',
            'marker-123'
        )
    ).toBe(
        'server {\n    location / {}\n    add_header X-Caprover-E2e "marker-123" always;\n}\n'
    )
})

test('rejects values that could inject Nginx syntax', () => {
    expect(() =>
        addNginxResponseHeader('server {}', 'X-Test', 'value; return 500')
    ).toThrow('Unsafe Nginx response header value')
})
