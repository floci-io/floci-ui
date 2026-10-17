import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {type ChildProcess, spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createApiApp, createBunFetch} from '../app'
import {awsStorageSchema} from '../cloud-spi/storageSchema'
import type {CloudServiceAdapter} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import {createCloudRoutes} from './clouds'

/**
 * Bun closes a connection that sends nothing for 10 seconds by default, even
 * while the handler is still awaiting. Emptying a bucket can take longer, so this
 * drives the production app over real sockets, directly and through the Vite dev
 * proxy, with an operation that outlasts that default. Bun checks idle sockets
 * coarsely (an awaiting request was cut at about 12 seconds on Bun 1.4.3, while
 * one finishing at 11 survived), so the operation runs well past that point.
 */
const OPERATION_MS = 16_000
const VITE_READY_MS = 20_000
const VITE_CLOSE_MS = 5_000
// One bucket per request: the API refuses a second Empty bucket on a bucket already being emptied.
const emptyPath = (bucket: string) => `/api/clouds/aws/services/storage/resources/${bucket}/empty`

const slowStorage: CloudServiceAdapter = {
    cloud: 'aws',
    service: 'storage',
    schema: awsStorageSchema,
    list: async () => [],
    get: async () => null,
    create: async () => {
        throw new Error('not used')
    },
    delete: async () => {},
    emptyBucket: async () => {
        await Bun.sleep(OPERATION_MS)
        return {deleted: 1}
    },
}
const slowService = new CloudProxyService(new CloudAdapterRegistry([slowStorage]))

let api: ReturnType<typeof Bun.serve> | undefined
let vite: ChildProcess | undefined
let vitePort = 0

beforeAll(async () => {
    api = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: createBunFetch(createApiApp(createCloudRoutes(undefined, () => slowService))),
    })
    const script = fileURLToPath(new URL('../../../frontend/scripts/empty-bucket-timeout-proxy.mjs', import.meta.url))
    const child = spawn('node', [script], {
        env: {...process.env, API_TARGET: `http://127.0.0.1:${api.port}`},
        stdio: ['ignore', 'pipe', 'inherit'],
    })
    vite = child
    vitePort = await readyPort(child)
}, VITE_READY_MS + 5_000)

afterAll(async () => {
    api?.stop(true)
    if (vite && vite.exitCode === null && vite.signalCode === null) {
        const child = vite
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
        child.kill('SIGTERM')
        const closed = await Promise.race([exited.then(() => true), Bun.sleep(VITE_CLOSE_MS).then(() => false)])
        if (!closed) child.kill('SIGKILL')
    }
})

describe('empty bucket over a real socket', () => {
    test('outlasts the 10-second idle default directly and through the Vite proxy', async () => {
        const [direct, proxied] = await Promise.all([
            fetch(`http://127.0.0.1:${api?.port}${emptyPath('logs')}`, {method: 'POST'}),
            fetch(`http://127.0.0.1:${vitePort}${emptyPath('assets')}`, {method: 'POST'}),
        ])

        expect(direct.status).toBe(200)
        expect(await direct.json()).toEqual({deleted: 1})
        expect(proxied.status).toBe(200)
        expect(await proxied.json()).toEqual({deleted: 1})
    }, 60_000)
})

function readyPort(child: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
        let buffered = ''
        const timer = setTimeout(() => reject(new Error(`Vite fixture was not ready within ${VITE_READY_MS} ms`)), VITE_READY_MS)
        child.once('exit', (code) => {
            clearTimeout(timer)
            reject(new Error(`Vite fixture exited early with code ${code}`))
        })
        child.stdout?.on('data', (chunk: Buffer) => {
            buffered += chunk.toString()
            const line = buffered.split('\n').find((candidate) => candidate.startsWith('{'))
            if (!line) return
            clearTimeout(timer)
            resolve((JSON.parse(line) as {port: number}).port)
        })
    })
}
