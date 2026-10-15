import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, test, vi} from 'vitest'
import {StorageObjectBrowser} from './StorageObjectBrowser'
import {
    copyStorageObject,
    deleteStorageObject,
    listCloudResources,
    listStorageObjects,
    uploadStorageObject,
} from '@/api/cloudProxyClient'
import {setAccountId} from '@/lib/accountStore'
import type {CloudResource, StorageObjectList} from '@/types/resource'
import type {ObjectActionName} from '@/types/schema'

vi.mock('@/api/cloudProxyClient', () => ({
    copyStorageObject: vi.fn(),
    createCloudResource: vi.fn(),
    deleteStorageObject: vi.fn(),
    listCloudResources: vi.fn(),
    listStorageObjects: vi.fn(),
    storageObjectDownloadUrl: vi.fn(() => '#'),
    uploadStorageObject: vi.fn(),
}))

const ACCOUNT_A = '111111111111'
const ACCOUNT_B = '222222222222'
const ACTIONS: ObjectActionName[] = ['list', 'upload', 'download', 'delete', 'createFolder', 'copy']

const bucket: CloudResource = {
    id: 'logs',
    name: 'logs',
    cloud: 'aws',
    service: 'storage',
    type: 'bucket',
    region: null,
    createdAt: null,
    metadata: {},
}

function listing(...keys: string[]): StorageObjectList {
    return {
        prefix: '',
        objects: keys.map((key) => ({key, name: key, type: 'object' as const, size: 1, lastModified: null, metadata: {}})),
    }
}

function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
        resolve = done
    })
    return {promise, resolve}
}

function renderBrowser() {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const onSelectObject = vi.fn()
    const view = render(
        <QueryClientProvider client={qc}>
            <StorageObjectBrowser cloud="aws" resource={bucket} capabilities={ACTIONS} runtimeReachable onSelectObject={onSelectObject}/>
        </QueryClientProvider>,
    )
    return {qc, invalidate, onSelectObject, view}
}

/** Invalidated object-listing keys, so a stray key for the other account shows up. */
function invalidatedStorageKeys(invalidate: {mock: {calls: unknown[][]}}): unknown[][] {
    return invalidate.mock.calls
        .map(([filters]) => (filters as {queryKey?: unknown[]} | undefined)?.queryKey)
        .filter((key): key is unknown[] => Array.isArray(key) && key[0] === 'storage-objects')
}

describe('StorageObjectBrowser storage cache', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setAccountId(ACCOUNT_A)
        vi.mocked(listStorageObjects).mockResolvedValue(listing('a.txt', 'b.txt'))
        vi.mocked(listCloudResources).mockResolvedValue([bucket, {...bucket, id: 'archive', name: 'archive'}])
    })

    test('keys the object listing by account, so same-name buckets do not share a cache', async () => {
        const {qc} = renderBrowser()
        await screen.findByText('a.txt')
        expect(qc.getQueryData(['storage-objects', ACCOUNT_A, 'aws', 'logs', ''])).toEqual(listing('a.txt', 'b.txt'))

        vi.mocked(listStorageObjects).mockResolvedValue(listing('other-account.txt'))
        act(() => setAccountId(ACCOUNT_B))

        await screen.findByText('other-account.txt')
        expect(qc.getQueryData(['storage-objects', ACCOUNT_B, 'aws', 'logs', ''])).toEqual(listing('other-account.txt'))
        expect(qc.getQueryData(['storage-objects', ACCOUNT_A, 'aws', 'logs', ''])).toEqual(listing('a.txt', 'b.txt'))
    })

    test('resets local state when the account changes under the same bucket ID', async () => {
        const user = userEvent.setup()
        renderBrowser()
        await screen.findByText('a.txt')
        await user.click(screen.getByRole('button', {name: 'New folder'}))
        expect(screen.getByPlaceholderText('new-folder/')).toBeInTheDocument()

        act(() => setAccountId(ACCOUNT_B))

        await waitFor(() => expect(screen.queryByPlaceholderText('new-folder/')).not.toBeInTheDocument())
    })

    test('drops selected keys that are no longer listed', async () => {
        const user = userEvent.setup()
        const {qc} = renderBrowser()
        await user.click(await screen.findByLabelText('Select a.txt'))

        vi.mocked(listStorageObjects).mockResolvedValue(listing('b.txt'))
        await act(() => qc.invalidateQueries({queryKey: ['storage-objects', ACCOUNT_A, 'aws', 'logs']}))

        await waitFor(() => expect(screen.queryByText('1 object selected')).not.toBeInTheDocument())
    })

    // Each write starts under account A and settles after B is selected. The
    // refresh has to go to the listing the write changed, which is A's.
    const writes: Array<{
        name: string
        mock: () => ReturnType<typeof vi.fn>
        start: (user: ReturnType<typeof userEvent.setup>) => Promise<void>
        extraKey?: unknown[]
        verify?: () => void
    }> = [
        {
            name: 'upload',
            mock: () => vi.mocked(uploadStorageObject),
            start: async (user) => {
                await user.upload(screen.getByLabelText('Choose file to upload'), new File(['x'], 'new.txt'))
            },
        },
        {
            name: 'create folder',
            mock: () => vi.mocked(uploadStorageObject),
            start: async (user) => {
                await user.click(screen.getByRole('button', {name: 'New folder'}))
                await user.type(screen.getByPlaceholderText('new-folder/'), 'docs')
                await user.click(screen.getByRole('button', {name: 'Create folder'}))
            },
        },
        {
            name: 'object delete',
            mock: () => vi.mocked(deleteStorageObject),
            start: async (user) => {
                await user.click(screen.getByTitle('Delete a.txt'))
                await user.click(screen.getByRole('button', {name: 'Confirm'}))
            },
        },
        {
            name: 'bulk delete',
            mock: () => vi.mocked(deleteStorageObject),
            start: async (user) => {
                await user.click(screen.getByLabelText('Select a.txt'))
                await user.click(screen.getByRole('button', {name: 'Delete 1'}))
            },
        },
        {
            name: 'copy to another bucket (source and destination)',
            mock: () => vi.mocked(copyStorageObject),
            start: async (user) => {
                await user.click(screen.getByTitle('Move / Copy a.txt'))
                const dialog = await screen.findByRole('dialog')
                await user.click(within(dialog).getByRole('button', {name: 'Copy'}))
                await user.selectOptions(await within(dialog).findByLabelText('Destination bucket'), 'archive')
                const copyButtons = within(dialog).getAllByRole('button', {name: 'Copy'})
                await user.click(copyButtons[copyButtons.length - 1])
            },
            extraKey: ['storage-objects', ACCOUNT_A, 'aws', 'archive'],
        },
        {
            name: 'move (its source delete included)',
            mock: () => vi.mocked(copyStorageObject),
            start: async (user) => {
                await user.click(screen.getByTitle('Move / Copy a.txt'))
                const dialog = await screen.findByRole('dialog')
                await user.clear(within(dialog).getByLabelText('Destination key'))
                await user.type(within(dialog).getByLabelText('Destination key'), 'moved.txt')
                // The tab and the submit button are both named Move; the submit is last.
                const moveButtons = within(dialog).getAllByRole('button', {name: 'Move'})
                await user.click(moveButtons[moveButtons.length - 1])
            },
            // The delete is sent after the copy settles, by which time account B is
            // selected; it must still go to account A, where the copy was made.
            verify: () => expect(deleteStorageObject).toHaveBeenCalledWith(ACCOUNT_A, 'aws', 'logs', 'a.txt'),
        },
    ]

    for (const write of writes) {
        test(`${write.name} refreshes the account it wrote to, not the one selected when it settles`, async () => {
            const user = userEvent.setup()
            const gate = deferred()
            write.mock().mockReturnValue(gate.promise)
            const {invalidate} = renderBrowser()
            await screen.findByText('a.txt')

            await write.start(user)
            await waitFor(() => expect(write.mock()).toHaveBeenCalled())
            act(() => setAccountId(ACCOUNT_B))
            await act(async () => gate.resolve())

            await waitFor(() => expect(invalidatedStorageKeys(invalidate)).toContainEqual(['storage-objects', ACCOUNT_A, 'aws', 'logs']))
            if (write.extraKey) expect(invalidatedStorageKeys(invalidate)).toContainEqual(write.extraKey)
            write.verify?.()
            expect(invalidatedStorageKeys(invalidate).some((key) => key[1] === ACCOUNT_B)).toBe(false)
        })
    }

    test('a write settling after the account changed leaves the new view alone', async () => {
        const user = userEvent.setup()
        const gate = deferred()
        vi.mocked(deleteStorageObject).mockReturnValue(gate.promise)
        const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const onSelectObject = vi.fn()
        const view = (selectedObjectKey?: string) => (
            <QueryClientProvider client={qc}>
                <StorageObjectBrowser cloud="aws" resource={bucket} capabilities={ACTIONS} runtimeReachable selectedObjectKey={selectedObjectKey} onSelectObject={onSelectObject}/>
            </QueryClientProvider>
        )
        const {rerender} = render(view('a.txt'))
        await screen.findByText('a.txt')
        await user.click(screen.getByTitle('Delete a.txt'))
        await user.click(screen.getByRole('button', {name: 'Confirm'}))

        act(() => setAccountId(ACCOUNT_B))
        rerender(view('a.txt'))
        await screen.findByText('a.txt')
        onSelectObject.mockClear()
        await act(async () => gate.resolve())

        await waitFor(() => expect(deleteStorageObject).toHaveBeenCalled())
        expect(onSelectObject).not.toHaveBeenCalled()
    })
})
