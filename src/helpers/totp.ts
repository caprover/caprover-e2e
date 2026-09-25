import { createHmac } from 'node:crypto'

// CapRover Pro issues 6-digit SHA1 TOTP codes with a 30-second period.
export function totpFromUri(otpUri: string, now = Date.now()): string {
    let uri: URL
    try {
        uri = new URL(otpUri)
    } catch {
        // URL's default error can include the URI, which contains the secret.
        throw new Error('Pro returned an invalid TOTP URI')
    }
    if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp') {
        throw new Error('Pro returned an invalid TOTP URI')
    }
    if (
        (uri.searchParams.get('algorithm') ?? 'SHA1').toUpperCase() !==
            'SHA1' ||
        (uri.searchParams.get('digits') ?? '6') !== '6' ||
        (uri.searchParams.get('period') ?? '30') !== '30'
    ) {
        throw new Error('Pro returned unsupported TOTP parameters')
    }

    const encodedSecret = uri.searchParams.get('secret')?.toUpperCase()
    if (!encodedSecret || !/^[A-Z2-7]+=*$/.test(encodedSecret)) {
        throw new Error('Pro returned an invalid TOTP secret')
    }
    // Node does not provide a base32 decoder; decode the otpauth secret here.
    let bits = 0
    let value = 0
    const bytes: number[] = []
    for (const character of encodedSecret.replace(/=+$/, '')) {
        value =
            (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character)
        bits += 5
        if (bits >= 8) {
            bits -= 8
            bytes.push((value >>> bits) & 0xff)
        }
    }
    if (bytes.length < 10) {
        throw new Error('Pro returned an invalid TOTP secret')
    }

    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
    const digest = createHmac('sha1', Buffer.from(bytes))
        .update(counter)
        .digest()
    const offset = digest[digest.length - 1] & 0x0f
    const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
    return number.toString().padStart(6, '0')
}
