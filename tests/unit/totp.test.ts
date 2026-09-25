import { expect, test } from 'vitest'
import { totpFromUri } from '../../src/helpers/totp'

test('generates the RFC 6238 SHA1 value as a six-digit Pro code', () => {
    const uri =
        'otpauth://totp/CapRover:captain.example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=CapRover'
    expect(totpFromUri(uri, 59_000)).toBe('287082')
})

test.each([
    'invalid-uri',
    'otpauth://hotp/CapRover?secret=JBSWY3DPEHPK3PXP',
    'otpauth://totp/CapRover?secret=invalid!',
    'otpauth://totp/CapRover?secret=JBSWY3DPEHPK3PXP&period=60',
])('rejects an unsupported or invalid Pro OTP URI', (uri) => {
    expect(() => totpFromUri(uri)).toThrow()
})
