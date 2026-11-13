import {beforeEach, describe, expect, test} from 'vitest'
import {getRegion, getRegionRecents, isRegion, setRegion} from './regionStore'

describe('regionStore', () => {
    beforeEach(() => {
        setRegion(null)
    })

    test('starts on the console default (no region selected)', () => {
        expect(getRegion()).toBeNull()
    })

    test('switches region, remembers it, and keeps recents most-recent first', () => {
        expect(setRegion('eu-central-1')).toBe(true)
        expect(setRegion('us-west-2')).toBe(true)
        expect(setRegion('eu-central-1')).toBe(true)

        expect(getRegion()).toBe('eu-central-1')
        expect(getRegionRecents().slice(0, 2)).toEqual(['eu-central-1', 'us-west-2'])
        expect(localStorage.getItem('floci.region')).toBe('eu-central-1')
    })

    test('null returns to the default and keeps the recents', () => {
        setRegion('ap-south-1')
        setRegion(null)

        expect(getRegion()).toBeNull()
        expect(getRegionRecents()).toContain('ap-south-1')
        expect(localStorage.getItem('floci.region')).toBeNull()
    })

    test('refuses names that are not regions', () => {
        setRegion('eu-west-1')

        for (const value of ['', 'eu-west', 'EU-WEST-1', 'eu-west-1a', 'x']) {
            expect(isRegion(value)).toBe(false)
            expect(setRegion(value)).toBe(false)
        }
        expect(getRegion()).toBe('eu-west-1')
    })

    test('keeps the snapshot reference when nothing changes', () => {
        setRegion('us-east-2')
        const before = getRegionRecents()

        setRegion('us-east-2')

        expect(getRegionRecents()).toBe(before)
    })
})
