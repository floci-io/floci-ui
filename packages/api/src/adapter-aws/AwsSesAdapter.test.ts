import {describe, expect, test} from 'bun:test'
import {AwsSesAdapter} from './AwsSesAdapter'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'content-type': 'application/json'},
    })
}

describe('AwsSesAdapter', () => {
    test('reads headers and a plain text body from SendRawEmail capture data', async () => {
        const raw = Buffer.from([
            'From: Sender <sender@example.test>',
            'To: Recipient <recipient@example.test>',
            'Subject: Raw SES test',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            '', 'Hello from SendRawEmail.', '',
        ].join('\r\n')).toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({
            messages: [{Id: 'raw-text', RawData: raw}],
        }))

        const message = await adapter.get('raw-text')
        if (!message) throw new Error('Expected the captured raw message')

        expect(message).toMatchObject({
            name: 'Raw SES test',
            metadata: {
                source: 'sender@example.test', toAddresses: ['recipient@example.test'],
                textBody: 'Hello from SendRawEmail.\n', htmlBody: null,
                rawData: raw, messageType: 'raw',
            },
        })
        for (const search of ['RAW SES', 'SENDER@EXAMPLE.TEST', 'RECIPIENT@EXAMPLE.TEST']) {
            expect(await adapter.list({search})).toEqual([message])
        }
    })

    test('decodes MIME encoded headers, address groups, and multipart text and HTML', async () => {
        const html = '<p>Olá, prévia do e-mail</p>'
        const raw = Buffer.from([
            'From: Sender <sender@example.test>',
            'To: Team: Recipient <recipient@example.test>, second@example.test;',
            'Cc: copy@example.test',
            'Bcc: hidden@example.test',
            'Reply-To: reply@example.test',
            `Subject: =?UTF-8?B?${Buffer.from('Notificação de teste').toString('base64')}?=`,
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="test-boundary"',
            '', '--test-boundary',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: quoted-printable', '', 'Ol=C3=A1, texto do e-mail',
            '--test-boundary', 'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64', '', Buffer.from(html).toString('base64'),
            '--test-boundary--', '',
        ].join('\r\n')).toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({
            messages: [{Id: 'raw-multipart', RawData: raw}],
        }))

        const [message] = await adapter.list({search: 'second@example.test'})

        expect(message).toMatchObject({
            name: 'Notificação de teste',
            metadata: {
                source: 'sender@example.test',
                toAddresses: ['recipient@example.test', 'second@example.test'],
                ccAddresses: ['copy@example.test'], bccAddresses: ['hidden@example.test'],
                replyToAddresses: ['reply@example.test'],
                textBody: expect.stringContaining('Olá, texto do e-mail'), htmlBody: html,
                rawData: raw, messageType: 'raw',
            },
        })
        expect(await adapter.get('raw-multipart')).toEqual(message)
    })

    test('makes an HTML-only raw message available to the existing preview', async () => {
        const html = '<p>Hello from a raw HTML message.</p>'
        const raw = Buffer.from([
            'From: sender@example.test', 'To: recipient@example.test', 'Subject: HTML preview',
            'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html,
        ].join('\r\n')).toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({
            messages: [{Id: 'raw-html', RawData: raw}],
        }))

        expect(await adapter.get('raw-html')).toMatchObject({
            name: 'HTML preview', metadata: {htmlBody: expect.stringContaining(html), textBody: null, rawData: raw},
        })
    })

    test('prefers explicit capture fields to MIME headers and content', async () => {
        const raw = Buffer.from([
            'From: header@example.test', 'To: header-to@example.test',
            'Cc: header-cc@example.test', 'Bcc: header-bcc@example.test',
            'Reply-To: header-reply@example.test', 'Subject: Header subject',
            'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', '<p>Header body</p>',
        ].join('\r\n')).toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({messages: [{
            Id: 'explicit-fields', Source: 'envelope@example.test', Subject: 'Explicit subject',
            Destination: {ToAddresses: ['actual@example.test'], CcAddresses: [], BccAddresses: []},
            ReplyToAddresses: [], Body: {text_part: 'Explicit body', html_part: ''}, RawData: raw,
        }]}))

        expect(await adapter.get('explicit-fields')).toMatchObject({
            name: 'Explicit subject',
            metadata: {
                source: 'envelope@example.test', toAddresses: ['actual@example.test'],
                ccAddresses: [], bccAddresses: [], replyToAddresses: [],
                textBody: 'Explicit body', htmlBody: '', rawData: raw,
            },
        })
    })

    test.each(['', ' \t '])('preserves an explicit blank subject %j instead of the MIME subject', async (subject) => {
        const raw = Buffer.from([
            'From: sender@example.test', 'To: recipient@example.test', 'Subject: MIME subject',
            'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', 'Raw body',
        ].join('\r\n')).toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({messages: [{
            Id: 'explicit-blank-subject', Subject: subject, RawData: raw,
        }]}))

        const message = await adapter.get('explicit-blank-subject')
        if (!message) throw new Error('Expected the captured raw message')

        expect(message).toMatchObject({name: '(no subject)', metadata: {rawData: raw}})
        expect(await adapter.list()).toEqual([message])
        expect(await adapter.list({search: 'MIME subject'})).toEqual([])
    })

    test('keeps raw data inspectable and the rest of the mailbox available after a parser rejection', async () => {
        const oversized = Buffer.from('Subject: ' + 'x'.repeat(129 * 1024) + '\r\n\r\nBody').toString('base64')
        const valid = Buffer.from('Subject: Still visible\r\n\r\nValid body').toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => jsonResponse({messages: [
            {Id: 'oversized', RawData: oversized}, {Id: 'valid', RawData: valid},
        ]}))

        const resources = await adapter.list()

        expect(resources).toHaveLength(2)
        expect(resources[0]).toMatchObject({
            id: 'oversized', name: '(no subject)', metadata: {rawData: oversized, htmlBody: null, textBody: null},
        })
        expect(resources[1]).toMatchObject({id: 'valid', name: 'Still visible'})
        expect(await adapter.get('oversized')).toEqual(resources[0])
    })

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

    test('count returns inbox size and falls back to list for search', async () => {
        let calls = 0
        const adapter = new AwsSesAdapter('http://floci.test', async () => {
            calls++
            return jsonResponse({messages: [{Id: '1', Subject: 'Alpha'}, {Id: '2', Subject: 'Beta'}]})
        })

        await expect(adapter.count()).resolves.toBe(2)
        expect(calls).toBe(1)

        await expect(adapter.count({search: 'Alpha'})).resolves.toBe(1)
        expect(calls).toBe(2)
    })
})
