import {describe, expect, test} from 'bun:test'
import {mapWithLimit} from './concurrency'

describe('mapWithLimit', () => {
    test('keeps the input order and never exceeds the limit', async () => {
        let inFlight = 0
        let peak = 0
        const result = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise((resolve) => setTimeout(resolve, 5 * (8 - n)))
            inFlight--
            return n * 2
        })
        expect(result).toEqual([2, 4, 6, 8, 10, 12, 14])
        expect(peak).toBe(3)
    })

    test('returns an empty list for no items', async () => {
        expect(await mapWithLimit([], 4, async (n: number) => n)).toEqual([])
    })

    test('rejects when any call fails', async () => {
        await expect(
            mapWithLimit([1, 2, 3], 2, async (n) => {
                if (n === 2) throw new Error('boom')
                return n
            }),
        ).rejects.toThrow('boom')
    })
})
