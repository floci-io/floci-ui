import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {useState} from 'react'
import {Plus, Trash2} from 'lucide-react'
import {
    createKubernetesFargateProfile,
    createKubernetesNodegroup,
    deleteKubernetesFargateProfile,
    deleteKubernetesNodegroup,
    listKubernetesFargateProfiles,
    listKubernetesNodegroups,
} from '@/api/cloudProxyClient'
import {cloudQueryKeys} from '@/api/queries/cloudQueries'
import {
    type CreateKubernetesFargateProfileInput,
    type CreateKubernetesNodegroupInput,
    type KubernetesFargateProfile,
    type KubernetesNodegroup,
} from '@/types/resource'
import type {CloudProvider} from '@/types/cloud'

interface K8sEngineDetailsProps {
    cloud: CloudProvider
    clusterName: string
}

export function K8sEngineDetails({cloud, clusterName}: K8sEngineDetailsProps) {
    if (cloud !== 'aws') {
        return (
            <section className="inspector-section">
                <p className="metric-label">k8s Engine Capabilities</p>
                <p className="muted compact-text">Nodegroups and Fargate profiles are currently wired for AWS EKS.</p>
            </section>
        )
    }

    return (
        <>
            <EksNodegroupsSection cloud={cloud} clusterName={clusterName}/>
            <EksFargateProfilesSection cloud={cloud} clusterName={clusterName}/>
        </>
    )
}

function EksNodegroupsSection({cloud, clusterName}: {cloud: CloudProvider; clusterName: string}) {
    const queryClient = useQueryClient()
    const queryKey = ['k8s', cloud, clusterName, 'nodegroups'] as const
    const nodegroupsQuery = useQuery({
        queryKey,
        queryFn: ({signal}) => listKubernetesNodegroups(cloud, clusterName, signal),
        refetchInterval: 30_000,
    })
    const createNodegroup = useMutation({
        mutationFn: (input: CreateKubernetesNodegroupInput) => createKubernetesNodegroup(cloud, clusterName, input),
        onSuccess: () => invalidateK8sQueries(queryClient, cloud, clusterName),
    })
    const deleteNodegroup = useMutation({
        mutationFn: (nodegroupId: string) => deleteKubernetesNodegroup(cloud, clusterName, nodegroupId),
        onSuccess: () => invalidateK8sQueries(queryClient, cloud, clusterName),
    })
    const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
    const [form, setForm] = useState({
        name: '',
        nodeRole: '',
        subnets: '',
        instanceTypes: 't3.medium',
        minSize: '1',
        desiredSize: '1',
        maxSize: '2',
    })
    const canCreate = form.name.trim() && form.nodeRole.trim() && parseCsv(form.subnets).length > 0

    return (
        <section className="inspector-section">
            <div className="inspector-section-header">
                <p className="metric-label">Managed Nodegroups</p>
                <button className="button compact" type="button" onClick={() => nodegroupsQuery.refetch()}>
                    Refresh
                </button>
            </div>
            <form
                className="inspector-action-form"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (!canCreate) return

                    createNodegroup.mutate({
                        name: form.name.trim(),
                        nodeRole: form.nodeRole.trim(),
                        subnets: parseCsv(form.subnets),
                        instanceTypes: parseCsv(form.instanceTypes),
                        scalingConfig: {
                            minSize: Number(form.minSize),
                            desiredSize: Number(form.desiredSize),
                            maxSize: Number(form.maxSize),
                        },
                    })
                }}
            >
                <input className="input" value={form.name} onChange={(event) => setForm({...form, name: event.target.value})} placeholder="Nodegroup name"/>
                <input className="input" value={form.nodeRole} onChange={(event) => setForm({...form, nodeRole: event.target.value})} placeholder="Node role ARN"/>
                <input className="input" value={form.subnets} onChange={(event) => setForm({...form, subnets: event.target.value})} placeholder="subnet-a, subnet-b"/>
                <input className="input" value={form.instanceTypes} onChange={(event) => setForm({...form, instanceTypes: event.target.value})} placeholder="t3.medium"/>
                <input className="input" type="number" min="0" value={form.minSize} onChange={(event) => setForm({...form, minSize: event.target.value})} placeholder="Min"/>
                <input className="input" type="number" min="0" value={form.desiredSize} onChange={(event) => setForm({...form, desiredSize: event.target.value})} placeholder="Desired"/>
                <input className="input" type="number" min="1" value={form.maxSize} onChange={(event) => setForm({...form, maxSize: event.target.value})} placeholder="Max"/>
                <button className="button compact" type="submit" disabled={!canCreate || createNodegroup.isPending}>
                    <Plus size={13}/>
                    {createNodegroup.isPending ? 'Creating' : 'Create'}
                </button>
            </form>
            {createNodegroup.isError && <p className="error-text compact-text">{errorMessage(createNodegroup.error)}</p>}
            {deleteNodegroup.isError && <p className="error-text compact-text">{errorMessage(deleteNodegroup.error)}</p>}
            <NodegroupsList
                deleteCandidate={deleteCandidate}
                deletingName={deleteNodegroup.variables}
                isError={nodegroupsQuery.isError}
                isLoading={nodegroupsQuery.isLoading}
                nodegroups={nodegroupsQuery.data ?? []}
                onCancelDelete={() => setDeleteCandidate(null)}
                onConfirmDelete={(nodegroupName) => {
                    deleteNodegroup.mutate(nodegroupName)
                    setDeleteCandidate(null)
                }}
                onRequestDelete={setDeleteCandidate}
            />
        </section>
    )
}

function EksFargateProfilesSection({cloud, clusterName}: {cloud: CloudProvider; clusterName: string}) {
    const queryClient = useQueryClient()
    const queryKey = ['k8s', cloud, clusterName, 'fargate-profiles'] as const
    const profilesQuery = useQuery({
        queryKey,
        queryFn: ({signal}) => listKubernetesFargateProfiles(cloud, clusterName, signal),
        refetchInterval: 30_000,
    })
    const createProfile = useMutation({
        mutationFn: (input: CreateKubernetesFargateProfileInput) => createKubernetesFargateProfile(cloud, clusterName, input),
        onSuccess: () => invalidateK8sQueries(queryClient, cloud, clusterName),
    })
    const deleteProfile = useMutation({
        mutationFn: (profileId: string) => deleteKubernetesFargateProfile(cloud, clusterName, profileId),
        onSuccess: () => invalidateK8sQueries(queryClient, cloud, clusterName),
    })
    const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
    const [form, setForm] = useState({
        name: '',
        roleArn: '',
        namespace: 'default',
        labels: '',
        subnets: '',
    })
    const canCreate = form.name.trim() && form.roleArn.trim() && form.namespace.trim()

    return (
        <section className="inspector-section">
            <div className="inspector-section-header">
                <p className="metric-label">Fargate Profiles</p>
                <button className="button compact" type="button" onClick={() => profilesQuery.refetch()}>
                    Refresh
                </button>
            </div>
            <form
                className="inspector-action-form"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (!canCreate) return

                    createProfile.mutate({
                        name: form.name.trim(),
                        podExecutionRoleArn: form.roleArn.trim(),
                        subnets: parseCsv(form.subnets),
                        selectors: [{
                            namespace: form.namespace.trim(),
                            labels: parseKeyValueCsv(form.labels),
                        }],
                    })
                }}
            >
                <input className="input" value={form.name} onChange={(event) => setForm({...form, name: event.target.value})} placeholder="Profile name"/>
                <input className="input" value={form.roleArn} onChange={(event) => setForm({...form, roleArn: event.target.value})} placeholder="Pod execution role ARN"/>
                <input className="input" value={form.namespace} onChange={(event) => setForm({...form, namespace: event.target.value})} placeholder="Namespace"/>
                <input className="input" value={form.labels} onChange={(event) => setForm({...form, labels: event.target.value})} placeholder="app=api, tier=backend"/>
                <input className="input" value={form.subnets} onChange={(event) => setForm({...form, subnets: event.target.value})} placeholder="Optional subnets"/>
                <button className="button compact" type="submit" disabled={!canCreate || createProfile.isPending}>
                    <Plus size={13}/>
                    {createProfile.isPending ? 'Creating' : 'Create'}
                </button>
            </form>
            {createProfile.isError && <p className="error-text compact-text">{errorMessage(createProfile.error)}</p>}
            {deleteProfile.isError && <p className="error-text compact-text">{errorMessage(deleteProfile.error)}</p>}
            <FargateProfilesList
                deleteCandidate={deleteCandidate}
                deletingName={deleteProfile.variables}
                isError={profilesQuery.isError}
                isLoading={profilesQuery.isLoading}
                profiles={profilesQuery.data ?? []}
                onCancelDelete={() => setDeleteCandidate(null)}
                onConfirmDelete={(profileName) => {
                    deleteProfile.mutate(profileName)
                    setDeleteCandidate(null)
                }}
                onRequestDelete={setDeleteCandidate}
            />
        </section>
    )
}

function NodegroupsList({
    nodegroups,
    isLoading,
    isError,
    deletingName,
    deleteCandidate,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
}: {
    nodegroups: KubernetesNodegroup[]
    isLoading: boolean
    isError: boolean
    deletingName?: string
    deleteCandidate: string | null
    onRequestDelete: (nodegroupName: string) => void
    onConfirmDelete: (nodegroupName: string) => void
    onCancelDelete: () => void
}) {
    if (isLoading) return <p className="muted compact-text">Loading nodegroups.</p>
    if (isError) return <p className="error-text compact-text">Failed to load nodegroups.</p>
    if (nodegroups.length === 0) return <p className="muted compact-text">No managed nodegroups returned for this cluster.</p>

    return (
        <div className="snapshot-list">
            {nodegroups.map((nodegroup) => (
                <div className="snapshot-row" key={nodegroup.arn ?? nodegroup.name}>
                    <div>
                        <strong>{nodegroup.name}</strong>
                        <span>{nodegroup.instanceTypes.join(', ') || 'No instance types'} · {formatScaling(nodegroup)}</span>
                    </div>
                    {deleteCandidate === nodegroup.name ? (
                        <span className="inline-actions">
                            <button className="button compact danger" type="button" onClick={() => onConfirmDelete(nodegroup.name)}>Delete</button>
                            <button className="button compact" type="button" onClick={onCancelDelete}>Cancel</button>
                        </span>
                    ) : (
                        <button
                            aria-label={`Delete ${nodegroup.name}`}
                            className="icon-btn danger"
                            type="button"
                            disabled={deletingName === nodegroup.name}
                            onClick={() => onRequestDelete(nodegroup.name)}
                        >
                            <Trash2 size={13}/>
                        </button>
                    )}
                </div>
            ))}
        </div>
    )
}

function FargateProfilesList({
    profiles,
    isLoading,
    isError,
    deletingName,
    deleteCandidate,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
}: {
    profiles: KubernetesFargateProfile[]
    isLoading: boolean
    isError: boolean
    deletingName?: string
    deleteCandidate: string | null
    onRequestDelete: (profileName: string) => void
    onConfirmDelete: (profileName: string) => void
    onCancelDelete: () => void
}) {
    if (isLoading) return <p className="muted compact-text">Loading Fargate profiles.</p>
    if (isError) return <p className="error-text compact-text">Failed to load Fargate profiles.</p>
    if (profiles.length === 0) return <p className="muted compact-text">No Fargate profiles returned for this cluster.</p>

    return (
        <div className="snapshot-list">
            {profiles.map((profile) => (
                <div className="snapshot-row" key={profile.arn ?? profile.name}>
                    <div>
                        <strong>{profile.name}</strong>
                        <span>{profile.selectors.map((selector) => selector.namespace ?? '*').join(', ') || 'No selectors'}</span>
                    </div>
                    {deleteCandidate === profile.name ? (
                        <span className="inline-actions">
                            <button className="button compact danger" type="button" onClick={() => onConfirmDelete(profile.name)}>Delete</button>
                            <button className="button compact" type="button" onClick={onCancelDelete}>Cancel</button>
                        </span>
                    ) : (
                        <button
                            aria-label={`Delete ${profile.name}`}
                            className="icon-btn danger"
                            type="button"
                            disabled={deletingName === profile.name}
                            onClick={() => onRequestDelete(profile.name)}
                        >
                            <Trash2 size={13}/>
                        </button>
                    )}
                </div>
            ))}
        </div>
    )
}

function parseCsv(value: string) {
    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
}

function parseKeyValueCsv(value: string) {
    return Object.fromEntries(
        parseCsv(value)
            .map((part) => part.split('='))
            .filter(([key, val]) => key?.trim() && val?.trim())
            .map(([key, val]) => [key.trim(), val.trim()]),
    )
}

function formatScaling(nodegroup: KubernetesNodegroup) {
    const scaling = nodegroup.scalingConfig
    if (!scaling) return 'No scaling config'
    return `${scaling.minSize ?? '?'}/${scaling.desiredSize ?? '?'}/${scaling.maxSize ?? '?'}`
}

function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    return 'The EKS operation failed.'
}

function invalidateK8sQueries(queryClient: ReturnType<typeof useQueryClient>, cloud: CloudProvider, clusterName: string) {
    void queryClient.invalidateQueries({queryKey: ['k8s', cloud, clusterName]})
    void queryClient.invalidateQueries({queryKey: ['cloud-resources', cloud, 'k8s']})
    void queryClient.invalidateQueries({queryKey: cloudQueryKeys.resources(cloud, 'k8s')})
}
