import { describe, expect, test } from 'vitest'
import { loadConfig } from '../../src/config'

const validEnvironment = {
    CAPROVER_URL: 'https://captain.example.com',
    CAPROVER_PASSWORD: 'password',
    SSH_USER: 'root',
    SSH_PRIVATE_KEY: 'line-one\\nline-two',
}

describe('loadConfig', () => {
    test('loads and normalizes valid configuration', () => {
        expect(loadConfig(validEnvironment)).toEqual({
            environment: 'persistent',
            caproverUrl: 'https://captain.example.com',
            caproverPassword: 'password',
            sshHost: 'captain.example.com',
            sshPort: 22,
            sshUser: 'root',
            sshPrivateKey: 'line-one\nline-two',
        })
    })

    test('allows overriding the SSH host', () => {
        expect(
            loadConfig({ ...validEnvironment, SSH_HOST: '192.0.2.10' }).sshHost
        ).toBe('192.0.2.10')
    })

    test('reports the missing variable without exposing other values', () => {
        expect(() => loadConfig({ ...validEnvironment, SSH_USER: '' })).toThrow(
            'Missing required environment variable: SSH_USER'
        )
    })

    test.each([
        'captain.example.com',
        'http://captain.example.com',
        'ftp://captain.example.com',
        'https://captain.example.com/api/v2',
        'https://captain.example.com?query=value',
    ])('rejects invalid CapRover URL %s', (caproverUrl) => {
        expect(() =>
            loadConfig({ ...validEnvironment, CAPROVER_URL: caproverUrl })
        ).toThrow(/CAPROVER_URL/)
    })

    test.each(['0', '65536', 'abc', '22.5'])(
        'rejects invalid SSH port %s',
        (sshPort) => {
            expect(() =>
                loadConfig({ ...validEnvironment, SSH_PORT: sshPort })
            ).toThrow('SSH_PORT must be an integer between 1 and 65535')
        }
    )
})
