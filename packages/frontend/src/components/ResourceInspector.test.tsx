import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactElement} from 'react'
import {beforeEach, describe, expect, test, vi} from 'vitest'
import {ResourceInspector} from './ResourceInspector'
import type {CloudResource, LambdaTrigger} from '@/types/resource'

const {listLambdaTriggers, listCloudResources, createLambdaTrigger, deleteLambdaTrigger} = vi.hoisted(() => ({
    listLambdaTriggers: vi.fn(),
    listCloudResources: vi.fn(),
    createLambdaTrigger: vi.fn(),
    deleteLambdaTrigger: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', () => ({
    listLambdaTriggers,
    listCloudResources,
    createLambdaTrigger,
    deleteLambdaTrigger,
}))

function renderWithClient(ui: ReactElement) {
    const qc = new QueryClient({
        defaultOptions: {
            queries: {retry: false},
        },
    })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const longNamedLambda: CloudResource = {
    id: 'dynamo-mesh-serverless-local-eventCommitCoordinator',
    name: 'dynamo-mesh-serverless-local-eventCommitCoordinator',
    cloud: 'aws',
    service: 'serverless',
    type: 'lambda',
    region: 'us-east-1',
    createdAt: '2026-09-24T18:00:00.000Z',
    metadata: {
        arn: 'arn:aws:lambda:us-east-1:000000000000:function:dynamo-mesh-serverless-local-eventCommitCoordinator',
        runtime: 'nodejs20.x',
        handler: 'index.handler',
        memorySize: 256,
        timeout: 30,
    },
}

describe('ResourceInspector Lambda Header and Triggers', () => {
    beforeEach(() => {
        listLambdaTriggers.mockReset()
        listCloudResources.mockReset()
        createLambdaTrigger.mockReset()
        deleteLambdaTrigger.mockReset()

        listLambdaTriggers.mockResolvedValue([])
        listCloudResources.mockResolvedValue([])
    })

    test('renders long lambda function name with single-line button and accurate trigger count', async () => {
        renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        const heading = screen.getByRole('heading', {
            name: 'dynamo-mesh-serverless-local-eventCommitCoordinator',
        })
        expect(heading).toBeInTheDocument()
        expect(heading).toHaveStyle({textOverflow: 'ellipsis', whiteSpace: 'nowrap'})

        const triggerButton = await screen.findByRole('button', {
            name: /Register Trigger \(0\)/i,
        })
        expect(triggerButton).toBeInTheDocument()
        expect(triggerButton).toHaveStyle({whiteSpace: 'nowrap', flexShrink: '0'})
    })

    test('updates count when triggers exist', async () => {
        const mockTriggers: LambdaTrigger[] = [
            {
                id: 's3-trig-1',
                type: 's3',
                sourceArn: 'arn:aws:s3:::my-test-bucket',
                sourceName: 'my-test-bucket',
                status: 'Enabled',
                createdAt: '2026-09-24T18:10:00.000Z',
                details: {events: ['s3:ObjectCreated:*']},
            },
            {
                id: 'esm-1234',
                type: 'dynamodb',
                sourceArn: 'arn:aws:dynamodb:us-east-1:000000000000:table/orders/stream/2026',
                sourceName: 'orders',
                status: 'Enabled',
                createdAt: '2026-09-24T18:15:00.000Z',
                details: {batchSize: 100, startingPosition: 'LATEST'},
            },
        ]
        listLambdaTriggers.mockResolvedValue(mockTriggers)

        renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        const triggerButton = await screen.findByRole('button', {
            name: /Register Trigger \(2\)/i,
        })
        expect(triggerButton).toBeInTheDocument()
    })

    test('toggling Register Trigger button opens and closes trigger panel above inspector-grid', async () => {
        const user = userEvent.setup()
        renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        const triggerButton = await screen.findByRole('button', {
            name: /Register Trigger \(0\)/i,
        })

        // Initially trigger panel is not visible
        expect(screen.queryByText(/Trigger Source/i)).not.toBeInTheDocument()

        // Click button to open trigger panel
        await user.click(triggerButton)

        await waitFor(() => {
            expect(screen.getByText(/Trigger Source/i)).toBeInTheDocument()
        })
        expect(screen.getByText(`Add Trigger to ${longNamedLambda.name}`)).toBeInTheDocument()

        // Click again to collapse
        await user.click(triggerButton)

        await waitFor(() => {
            expect(screen.queryByText(/Trigger Source/i)).not.toBeInTheDocument()
        })
    })

    test('does not show Register Trigger button for non-AWS clouds or non-lambda services', () => {
        const gcpLambda: CloudResource = {
            ...longNamedLambda,
            cloud: 'gcp',
        }

        renderWithClient(
            <ResourceInspector
                resource={gcpLambda}
                cloud="gcp"
                runtimeReachable={true}
            />,
        )

        expect(screen.queryByRole('button', {name: /Register Trigger/i})).not.toBeInTheDocument()
    })
})
