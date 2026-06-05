import {Hono} from 'hono'
import {
    DeleteFunctionCommand,
    GetFunctionCommand,
    InvokeCommand,
    ListFunctionsCommand,
} from '@aws-sdk/client-lambda'
import {lambda} from '../aws'

const app = new Hono()

app.get('/functions', async (c) => {
    const res = await lambda.send(new ListFunctionsCommand({}))
    return c.json((res.Functions ?? []).map(fn => ({
        name: fn.FunctionName ?? '',
        arn: fn.FunctionArn,
        runtime: fn.Runtime,
        handler: fn.Handler,
        state: fn.State,
        lastModified: fn.LastModified,
        memorySize: fn.MemorySize,
        timeout: fn.Timeout,
        codeSize: fn.CodeSize,
        packageType: fn.PackageType,
        description: fn.Description,
    })))
})

app.get('/functions/:name', async (c) => {
    const name = c.req.param('name')
    const res = await lambda.send(new GetFunctionCommand({FunctionName: name}))
    const config = res.Configuration

    return c.json({
        name: config?.FunctionName ?? name,
        functionArn: config?.FunctionArn,
        runtime: config?.Runtime,
        handler: config?.Handler,
        state: config?.State,
        stateReason: config?.StateReason,
        lastModified: config?.LastModified,
        memorySize: config?.MemorySize,
        timeout: config?.Timeout,
        codeSize: config?.CodeSize,
        packageType: config?.PackageType,
        description: config?.Description,
        architectures: config?.Architectures,
        role: config?.Role,
        environment: config?.Environment?.Variables,
    })
})

app.post('/functions/:name/invoke', async (c) => {
    const name = c.req.param('name')
    const startedAt = performance.now()
    const body = await c.req.json().catch(() => ({})) as {payload?: string}

    const payloadText = body.payload?.trim() ? body.payload : '{}'

    const res = await lambda.send(new InvokeCommand({
        FunctionName: name,
        Payload: new TextEncoder().encode(payloadText),
        LogType: 'Tail',
    }))

    const payload = res.Payload
        ? new TextDecoder().decode(res.Payload)
        : ''

    const logResult = res.LogResult
        ? Buffer.from(res.LogResult, 'base64').toString('utf-8')
        : undefined

    return c.json({
        statusCode: res.StatusCode ?? 200,
        payload,
        functionError: res.FunctionError,
        logResult,
        executionDuration: Math.round(performance.now() - startedAt),
    })
})

app.delete('/functions/:name', async (c) => {
    const name = c.req.param('name')
    await lambda.send(new DeleteFunctionCommand({FunctionName: name}))
    return c.body(null, 204)
})

export default app