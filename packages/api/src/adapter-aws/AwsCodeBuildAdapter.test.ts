import {describe, expect, test} from 'bun:test'
import {
    BatchGetBuildsCommand,
    BatchGetProjectsCommand,
    type CodeBuildClient,
    CreateProjectCommand,
    DeleteProjectCommand,
    ListBuildsCommand,
    ListProjectsCommand,
    StartBuildCommand,
} from '@aws-sdk/client-codebuild'
import {AwsCodeBuildAdapter} from './AwsCodeBuildAdapter'
import {NotFoundError, NotSupportedError, ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal CodeBuildClient stub that records the commands it was sent. */
function stubCodeBuild(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as CodeBuildClient
    return {client, sent}
}

// Shapes as Floci returns them.
const project = {
    name: 'demo',
    arn: 'arn:aws:codebuild:us-east-1:000000000000:project/demo',
    source: {type: 'NO_SOURCE', buildspec: 'version: 0.2'},
    artifacts: {type: 'NO_ARTIFACTS'},
    environment: {type: 'LINUX_CONTAINER', image: 'public.ecr.aws/docker/library/alpine:latest', computeType: 'BUILD_GENERAL1_SMALL'},
    serviceRole: 'arn:aws:iam::000000000000:role/cb',
    created: new Date('2026-11-10T17:42:48Z'),
}

const build = {
    id: 'demo:1',
    arn: 'arn:aws:codebuild:us-east-1:000000000000:build/demo:1',
    buildNumber: 1,
    projectName: 'demo',
    startTime: new Date('2026-11-10T17:42:48Z'),
    endTime: new Date('2026-11-10T17:44:53Z'),
    currentPhase: 'COMPLETED',
    buildStatus: 'SUCCEEDED',
    buildComplete: true,
    initiator: 'user',
    phases: [
        {phaseType: 'SUBMITTED', phaseStatus: 'SUCCEEDED', durationInSeconds: 0},
        {phaseType: 'BUILD', phaseStatus: 'FAILED', durationInSeconds: 3, contexts: [{statusCode: 'COMMAND_EXECUTION_ERROR', message: 'exit 1'}]},
    ],
    environment: project.environment,
    logs: {groupName: '/aws/codebuild/demo', streamName: '2026/11/10/demo/1'},
}

function runtime(projects: Record<string, SendResult>, builds: Record<string, SendResult>) {
    return (command: object): SendResult => {
        if (command instanceof ListProjectsCommand) return {projects: Object.keys(projects)}
        if (command instanceof ListBuildsCommand) return {ids: Object.keys(builds)}
        if (command instanceof BatchGetProjectsCommand) {
            const names = command.input.names as string[]
            return {projects: names.filter((name) => projects[name]).map((name) => projects[name])}
        }
        if (command instanceof BatchGetBuildsCommand) {
            const ids = command.input.ids as string[]
            return {builds: ids.filter((id) => builds[id]).map((id) => builds[id])}
        }
        throw new Error(`unexpected command ${command.constructor.name}`)
    }
}

describe('AwsCodeBuildAdapter.list', () => {
    test('is empty when there are no projects or builds', async () => {
        const {client} = stubCodeBuild(runtime({}, {}))

        expect(await new AwsCodeBuildAdapter(client).list()).toEqual([])
    })

    test('lists projects and builds with status, duration and phase', async () => {
        const {client} = stubCodeBuild(runtime({demo: project}, {'demo:1': build}))

        const resources = await new AwsCodeBuildAdapter(client).list()

        expect(resources.map((resource) => resource.id)).toEqual(['project:demo', 'build:demo:1'])
        expect(resources[0]).toMatchObject({name: 'demo', type: 'project', service: 'cicd', region: 'us-east-1', status: null})
        expect(resources[0].metadata.image).toBe('public.ecr.aws/docker/library/alpine:latest')
        expect(resources[1]).toMatchObject({name: 'demo #1', type: 'build', status: 'SUCCEEDED', createdAt: '2026-11-10T17:42:48.000Z'})
        expect(resources[1].metadata.duration).toBe('2m 05s')
        expect(resources[1].metadata.currentPhase).toBe('COMPLETED')
    })

    test('has no duration for a build that is still running', async () => {
        const running = {...build, endTime: undefined, buildStatus: 'IN_PROGRESS', buildComplete: false, currentPhase: 'BUILD'}
        const {client} = stubCodeBuild(runtime({}, {'demo:1': running}))

        const [resource] = await new AwsCodeBuildAdapter(client).list()

        expect(resource.status).toBe('IN_PROGRESS')
        expect(resource.metadata.duration).toBeNull()
    })

    test('shows seconds under a minute', async () => {
        const quick = {...build, endTime: new Date('2026-11-10T17:42:51Z')}
        const {client} = stubCodeBuild(runtime({}, {'demo:1': quick}))

        expect((await new AwsCodeBuildAdapter(client).list())[0].metadata.duration).toBe('3s')
    })

    test('keeps only the most recent builds', async () => {
        const many = Object.fromEntries(Array.from({length: 130}, (_, index) =>
            [`demo:${index + 1}`, {...build, id: `demo:${index + 1}`, buildNumber: index + 1}]))
        const {client} = stubCodeBuild(runtime({}, many))

        const resources = await new AwsCodeBuildAdapter(client).list()

        expect(resources).toHaveLength(100)
        expect(resources[0].id).toBe('build:demo:1')
    })

    test('reads builds in batches of 100', async () => {
        const many = Object.fromEntries(Array.from({length: 130}, (_, index) =>
            [`demo:${index + 1}`, {...build, id: `demo:${index + 1}`}]))
        const {client, sent} = stubCodeBuild(runtime({}, many))

        await new AwsCodeBuildAdapter(client).list()

        const sizes = sent.filter((command) => command instanceof BatchGetBuildsCommand)
            .map((command) => (command as BatchGetBuildsCommand).input.ids?.length)
        expect(sizes).toEqual([100])
    })

    test('follows project pages and stops on a repeated token', async () => {
        const pages = [{projects: ['a1'], nextToken: 't1'}, {projects: ['b2'], nextToken: 't1'}]
        let index = 0
        const {client} = stubCodeBuild((command) => {
            if (command instanceof ListProjectsCommand) return pages[index++]
            if (command instanceof ListBuildsCommand) return {ids: []}
            return {projects: (command as BatchGetProjectsCommand).input.names?.map((name) => ({...project, name}))}
        })

        const resources = await new AwsCodeBuildAdapter(client).list()

        expect(resources.map((resource) => resource.name)).toEqual(['a1', 'b2'])
    })

    test('searches by name and by status', async () => {
        const failed = {...build, id: 'other:1', projectName: 'other', buildStatus: 'FAILED'}
        const {client} = stubCodeBuild(runtime({demo: project}, {'demo:1': build, 'other:1': failed}))
        const adapter = new AwsCodeBuildAdapter(client)

        expect((await adapter.list({search: 'OTHER'})).map((resource) => resource.id)).toEqual(['build:other:1'])
        expect((await adapter.list({search: 'failed'})).map((resource) => resource.id)).toEqual(['build:other:1'])
    })
})

describe('AwsCodeBuildAdapter.get', () => {
    test('returns the phases of a build with their status', async () => {
        const {client} = stubCodeBuild(runtime({}, {'demo:1': build}))

        const resource = await new AwsCodeBuildAdapter(client).get('build:demo:1')

        expect(resource?.metadata.phases).toEqual([
            {phaseType: 'SUBMITTED', phaseStatus: 'SUCCEEDED', durationInSeconds: 0},
            {
                phaseType: 'BUILD',
                phaseStatus: 'FAILED',
                durationInSeconds: 3,
                contexts: [{statusCode: 'COMMAND_EXECUTION_ERROR', message: 'exit 1'}],
            },
        ])
        expect(resource?.metadata.logs).toEqual(build.logs)
    })

    test('returns a project with its source, environment and role', async () => {
        const {client} = stubCodeBuild(runtime({demo: project}, {}))

        const resource = await new AwsCodeBuildAdapter(client).get('project:demo')

        expect(resource?.metadata.serviceRole).toBe('arn:aws:iam::000000000000:role/cb')
        expect(resource?.metadata.source).toEqual(project.source)
    })

    test('returns null for an unknown project, build or id shape', async () => {
        const {client} = stubCodeBuild(runtime({}, {}))
        const adapter = new AwsCodeBuildAdapter(client)

        expect(await adapter.get('project:missing')).toBeNull()
        expect(await adapter.get('build:missing:9')).toBeNull()
        expect(await adapter.get('demo')).toBeNull()
    })
})

describe('AwsCodeBuildAdapter.create', () => {
    function creating() {
        return stubCodeBuild((command) => {
            if (command instanceof CreateProjectCommand) return {project}
            if (command instanceof StartBuildCommand) return {build}
            return runtime({demo: project}, {})(command)
        })
    }

    test('creates a project with no source and no artifacts', async () => {
        const {client, sent} = creating()

        const resource = await new AwsCodeBuildAdapter(client).create({
            values: {kind: 'project', name: ' demo ', serviceRole: 'arn:aws:iam::000000000000:role/cb', buildspec: 'version: 0.2'},
        })

        expect((sent[0] as CreateProjectCommand).input).toEqual({
            name: 'demo',
            source: {type: 'NO_SOURCE', buildspec: 'version: 0.2'},
            artifacts: {type: 'NO_ARTIFACTS'},
            environment: {
                type: 'LINUX_CONTAINER',
                image: 'public.ecr.aws/docker/library/alpine:latest',
                computeType: 'BUILD_GENERAL1_SMALL',
            },
            serviceRole: 'arn:aws:iam::000000000000:role/cb',
        })
        expect(resource.id).toBe('project:demo')
    })

    test('creates a project by default and uses the given image', async () => {
        const {client, sent} = creating()

        await new AwsCodeBuildAdapter(client).create({values: {name: 'demo', serviceRole: 'arn:role', image: 'node:22'}})

        const input = (sent[0] as CreateProjectCommand).input
        expect(input.environment?.image).toBe('node:22')
        expect(input.source).toEqual({type: 'NO_SOURCE'})
    })

    test('starts a build of an existing project, overriding the buildspec when given', async () => {
        const {client, sent} = creating()

        const resource = await new AwsCodeBuildAdapter(client).create({values: {kind: 'build', name: 'demo', buildspec: 'version: 0.2'}})

        expect((sent[0] as StartBuildCommand).input).toEqual({projectName: 'demo', buildspecOverride: 'version: 0.2'})
        expect(resource).toMatchObject({id: 'build:demo:1', type: 'build'})
    })

    test('starts a build without an override when no buildspec is given', async () => {
        const {client, sent} = creating()

        await new AwsCodeBuildAdapter(client).create({values: {kind: 'build', name: 'demo'}})

        expect((sent[0] as StartBuildCommand).input).toEqual({projectName: 'demo'})
    })

    test('rejects bad input without calling the runtime', async () => {
        const {client, sent} = creating()
        const adapter = new AwsCodeBuildAdapter(client)

        for (const values of [
            {name: ''},
            {name: 'a', serviceRole: 'arn:role'},
            {name: '-demo', serviceRole: 'arn:role'},
            {name: 'my demo', serviceRole: 'arn:role'},
            {name: 'x'.repeat(256), serviceRole: 'arn:role'},
            {name: 'demo'},
            {kind: 'report', name: 'demo', serviceRole: 'arn:role'},
        ]) {
            await expect(adapter.create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(sent).toEqual([])
    })

    test('fails when the runtime does not return the project it just created', async () => {
        const {client} = stubCodeBuild((command) => {
            if (command instanceof CreateProjectCommand) return {project}
            return runtime({}, {})(command)
        })

        await expect(new AwsCodeBuildAdapter(client).create({values: {name: 'demo', serviceRole: 'arn:role'}}))
            .rejects.toBeInstanceOf(NotFoundError)
    })

    test('fails when starting a build returns none', async () => {
        const {client} = stubCodeBuild(() => ({}))

        await expect(new AwsCodeBuildAdapter(client).create({values: {kind: 'build', name: 'demo'}}))
            .rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('AwsCodeBuildAdapter.delete and health', () => {
    test('deletes a project by name', async () => {
        const {client, sent} = stubCodeBuild(() => ({}))

        await new AwsCodeBuildAdapter(client).delete('project:demo')

        expect(sent[0]).toBeInstanceOf(DeleteProjectCommand)
        expect((sent[0] as DeleteProjectCommand).input).toEqual({name: 'demo'})
    })

    test('refuses to delete a build', async () => {
        const {client, sent} = stubCodeBuild(() => ({}))

        await expect(new AwsCodeBuildAdapter(client).delete('build:demo:1')).rejects.toBeInstanceOf(NotSupportedError)
        expect(sent).toEqual([])
    })

    test('treats an id of neither kind as not found', async () => {
        const {client} = stubCodeBuild(() => ({}))

        await expect(new AwsCodeBuildAdapter(client).delete('demo')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('health lists projects', async () => {
        const {client, sent} = stubCodeBuild(() => ({projects: []}))

        await new AwsCodeBuildAdapter(client).health()

        expect(sent[0]).toBeInstanceOf(ListProjectsCommand)
    })
})

describe('AwsCodeBuildAdapter.schema', () => {
    test('advertises exactly what the adapter performs', () => {
        const schema = new AwsCodeBuildAdapter({} as CodeBuildClient).schema()

        expect(schema.service).toBe('cicd')
        expect(schema.actions).toEqual(['list', 'create', 'inspect', 'delete'])
        expect(schema.columns.map((column) => column.name)).toEqual(
            ['name', 'type', 'status', 'duration', 'phase', 'image', 'createdAt'])
    })
})
