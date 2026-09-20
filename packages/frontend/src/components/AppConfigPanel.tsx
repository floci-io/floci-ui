import {FormEvent, useEffect, useMemo, useState} from 'react'
import {Plus, RefreshCw, Rocket, SlidersHorizontal, Trash2} from 'lucide-react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {
    createAppConfigConfigurationProfile,
    createAppConfigDeploymentStrategy,
    createAppConfigEnvironment,
    createAppConfigHostedConfigurationVersion,
    deleteAppConfigConfigurationProfile,
    deleteAppConfigDeploymentStrategy,
    deleteAppConfigEnvironment,
    deleteAppConfigHostedConfigurationVersion,
    getAppConfigDeployment,
    getAppConfigHostedConfigurationVersion,
    listAppConfigConfigurationProfiles,
    listAppConfigDeploymentStrategies,
    listAppConfigEnvironments,
    listAppConfigHostedConfigurationVersions,
    startAppConfigDeployment,
} from '@/api/cloudProxyClient'
import type {CloudProvider} from '@/types/cloud'
import type {AppConfigDeployment, CloudResource} from '@/types/resource'
import {useAccountId} from '@/lib/accountStore'

const TERMINAL_DEPLOYMENT_STATES = new Set(['COMPLETE', 'ROLLED_BACK', 'STOPPED'])
const PROFILE_TYPES = ['AWS.Freeform', 'AWS.AppConfig.FeatureFlags']

interface AppConfigPanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

export function AppConfigPanel({cloud, resource, runtimeReachable}: AppConfigPanelProps) {
    const accountId = useAccountId()

    return (
        <AccountScopedAppConfigPanel
            key={`${accountId}:${cloud}:${resource?.id ?? ''}`}
            accountId={accountId}
            cloud={cloud}
            resource={resource}
            runtimeReachable={runtimeReachable}
        />
    )
}

interface AccountScopedAppConfigPanelProps extends AppConfigPanelProps {
    accountId: string
}

function AccountScopedAppConfigPanel({accountId, cloud, resource, runtimeReachable}: AccountScopedAppConfigPanelProps) {
    const qc = useQueryClient()
    const applicationId = resource?.id
    const [selectedProfileId, setSelectedProfileId] = useState<string>()
    const [selectedVersionNumber, setSelectedVersionNumber] = useState<number>()
    const [environmentName, setEnvironmentName] = useState('')
    const [profileName, setProfileName] = useState('')
    const [profileType, setProfileType] = useState(PROFILE_TYPES[0])
    const [versionContent, setVersionContent] = useState('')
    const [versionContentType, setVersionContentType] = useState('application/json')
    const [versionDescription, setVersionDescription] = useState('')
    const [strategyName, setStrategyName] = useState('')
    const [strategyBake, setStrategyBake] = useState('')
    const [deployEnvironmentId, setDeployEnvironmentId] = useState('')
    const [deployProfileId, setDeployProfileId] = useState('')
    const [deployVersion, setDeployVersion] = useState('')
    const [deployStrategyId, setDeployStrategyId] = useState('')
    const [confirmProfile, setConfirmProfile] = useState<string | null>(null)
    const [confirmVersion, setConfirmVersion] = useState<number | null>(null)
    const [confirmStrategy, setConfirmStrategy] = useState<string | null>(null)
    const [confirmEnvironment, setConfirmEnvironment] = useState<string | null>(null)
    const [activeDeployment, setActiveDeployment] = useState<AppConfigDeployment>()

    const environmentsKey = useMemo(
        () => ['appconfig-environments', accountId, cloud, applicationId],
        [accountId, cloud, applicationId],
    )
    const profilesKey = useMemo(
        () => ['appconfig-profiles', accountId, cloud, applicationId],
        [accountId, cloud, applicationId],
    )
    const versionsKey = useMemo(
        () => ['appconfig-versions', accountId, cloud, applicationId, selectedProfileId],
        [accountId, cloud, applicationId, selectedProfileId],
    )

    const environmentsQuery = useQuery({
        queryKey: environmentsKey,
        queryFn: ({signal}) => listAppConfigEnvironments(cloud, applicationId ?? '', signal),
        enabled: Boolean(applicationId) && runtimeReachable,
    })
    const profilesQuery = useQuery({
        queryKey: profilesKey,
        queryFn: ({signal}) => listAppConfigConfigurationProfiles(cloud, applicationId ?? '', signal),
        enabled: Boolean(applicationId) && runtimeReachable,
    })
    const versionsQuery = useQuery({
        queryKey: versionsKey,
        queryFn: ({signal}) => listAppConfigHostedConfigurationVersions(cloud, applicationId ?? '', selectedProfileId ?? '', signal),
        enabled: Boolean(applicationId && selectedProfileId) && runtimeReachable,
    })
    const deployVersionsQuery = useQuery({
        queryKey: ['appconfig-versions', accountId, cloud, applicationId, deployProfileId],
        queryFn: ({signal}) => listAppConfigHostedConfigurationVersions(cloud, applicationId ?? '', deployProfileId ?? '', signal),
        enabled: Boolean(applicationId && deployProfileId) && runtimeReachable,
    })
    const strategiesQuery = useQuery({
        queryKey: ['appconfig-strategies', accountId, cloud],
        queryFn: ({signal}) => listAppConfigDeploymentStrategies(cloud, signal),
        enabled: runtimeReachable,
    })
    const versionContentQuery = useQuery({
        queryKey: ['appconfig-version-content', accountId, cloud, applicationId, selectedProfileId, selectedVersionNumber],
        queryFn: ({signal}) => getAppConfigHostedConfigurationVersion(cloud, applicationId ?? '', selectedProfileId ?? '', selectedVersionNumber ?? 0, signal),
        enabled: Boolean(applicationId && selectedProfileId && selectedVersionNumber) && runtimeReachable,
    })
    const deploymentQuery = useQuery({
        queryKey: ['appconfig-deployment', accountId, cloud, applicationId, activeDeployment?.environmentId, activeDeployment?.deploymentNumber],
        queryFn: ({signal}) => getAppConfigDeployment(cloud, applicationId ?? '', activeDeployment?.environmentId ?? '', activeDeployment?.deploymentNumber ?? 0, signal),
        enabled: Boolean(applicationId && activeDeployment) && runtimeReachable,
        refetchInterval: (query) => (TERMINAL_DEPLOYMENT_STATES.has(query.state.data?.state ?? '') ? false : 2000),
    })

    const createEnvironmentMut = useMutation({
        mutationFn: () => createAppConfigEnvironment(cloud, applicationId ?? '', {name: environmentName}),
        onSuccess: () => {
            setEnvironmentName('')
            void qc.invalidateQueries({queryKey: environmentsKey})
        },
    })
    const deleteEnvironmentMut = useMutation({
        mutationFn: (environmentId: string) => deleteAppConfigEnvironment(cloud, applicationId ?? '', environmentId),
        onSuccess: (_, environmentId) => {
            if (deployEnvironmentId === environmentId) setDeployEnvironmentId('')
            if (activeDeployment?.environmentId === environmentId) setActiveDeployment(undefined)
            setConfirmEnvironment(null)
            void qc.invalidateQueries({queryKey: environmentsKey})
        },
    })
    const createProfileMut = useMutation({
        mutationFn: () => createAppConfigConfigurationProfile(cloud, applicationId ?? '', {
            name: profileName,
            locationUri: 'hosted',
            type: profileType,
        }),
        onSuccess: (profile) => {
            setProfileName('')
            setSelectedProfileId(profile.id)
            void qc.invalidateQueries({queryKey: profilesKey})
        },
    })
    const deleteProfileMut = useMutation({
        mutationFn: (profileId: string) => deleteAppConfigConfigurationProfile(cloud, applicationId ?? '', profileId),
        onSuccess: (_, profileId) => {
            if (selectedProfileId === profileId) setSelectedProfileId(undefined)
            if (deployProfileId === profileId) {
                setDeployProfileId('')
                setDeployVersion('')
            }
            setConfirmProfile(null)
            void qc.invalidateQueries({queryKey: profilesKey})
        },
    })
    const createVersionMut = useMutation({
        mutationFn: () => createAppConfigHostedConfigurationVersion(cloud, applicationId ?? '', selectedProfileId ?? '', {
            content: versionContent,
            contentType: versionContentType,
            ...(versionDescription.trim() ? {description: versionDescription} : {}),
        }),
        onSuccess: (version) => {
            setSelectedVersionNumber(version.versionNumber)
            setVersionContent('')
            setVersionDescription('')
            void qc.invalidateQueries({queryKey: versionsKey})
            void qc.invalidateQueries({queryKey: ['appconfig-versions', accountId, cloud, applicationId, deployProfileId]})
        },
    })
    const deleteVersionMut = useMutation({
        mutationFn: (versionNumber: number) => deleteAppConfigHostedConfigurationVersion(cloud, applicationId ?? '', selectedProfileId ?? '', versionNumber),
        onSuccess: (_, versionNumber) => {
            if (selectedVersionNumber === versionNumber) setSelectedVersionNumber(undefined)
            if (deployVersion === String(versionNumber)) setDeployVersion('')
            setConfirmVersion(null)
            void qc.invalidateQueries({queryKey: versionsKey})
        },
    })
    const createStrategyMut = useMutation({
        mutationFn: () => createAppConfigDeploymentStrategy(cloud, {
            name: strategyName,
            deploymentDurationInMinutes: 0,
            growthFactor: 100,
            ...(strategyBake.trim() ? {finalBakeTimeInMinutes: Number(strategyBake)} : {}),
        }),
        onSuccess: () => {
            setStrategyName('')
            setStrategyBake('')
            void qc.invalidateQueries({queryKey: ['appconfig-strategies', accountId, cloud]})
        },
    })
    const deleteStrategyMut = useMutation({
        mutationFn: (strategyId: string) => deleteAppConfigDeploymentStrategy(cloud, strategyId),
        onSuccess: (_, strategyId) => {
            if (deployStrategyId === strategyId) setDeployStrategyId('')
            setConfirmStrategy(null)
            void qc.invalidateQueries({queryKey: ['appconfig-strategies', accountId, cloud]})
        },
    })
    const startDeploymentMut = useMutation({
        mutationFn: () => startAppConfigDeployment(cloud, applicationId ?? '', deployEnvironmentId, {
            configurationProfileId: deployProfileId,
            configurationVersion: deployVersion,
            deploymentStrategyId: deployStrategyId,
        }),
        onSuccess: (deployment) => setActiveDeployment(deployment),
    })

    useEffect(() => {
        setSelectedProfileId(undefined)
        setSelectedVersionNumber(undefined)
        setActiveDeployment(undefined)
        setDeployEnvironmentId('')
        setDeployProfileId('')
        setDeployVersion('')
        setDeployStrategyId('')
    }, [cloud, applicationId])

    useEffect(() => {
        setSelectedVersionNumber(undefined)
    }, [selectedProfileId])

    if (cloud !== 'aws') return null

    if (!applicationId) {
        return (
            <section className="cosmos-panel appconfig-panel">
                <div className="empty compact">
                    <h3>Select an application</h3>
                    <p>Environments, configuration profiles, hosted versions, and deployments are loaded after an application is selected.</p>
                </div>
            </section>
        )
    }

    const environments = environmentsQuery.data ?? []
    const profiles = profilesQuery.data ?? []
    const versions = versionsQuery.data ?? []
    const strategies = strategiesQuery.data ?? []
    const deployment = deploymentQuery.data ?? activeDeployment
    const canDeploy = Boolean(deployEnvironmentId && deployProfileId && deployVersion && deployStrategyId) && runtimeReachable

    function submitEnvironment(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (environmentName.trim()) createEnvironmentMut.mutate()
    }

    function submitProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (profileName.trim()) createProfileMut.mutate()
    }

    function submitVersion(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (versionContent.trim()) createVersionMut.mutate()
    }

    function submitStrategy(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (strategyName.trim()) createStrategyMut.mutate()
    }

    return (
        <section className="cosmos-panel appconfig-panel">
            <div className="cosmos-column">
                <ColumnHeader eyebrow="Environments" title={resource?.name ?? ''} detail={`${environments.length} environments`}/>
                <form className="cosmos-inline-form" onSubmit={submitEnvironment}>
                    <input className="input" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="Environment name" disabled={!runtimeReachable}/>
                    <button className="button" type="submit" disabled={!runtimeReachable || createEnvironmentMut.isPending || !environmentName.trim()}>
                        <Plus size={14}/>
                        {createEnvironmentMut.isPending ? 'Creating' : 'Create'}
                    </button>
                </form>
                {createEnvironmentMut.error instanceof Error && <div className="form-error">{createEnvironmentMut.error.message}</div>}
                {environmentsQuery.error instanceof Error && <div className="form-error">{environmentsQuery.error.message}</div>}
                {deleteEnvironmentMut.error instanceof Error && <div className="form-error">{deleteEnvironmentMut.error.message}</div>}
                <div className="cosmos-list">
                    {environmentsQuery.isLoading && <div className="muted padded">Loading environments</div>}
                    {!environmentsQuery.isLoading && environments.length === 0 && <div className="muted padded">No environments</div>}
                    {environments.map((environment) => (
                        <button
                            key={environment.id}
                            className={`cosmos-list-row ${deployEnvironmentId === environment.id ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setDeployEnvironmentId(environment.id)}
                        >
                            <span>
                                <strong>{environment.name}</strong>
                                <small>{[environment.state, environment.description].filter(Boolean).join(' · ') || 'No details'}</small>
                            </span>
                            {confirmEnvironment === environment.id ? (
                                <em
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        deleteEnvironmentMut.mutate(environment.id)
                                    }}
                                >
                                    Confirm
                                </em>
                            ) : (
                                <Trash2
                                    size={13}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        setConfirmEnvironment(environment.id)
                                    }}
                                />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="cosmos-column">
                <ColumnHeader eyebrow="Configuration profiles" title="Profiles" detail={`${profiles.length} profiles`}/>
                <form className="cosmos-inline-form" onSubmit={submitProfile}>
                    <input className="input" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Profile name" disabled={!runtimeReachable}/>
                    <select className="input" value={profileType} onChange={(event) => setProfileType(event.target.value)} disabled={!runtimeReachable}>
                        {PROFILE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <button className="button" type="submit" disabled={!runtimeReachable || createProfileMut.isPending || !profileName.trim()}>
                        <Plus size={14}/>
                        {createProfileMut.isPending ? 'Creating' : 'Create'}
                    </button>
                </form>
                {createProfileMut.error instanceof Error && <div className="form-error">{createProfileMut.error.message}</div>}
                {profilesQuery.error instanceof Error && <div className="form-error">{profilesQuery.error.message}</div>}
                {deleteProfileMut.error instanceof Error && <div className="form-error">{deleteProfileMut.error.message}</div>}
                <div className="cosmos-list">
                    {profilesQuery.isLoading && <div className="muted padded">Loading profiles</div>}
                    {!profilesQuery.isLoading && profiles.length === 0 && <div className="muted padded">No configuration profiles</div>}
                    {profiles.map((profile) => (
                        <button
                            key={profile.id}
                            className={`cosmos-list-row ${selectedProfileId === profile.id ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setSelectedProfileId(profile.id)}
                        >
                            <span>
                                <strong>{profile.name}</strong>
                                <small>{profile.type ?? 'Unknown type'}</small>
                            </span>
                            {confirmProfile === profile.id ? (
                                <em
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        deleteProfileMut.mutate(profile.id)
                                    }}
                                >
                                    Confirm
                                </em>
                            ) : (
                                <Trash2
                                    size={13}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        setConfirmProfile(profile.id)
                                    }}
                                />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="cosmos-column cosmos-column--wide">
                <ColumnHeader
                    eyebrow="Hosted configuration versions"
                    title={profiles.find((profile) => profile.id === selectedProfileId)?.name ?? 'Select profile'}
                    detail={`${versions.length} versions`}
                />
                <form className="cosmos-inline-form" onSubmit={submitVersion}>
                    <input className="input" value={versionContentType} onChange={(event) => setVersionContentType(event.target.value)} placeholder="Content type" disabled={!runtimeReachable}/>
                    <input className="input" value={versionDescription} onChange={(event) => setVersionDescription(event.target.value)} placeholder="Description (optional)" disabled={!runtimeReachable}/>
                    <button className="button" type="submit" disabled={!selectedProfileId || !runtimeReachable || createVersionMut.isPending || !versionContent.trim()}>
                        <Plus size={14}/>
                        {createVersionMut.isPending ? 'Saving' : 'Create version'}
                    </button>
                </form>
                <textarea
                    className="textarea code-textarea"
                    value={versionContent}
                    onChange={(event) => setVersionContent(event.target.value)}
                    placeholder={selectedProfileId ? 'Configuration content' : 'Select a profile to add a version'}
                    spellCheck={false}
                    disabled={!selectedProfileId || !runtimeReachable}
                />
                {createVersionMut.error instanceof Error && <div className="form-error">{createVersionMut.error.message}</div>}
                {versionsQuery.error instanceof Error && <div className="form-error">{versionsQuery.error.message}</div>}
                {deleteVersionMut.error instanceof Error && <div className="form-error">{deleteVersionMut.error.message}</div>}
                <div className="cosmos-items-table">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Version</th>
                                <th>Content type</th>
                                <th>Description</th>
                                <th aria-label="Actions"/>
                            </tr>
                        </thead>
                        <tbody>
                            {versions.map((version) => (
                                <tr key={version.id} className={selectedVersionNumber === version.versionNumber ? 'selected' : ''}>
                                    <td onClick={() => setSelectedVersionNumber(version.versionNumber)}>{version.versionNumber}</td>
                                    <td onClick={() => setSelectedVersionNumber(version.versionNumber)}>{version.contentType ?? '-'}</td>
                                    <td onClick={() => setSelectedVersionNumber(version.versionNumber)}>{version.description ?? '-'}</td>
                                    <td className="table-actions">
                                        {confirmVersion === version.versionNumber ? (
                                            <button className="button danger compact" type="button" onClick={() => deleteVersionMut.mutate(version.versionNumber)}>Confirm</button>
                                        ) : (
                                            <button className="icon-btn danger" type="button" title={`Delete version ${version.versionNumber}`} onClick={() => setConfirmVersion(version.versionNumber)}>
                                                <Trash2 size={13}/>
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {selectedProfileId && !versionsQuery.isLoading && versions.length === 0 && (
                        <div className="empty compact"><h3>No hosted versions</h3><p>Create a version to store configuration content.</p></div>
                    )}
                </div>
                {selectedVersionNumber !== undefined && (
                    <>
                        <div className="muted padded">Version {selectedVersionNumber} content</div>
                        {versionContentQuery.isLoading && <div className="muted padded">Loading content</div>}
                        {versionContentQuery.error instanceof Error && <div className="form-error">{versionContentQuery.error.message}</div>}
                        {versionContentQuery.data?.content != null && (
                            <pre className="cosmos-query-result">{versionContentQuery.data.content}</pre>
                        )}
                    </>
                )}
            </div>

            <div className="cosmos-column">
                <ColumnHeader eyebrow="Deploy" title="Deployment" detail="Deploys a hosted version to an environment"/>
                <form className="cosmos-inline-form" onSubmit={(event) => {
                    event.preventDefault()
                    if (canDeploy) startDeploymentMut.mutate()
                }}>
                    <select className="input" value={deployEnvironmentId} onChange={(event) => setDeployEnvironmentId(event.target.value)} disabled={!runtimeReachable}>
                        <option value="">Select environment</option>
                        {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                    </select>
                    <select className="input" value={deployProfileId} onChange={(event) => {
                        setDeployProfileId(event.target.value)
                        setDeployVersion('')
                    }} disabled={!runtimeReachable}>
                        <option value="">Select profile</option>
                        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                    <select className="input" value={deployVersion} onChange={(event) => setDeployVersion(event.target.value)} disabled={!runtimeReachable || !deployProfileId}>
                        <option value="">Select version</option>
                        {(deployVersionsQuery.data ?? []).map((version) => (
                            <option key={version.id} value={String(version.versionNumber)}>v{version.versionNumber}</option>
                        ))}
                    </select>
                    <select className="input" value={deployStrategyId} onChange={(event) => setDeployStrategyId(event.target.value)} disabled={!runtimeReachable}>
                        <option value="">Select strategy</option>
                        {strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}
                    </select>
                    <button className="button primary" type="submit" disabled={!canDeploy || startDeploymentMut.isPending}>
                        <Rocket size={14}/>
                        {startDeploymentMut.isPending ? 'Deploying' : 'Start deployment'}
                    </button>
                </form>
                {startDeploymentMut.error instanceof Error && <div className="form-error">{startDeploymentMut.error.message}</div>}
                {deployment && (
                    <div className="cosmos-list">
                        <div className="cosmos-list-row">
                            <span>
                                <strong>Deployment #{deployment.deploymentNumber}</strong>
                                <small>
                                    {deployment.state ?? 'Unknown state'}
                                    {deployment.percentageComplete !== null ? ` · ${deployment.percentageComplete}%` : ''}
                                </small>
                            </span>
                            {!TERMINAL_DEPLOYMENT_STATES.has(deployment.state ?? '') && (
                                <button className="icon-btn" type="button" title="Refresh deployment" onClick={() => deploymentQuery.refetch()}>
                                    <RefreshCw size={13}/>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <ColumnHeader eyebrow="Strategies" title="Deployment strategies" detail={`${strategies.length} strategies`}/>
                <form className="cosmos-inline-form" onSubmit={submitStrategy}>
                    <input className="input" value={strategyName} onChange={(event) => setStrategyName(event.target.value)} placeholder="Immediate strategy name" disabled={!runtimeReachable}/>
                    <input className="input" type="number" min={0} value={strategyBake} onChange={(event) => setStrategyBake(event.target.value)} placeholder="Bake min" disabled={!runtimeReachable}/>
                    <button className="button" type="submit" disabled={!runtimeReachable || createStrategyMut.isPending || !strategyName.trim()}>
                        <Plus size={14}/>
                        {createStrategyMut.isPending ? 'Creating' : 'Create'}
                    </button>
                </form>
                {createStrategyMut.error instanceof Error && <div className="form-error">{createStrategyMut.error.message}</div>}
                {strategiesQuery.error instanceof Error && <div className="form-error">{strategiesQuery.error.message}</div>}
                {deleteStrategyMut.error instanceof Error && <div className="form-error">{deleteStrategyMut.error.message}</div>}
                <div className="cosmos-list">
                    {strategiesQuery.isLoading && <div className="muted padded">Loading strategies</div>}
                    {!strategiesQuery.isLoading && strategies.length === 0 && <div className="muted padded">No deployment strategies</div>}
                    {strategies.map((strategy) => (
                        <div key={strategy.id} className="cosmos-list-row">
                            <span>
                                <strong>{strategy.name}</strong>
                                <small>
                                    {strategy.deploymentDurationInMinutes ?? 0} min · growth {strategy.growthFactor ?? 0}% · bake {strategy.finalBakeTimeInMinutes ?? 0} min
                                </small>
                            </span>
                            {confirmStrategy === strategy.id ? (
                                <em role="button" tabIndex={0} onClick={() => deleteStrategyMut.mutate(strategy.id)}>Confirm</em>
                            ) : (
                                <Trash2 size={13} onClick={() => setConfirmStrategy(strategy.id)}/>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function ColumnHeader({eyebrow, title, detail}: {eyebrow: string; title: string; detail: string}) {
    return (
        <div className="cosmos-panel-header">
            <SlidersHorizontal size={15}/>
            <span>
                <small>{eyebrow}</small>
                <strong>{title}</strong>
                <em>{detail}</em>
            </span>
        </div>
    )
}
