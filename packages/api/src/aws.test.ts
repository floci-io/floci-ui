import {afterEach, describe, expect, test} from 'bun:test'
import {awsClientsForAccount, credentialsForAccount, defaultAccountId, defaultRegion, isRegion, resolveRegion} from './aws'

const originalKey = process.env.AWS_ACCESS_KEY_ID

afterEach(() => {
    if (originalKey === undefined) delete process.env.AWS_ACCESS_KEY_ID
    else process.env.AWS_ACCESS_KEY_ID = originalKey
})

describe('credentialsForAccount', () => {
    test('signs the default account with AWS_ACCESS_KEY_ID when it is not an account id', () => {
        process.env.AWS_ACCESS_KEY_ID = 'test'

        expect(credentialsForAccount(defaultAccountId()).accessKeyId).toBe('test')
    })

    test('keeps the account id as the key for any other account', () => {
        process.env.AWS_ACCESS_KEY_ID = 'test'

        const otherAccountId = defaultAccountId() === '123456789012' ? '210987654321' : '123456789012'

        expect(credentialsForAccount(otherAccountId).accessKeyId).toBe(otherAccountId)
    })

    test('uses the account id as the key when AWS_ACCESS_KEY_ID is an account id', () => {
        process.env.AWS_ACCESS_KEY_ID = '210987654321'

        expect(defaultAccountId()).toBe('210987654321')
        expect(credentialsForAccount('210987654321').accessKeyId).toBe('210987654321')
    })

    test('uses the account id as the key when AWS_ACCESS_KEY_ID is unset', () => {
        delete process.env.AWS_ACCESS_KEY_ID

        expect(credentialsForAccount(defaultAccountId()).accessKeyId).toBe(defaultAccountId())
    })
})

describe('regions', () => {
    const originalRegion = process.env.AWS_REGION

    afterEach(() => {
        if (originalRegion === undefined) delete process.env.AWS_REGION
        else process.env.AWS_REGION = originalRegion
    })

    test('accepts AWS region names across partitions', () => {
        for (const region of ['us-east-1', 'eu-central-1', 'ap-southeast-5', 'us-gov-west-1', 'cn-north-1', 'il-central-1']) {
            expect(isRegion(region)).toBe(true)
        }
    })

    test('rejects values that are not region names', () => {
        for (const value of ['', 'us-east', 'US-EAST-1', 'eu-central-1a', 'us_east_1', 'eu-central-1; rm', null, undefined]) {
            expect(isRegion(value)).toBe(false)
        }
    })

    test('defaults to AWS_REGION as given, then us-east-1', () => {
        process.env.AWS_REGION = 'eu-central-1'
        expect(defaultRegion()).toBe('eu-central-1')

        delete process.env.AWS_REGION
        expect(defaultRegion()).toBe('us-east-1')
    })

    test('resolveRegion keeps a valid region and falls back to the default otherwise', () => {
        process.env.AWS_REGION = 'eu-central-1'

        expect(resolveRegion('ap-south-1')).toBe('ap-south-1')
        expect(resolveRegion('not-a-region')).toBe('eu-central-1')
        expect(resolveRegion(undefined)).toBe('eu-central-1')
    })

    test('builds one client set per account and region', async () => {
        const euCentral = awsClientsForAccount('111111111111', 'eu-central-1')

        expect(awsClientsForAccount('111111111111', 'eu-central-1')).toBe(euCentral)
        expect(awsClientsForAccount('111111111111', 'us-west-2')).not.toBe(euCentral)
        expect(await euCentral.ec2.config.region()).toBe('eu-central-1')
        expect(await awsClientsForAccount('111111111111', 'us-west-2').ec2.config.region()).toBe('us-west-2')
    })
})
