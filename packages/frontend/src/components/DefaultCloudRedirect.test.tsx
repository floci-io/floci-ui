import {render, screen} from '@testing-library/react'
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {CloudDescriptor} from '@/types/cloud'
import {defaultCloudOf, isAllowedCloud} from '@/lib/useDefaultCloud'
import {DefaultCloudRedirect, ScopedCloudRoute} from './DefaultCloudRedirect'

const clouds = vi.hoisted(() => ({data: undefined as CloudDescriptor[] | undefined, isPending: false}))

vi.mock('@/api/queries/cloudQueries', () => ({
    useCloudsQuery: () => clouds,
}))

function scoped(cloud: CloudDescriptor['id']): CloudDescriptor[] {
    return [{id: cloud, displayName: cloud.toUpperCase(), availability: 'available', default: true}]
}

function list(defaultCloud?: CloudDescriptor['id']): CloudDescriptor[] {
    return (['aws', 'azure', 'gcp', 'oci'] as const).map((id) => ({
        id,
        displayName: id.toUpperCase(),
        availability: 'available',
        ...(defaultCloud ? {default: id === defaultCloud} : {}),
    }))
}

function Destination() {
    const {pathname} = useLocation()
    return <div>At {pathname}</div>
}

function renderAt(path: string) {
    render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route index element={<DefaultCloudRedirect to="console"/>}/>
                <Route path="/cloud-explorer" element={<DefaultCloudRedirect to="cloud-explorer"/>}/>
                <Route path="/console/:cloud" element={<ScopedCloudRoute><Destination/></ScopedCloudRoute>}/>
                <Route path="/cloud-explorer/:cloud/:service" element={<ScopedCloudRoute><Destination/></ScopedCloudRoute>}/>
                <Route path="/secretsmanager" element={<ScopedCloudRoute cloud="aws"><Destination/></ScopedCloudRoute>}/>
            </Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    clouds.data = undefined
    clouds.isPending = false
})

describe('DefaultCloudRedirect', () => {
    it('opens the cloud the emulator named', () => {
        clouds.data = list('azure')
        renderAt('/')

        expect(screen.getByText('At /console/azure')).toBeInTheDocument()
    })

    it('opens the default cloud in Cloud Explorer', () => {
        clouds.data = list('gcp')
        renderAt('/cloud-explorer')

        expect(screen.getByText('At /cloud-explorer/gcp/storage')).toBeInTheDocument()
    })

    it('waits for the API rather than showing AWS first', () => {
        clouds.isPending = true
        renderAt('/')

        expect(screen.queryByText(/^At /)).not.toBeInTheDocument()
    })

    it('opens AWS when the API marks no default or cannot be reached', () => {
        clouds.data = list()
        renderAt('/')

        expect(screen.getByText('At /console/aws')).toBeInTheDocument()
    })
})

describe('ScopedCloudRoute', () => {
    it('sends another cloud to the scoped cloud when an emulator started the console', () => {
        clouds.data = scoped('azure')
        renderAt('/console/aws')

        expect(screen.getByText('At /console/azure')).toBeInTheDocument()
    })

    it('sends another cloud\'s Cloud Explorer to the scoped cloud too', () => {
        clouds.data = scoped('azure')
        renderAt('/cloud-explorer/gcp/storage')

        expect(screen.getByText('At /console/azure')).toBeInTheDocument()
    })

    it('sends an AWS-only page to the scoped cloud when AWS is not served', () => {
        clouds.data = scoped('azure')
        renderAt('/secretsmanager')

        expect(screen.getByText('At /console/azure')).toBeInTheDocument()
    })

    it('keeps an AWS-only page for a console scoped to AWS', () => {
        clouds.data = scoped('aws')
        renderAt('/secretsmanager')
        expect(screen.getByText('At /secretsmanager')).toBeInTheDocument()
    })

    it('keeps an AWS-only page when the console is standalone', () => {
        clouds.data = list('aws')
        renderAt('/secretsmanager')
        expect(screen.getByText('At /secretsmanager')).toBeInTheDocument()
    })

    it('keeps the scoped cloud where it is', () => {
        clouds.data = scoped('azure')
        renderAt('/cloud-explorer/azure/storage')

        expect(screen.getByText('At /cloud-explorer/azure/storage')).toBeInTheDocument()
    })

    it('keeps any cloud when the console is standalone', () => {
        clouds.data = list('aws')
        renderAt('/console/gcp')

        expect(screen.getByText('At /console/gcp')).toBeInTheDocument()
    })

    it('renders the page while the list is pending', () => {
        clouds.isPending = true
        renderAt('/console/aws')

        expect(screen.getByText('At /console/aws')).toBeInTheDocument()
    })
})

describe('isAllowedCloud', () => {
    it('allows every cloud until the list has arrived', () => {
        expect(isAllowedCloud(undefined, 'oci')).toBe(true)
    })

    it('allows only the clouds the list names', () => {
        expect(isAllowedCloud(scoped('azure'), 'azure')).toBe(true)
        expect(isAllowedCloud(scoped('azure'), 'aws')).toBe(false)
    })
})

describe('defaultCloudOf', () => {
    it('is AWS for a server that predates the default flag, or no list at all', () => {
        expect(defaultCloudOf(list())).toBe('aws')
        expect(defaultCloudOf(undefined)).toBe('aws')
    })

    it('is the cloud marked default', () => {
        expect(defaultCloudOf(list('oci'))).toBe('oci')
    })
})
