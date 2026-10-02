import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactElement} from 'react'
import {beforeEach, describe, expect, test, vi} from 'vitest'
import {ResourceInspector} from './ResourceInspector'
import type {CloudResource, LambdaTrigger, StorageObject} from '@/types/resource'

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

    test('switches between Plain Text, JSON, and Table tabs', async () => {
        const user = userEvent.setup()
        renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        // Default tab is Plain Text
        const plainTab = screen.getByRole('tab', {name: 'Plain Text'})
        expect(plainTab).toHaveClass('active')
        expect(plainTab).toHaveAttribute('aria-selected', 'true')
        expect(plainTab).toHaveAttribute('aria-controls', 'inspector-tabpanel-plain')
        expect(screen.getByRole('tabpanel', {name: 'Plain Text'})).toBeInTheDocument()
        expect(screen.getByText('Lambda Details')).toBeInTheDocument()
        expect(screen.getByText('Cloud')).toBeInTheDocument()

        // Switch to JSON tab
        const jsonTab = screen.getByRole('tab', {name: 'JSON'})
        expect(jsonTab).toHaveAttribute('aria-selected', 'false')
        await user.click(jsonTab)
        expect(jsonTab).toHaveClass('active')
        expect(jsonTab).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('tabpanel', {name: 'JSON'})).toBeInTheDocument()
        expect(screen.queryByText('Lambda Details')).not.toBeInTheDocument()
        expect(screen.getByText(new RegExp(longNamedLambda.metadata.arn as string))).toBeInTheDocument()

        // Switch to Table tab
        const tableTab = screen.getByRole('tab', {name: 'Table'})
        expect(tableTab).toHaveAttribute('aria-selected', 'false')
        await user.click(tableTab)
        expect(tableTab).toHaveClass('active')
        expect(tableTab).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('tabpanel', {name: 'Table'})).toBeInTheDocument()
        expect(screen.queryByText('Lambda Details')).not.toBeInTheDocument()
        expect(screen.getByText('Arn')).toBeInTheDocument()

        // Switch back to Plain Text tab
        await user.click(plainTab)
        expect(plainTab).toHaveClass('active')
        expect(plainTab).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByText('Lambda Details')).toBeInTheDocument()
    })

    test('copies JSON data to clipboard when Copy button is clicked in JSON tab', async () => {
        const user = userEvent.setup()
        const writeTextMock = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: writeTextMock,
            },
            configurable: true,
        })

        renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        // Switch to JSON tab
        const jsonTab = screen.getByRole('tab', {name: 'JSON'})
        await user.click(jsonTab)

        const copyButton = screen.getByRole('button', {name: /Copy/i})
        expect(copyButton).toBeInTheDocument()

        await user.click(copyButton)
        expect(writeTextMock).toHaveBeenCalledWith(JSON.stringify(longNamedLambda.metadata, null, 2))
        expect(await screen.findByText('Copied')).toBeInTheDocument()
    })

    test('handles failed clipboard write gracefully without confirming copied', async () => {
        const user = userEvent.setup()
        const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'))
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: writeTextMock,
            },
            configurable: true,
        })

        renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        // Switch to JSON tab
        await user.click(screen.getByRole('tab', {name: 'JSON'}))

        const copyButton = screen.getByRole('button', {name: /Copy/i})
        await user.click(copyButton)

        expect(writeTextMock).toHaveBeenCalled()
        expect(screen.queryByText('Copied')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: /Copy/i})).toBeInTheDocument()
    })

    test('resets copied state when resource selection changes', async () => {
        const user = userEvent.setup()
        const writeTextMock = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: writeTextMock,
            },
            configurable: true,
        })

        const {rerender} = renderWithClient(
            <ResourceInspector
                resource={longNamedLambda}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        await user.click(screen.getByRole('tab', {name: 'JSON'}))
        await user.click(screen.getByRole('button', {name: /Copy/i}))
        expect(await screen.findByText('Copied')).toBeInTheDocument()

        const otherLambda: CloudResource = {
            ...longNamedLambda,
            id: 'other-lambda',
            name: 'other-lambda',
        }

        rerender(
            <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
                <ResourceInspector
                    resource={otherLambda}
                    cloud="aws"
                    runtimeReachable={true}
                />
            </QueryClientProvider>,
        )

        expect(screen.queryByText('Copied')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: /Copy/i})).toBeInTheDocument()
    })

    test('keeps log inspection panels mounted across metadata tab switching for log groups', async () => {
        const user = userEvent.setup()
        const logGroupResource: CloudResource = {
            id: '/aws/lambda/test-function',
            name: '/aws/lambda/test-function',
            cloud: 'aws',
            service: 'logs',
            type: 'log-group',
            region: 'us-east-1',
            createdAt: '2026-09-30T00:00:00.000Z',
            metadata: {arn: 'arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/test-function'},
        }

        renderWithClient(
            <ResourceInspector
                resource={logGroupResource}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        // Logs Query Panel and Streams Panel should be present
        expect(screen.getByText('Insights query')).toBeInTheDocument()
        expect(screen.getByText('Streams & events')).toBeInTheDocument()

        // Switch to JSON tab
        await user.click(screen.getByRole('tab', {name: 'JSON'}))
        expect(screen.getByText('Insights query')).toBeInTheDocument()
        expect(screen.getByText('Streams & events')).toBeInTheDocument()

        // Switch to Table tab
        await user.click(screen.getByRole('tab', {name: 'Table'}))
        expect(screen.getByText('Insights query')).toBeInTheDocument()
        expect(screen.getByText('Streams & events')).toBeInTheDocument()
    })

    test('renders storage object inspector with tabs and accessible attributes', async () => {
        const user = userEvent.setup()
        const s3Bucket: CloudResource = {
            id: 'my-bucket',
            name: 'my-bucket',
            cloud: 'aws',
            service: 'storage',
            type: 's3',
            region: 'us-east-1',
            createdAt: '2026-09-30T00:00:00.000Z',
            metadata: {},
        }
        const storageObj: StorageObject = {
            name: 'sample.txt',
            key: 'folder/sample.txt',
            type: 'object',
            size: 1024,
            lastModified: '2026-09-30T10:00:00Z',
            metadata: {contentType: 'text/plain'},
        }

        renderWithClient(
            <ResourceInspector
                resource={s3Bucket}
                object={storageObj}
                cloud="aws"
                runtimeReachable={true}
            />,
        )

        const plainTab = screen.getByRole('tab', {name: 'Plain Text'})
        const jsonTab = screen.getByRole('tab', {name: 'JSON'})
        const tableTab = screen.getByRole('tab', {name: 'Table'})

        expect(plainTab).toHaveAttribute('aria-selected', 'true')
        expect(plainTab).toHaveAttribute('aria-controls', 'object-tabpanel-plain')
        expect(screen.getByRole('tabpanel', {name: 'Plain Text'})).toBeInTheDocument()
        expect(screen.getByText('folder/sample.txt')).toBeInTheDocument()

        // Switch to JSON tab
        await user.click(jsonTab)
        expect(jsonTab).toHaveAttribute('aria-selected', 'true')
        expect(jsonTab).toHaveAttribute('aria-controls', 'object-tabpanel-json')
        expect(screen.getByRole('tabpanel', {name: 'JSON'})).toBeInTheDocument()
        expect(screen.getByRole('button', {name: /Copy/i})).toBeInTheDocument()

        // Switch to Table tab
        await user.click(tableTab)
        expect(tableTab).toHaveAttribute('aria-selected', 'true')
        expect(tableTab).toHaveAttribute('aria-controls', 'object-tabpanel-table')
        expect(screen.getByRole('tabpanel', {name: 'Table'})).toBeInTheDocument()
    })
})


