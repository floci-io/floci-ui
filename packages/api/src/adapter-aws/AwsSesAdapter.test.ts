import {describe, expect, test} from 'bun:test'
import {AwsSesAdapter} from './AwsSesAdapter'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'content-type': 'application/json'},
    })
}

describe('AwsSesAdapter', () => {
    test('maps captured Floci emails to normalized mailbox resources', async () => {
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({
            messages: [{
                Id: 'message-1',
                Region: 'us-east-1',
                Source: 'sender@example.test',
                Destination: {ToAddresses: ['recipient@example.test'], CcAddresses: ['copy@example.test']},
                ReplyToAddresses: ['reply@example.test'],
                Subject: 'Welcome',
                Body: {text_part: 'Hello', html_part: '<strong>Hello</strong>'},
                Timestamp: '2026-08-30T12:00:00.000Z',
            }],
        }))

        const resources = await adapter.list()

        expect(resources).toEqual([expect.objectContaining({
            id: 'message-1',
            name: 'Welcome',
            cloud: 'aws',
            service: 'email',
            type: 'email',
            region: 'us-east-1',
            createdAt: '2026-08-30T12:00:00.000Z',
            status: 'captured',
            metadata: expect.objectContaining({
                source: 'sender@example.test',
                toAddresses: ['recipient@example.test'],
                ccAddresses: ['copy@example.test'],
                replyToAddresses: ['reply@example.test'],
                textBody: 'Hello',
                htmlBody: '<strong>Hello</strong>',
                messageType: 'simple',
            }),
        })])
    })

    test('filters messages by subject, sender, and recipients', async () => {
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({
            messages: [
                {Id: 'welcome', Source: 'sender@example.test', Destination: {ToAddresses: ['a@example.test']}, Subject: 'Welcome'},
                {Id: 'invoice', Source: 'billing@example.test', Destination: {ToAddresses: ['customer@example.test']}, Subject: 'Invoice'},
            ],
        }))

        await expect(adapter.list({search: 'CUSTOMER'})).resolves.toMatchObject([{id: 'invoice'}])
        await expect(adapter.list({search: 'sender'})).resolves.toMatchObject([{id: 'welcome'}])
    })

    test('gets one message through Floci inspection filtering', async () => {
        let requestedUrl = ''
        const adapter = new AwsSesAdapter('http://floci.test/', async (input) => {
            requestedUrl = String(input)
            return jsonResponse({messages: [{Id: 'message with space', Subject: 'Test'}]})
        })

        const message = await adapter.get('message with space')

        expect(requestedUrl).toBe('http://floci.test/_aws/ses?id=message%20with%20space')
        expect(message).toMatchObject({id: 'message with space', name: 'Test'})
    })

    test('clears the captured inbox through the Floci inspection endpoint', async () => {
        let requestedUrl = ''
        let method = ''
        const adapter = new AwsSesAdapter('http://floci.test', async (input, init) => {
            requestedUrl = String(input)
            method = init?.method ?? ''
            return new Response(null, {status: 200})
        })

        await adapter.clearEmailInbox()

        expect(requestedUrl).toBe('http://floci.test/_aws/ses')
        expect(method).toBe('DELETE')
    })

    test('returns the SES mailbox schema', () => {
        const adapter = new AwsSesAdapter()

        expect(adapter.schema()).toMatchObject({
            cloud: 'aws',
            service: 'email',
            displayName: 'SES Mailbox',
            actions: ['list', 'inspect'],
        })
    })
})
