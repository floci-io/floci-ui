import {Hono} from 'hono'
import {
     CreateFunctionCommand,
    DeleteFunctionCommand,
    GetFunctionCommand,
    InvokeCommand,
    ListFunctionsCommand,
    Runtime,
    UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda'
import {lambda} from '../aws'

const app = new Hono()

app.post('/functions', async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
        functionName?: string
        runtime?: Runtime
        handler?: string
        role?: string
        description?: string
        memorySize?: number
        timeout?: number
        code?: string
        environment?: Record<string, string>
    }

    if (!body.functionName?.trim()) {
        return c.json({error: 'functionName is required'}, 400)
    }

    if (!body.runtime) {
        return c.json({error: 'runtime is required'}, 400)
    }

    if (!body.handler?.trim()) {
        return c.json({error: 'handler is required'}, 400)
    }

    if (!body.role?.trim()) {
        return c.json({error: 'role is required'}, 400)
    }

    const sourceCode = body.code?.trim() || `
exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Hello from Floci Cloud Explorer",
      event
    })
  };
};
`.trim()

    const res = await lambda.send(new CreateFunctionCommand({
        FunctionName: body.functionName,
        Runtime: body.runtime,
        Handler: body.handler,
        Role: body.role,
        Description: body.description,
        MemorySize: body.memorySize ?? 128,
        Timeout: body.timeout ?? 3,
        Code: {
            ZipFile: new TextEncoder().encode(sourceCode),
        },
        Environment: body.environment
            ? {Variables: body.environment}
            : undefined,
    }))

    return c.json({
        name: res.FunctionName,
        functionArn: res.FunctionArn,
        runtime: res.Runtime,
        handler: res.Handler,
        state: res.State,
        lastModified: res.LastModified,
        memorySize: res.MemorySize,
        timeout: res.Timeout,
        description: res.Description,
        role: res.Role,
    }, 201)
})

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

app.put('/functions/:name/environment', async (c) => {
    const name = c.req.param('name')
    const body = await c.req.json().catch(() => ({})) as {
        environment?: Record<string, string>
    }

    if (!body.environment || typeof body.environment !== 'object' || Array.isArray(body.environment)) {
        return c.json({error: 'environment must be an object'}, 400)
    }

    const res = await lambda.send(new UpdateFunctionConfigurationCommand({
        FunctionName: name,
        Environment: {
            Variables: body.environment,
        },
    }))

    return c.json({
        name: res.FunctionName ?? name,
        functionArn: res.FunctionArn,
        runtime: res.Runtime,
        handler: res.Handler,
        state: res.State,
        stateReason: res.StateReason,
        lastModified: res.LastModified,
        memorySize: res.MemorySize,
        timeout: res.Timeout,
        description: res.Description,
        role: res.Role,
        environment: res.Environment?.Variables,
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