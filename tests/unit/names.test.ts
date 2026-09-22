import { expect, test } from 'vitest'
import { allocateCustomPorts, CUSTOM_PORT_RANGE } from '../../src/helpers/names'

test('custom port allocation is stable, unique, and stays in the reserved range', () => {
    const first = allocateCustomPorts('20260921-abcdef')
    const second = allocateCustomPorts('20260921-abcdef')
    const ports = Object.values(first)

    expect(second).toEqual(first)
    expect(new Set(ports).size).toBe(ports.length)
    expect(ports.every((port) => port >= CUSTOM_PORT_RANGE.start)).toBe(true)
    expect(ports.every((port) => port <= CUSTOM_PORT_RANGE.end)).toBe(true)
})
