import {expandJsonStrings, formatDuration, isExpressExecution, summarizeDetails} from '@/lib/workflowHistory'

describe('formatDuration', () => {
    it('reports a missing duration as still running rather than as a number', () => {
        expect(formatDuration(undefined)).toBe('in progress')
        expect(formatDuration(Number.NaN)).toBe('in progress')
        expect(formatDuration(-1)).toBe('in progress')
    })

    it('picks the unit by magnitude', () => {
        expect(formatDuration(250)).toBe('250 ms')
        expect(formatDuration(2500)).toBe('2.5 s')
        expect(formatDuration(125_000)).toBe('2m 5s')
    })

    it('carries a rounded seconds remainder into the minutes', () => {
        expect(formatDuration(119_500)).toBe('2m 0s')
        expect(formatDuration(119_499)).toBe('1m 59s')
        expect(formatDuration(59_999)).toBe('1m 0s')
        expect(formatDuration(59_449)).toBe('59.4 s')
    })
})

describe('isExpressExecution', () => {
    it('tells Express execution ARNs from Standard ones', () => {
        expect(isExpressExecution('arn:aws:states:us-east-1:000000000000:express:orders:run-1:0f1e2d3c')).toBe(true)
        expect(isExpressExecution('arn:aws:states:us-east-1:000000000000:execution:orders:run-1')).toBe(false)
        expect(isExpressExecution('not-an-arn')).toBe(false)
    })
})

describe('summarizeDetails', () => {
    it('shows the state name for state events', () => {
        expect(summarizeDetails({name: 'Done', input: '{}'})).toBe('Done')
    })

    it('shows the task resource for task events', () => {
        expect(summarizeDetails({resourceType: 'lambda', resource: 'invoke'})).toBe('lambda:invoke')
        expect(summarizeDetails({resourceType: 'lambda'})).toBe('lambda')
    })

    it('shows the error and cause for failure events', () => {
        expect(summarizeDetails({error: 'States.Timeout', cause: 'Took too long'})).toBe('States.Timeout: Took too long')
        expect(summarizeDetails({error: 'States.Timeout', cause: ''})).toBe('States.Timeout')
    })

    it('falls back to a dash when nothing is recognisable', () => {
        expect(summarizeDetails({})).toBe('-')
        expect(summarizeDetails({roleArn: 'arn:aws:iam::000000000000:role/sfn'})).toBe('-')
    })
})

describe('expandJsonStrings', () => {
    it('parses JSON-encoded input and output so the viewer can show them nested', () => {
        expect(expandJsonStrings({input: '{"orderId":"42"}', output: '[1,2]'})).toEqual({
            input: {orderId: '42'},
            output: [1, 2],
        })
    })

    it('leaves plain strings and non-strings alone', () => {
        expect(expandJsonStrings({name: 'Done', cause: 'not json {', inputDetails: {truncated: false}})).toEqual({
            name: 'Done',
            cause: 'not json {',
            inputDetails: {truncated: false},
        })
    })
})
