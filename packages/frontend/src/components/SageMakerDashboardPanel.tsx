import {RefreshCw} from 'lucide-react'
import type {CloudResource} from '@/types/resource'

interface SageMakerDashboardPanelProps {
    resources: CloudResource[]
    isRefreshing: boolean
    updatedAt: number
    onRefresh: () => void
}

export function SageMakerDashboardPanel({resources, isRefreshing, updatedAt, onRefresh}: SageMakerDashboardPanelProps) {
    const modelCount = countType(resources, 'sagemaker-model')
    const endpointConfigCount = countType(resources, 'sagemaker-endpoint-config')
    const endpointCount = countType(resources, 'sagemaker-endpoint')
    const inServiceEndpoints = resources.filter((resource) => resource.type === 'sagemaker-endpoint' && resource.status === 'InService').length
    const trainingJobCount = countType(resources, 'sagemaker-training-job')
    const completedTrainingJobs = resources.filter((resource) => resource.type === 'sagemaker-training-job' && resource.status === 'Completed').length
    const runningTrainingJobs = resources.filter((resource) => resource.type === 'sagemaker-training-job' && resource.status === 'InProgress').length
    const failedTrainingJobs = resources.filter((resource) => resource.type === 'sagemaker-training-job' && resource.status === 'Failed').length

    return (
        <section className="sagemaker-dashboard" aria-label="SageMaker AI dashboard">
            <div className="sagemaker-dashboard-header">
                <div>
                    <h3>All active resources</h3>
                    <p>A current view of your SageMaker AI resources.</p>
                </div>
                <div className="sagemaker-refresh">
                    <span>Last updated<br/>{updatedAt ? new Date(updatedAt).toLocaleString() : 'Never'}</span>
                    <button className="icon-button" type="button" disabled={isRefreshing} onClick={onRefresh} aria-label="Refresh SageMaker AI resources">
                        <RefreshCw size={18}/>
                    </button>
                </div>
            </div>

            <div className="sagemaker-card-grid">
                <DashboardCard
                    title="Training"
                    rows={[
                        {label: 'Training jobs', value: trainingJobCount, status: 'Total'},
                        {label: 'Completed training jobs', value: completedTrainingJobs, status: 'Completed'},
                        {label: 'Running training jobs', value: runningTrainingJobs, status: 'Running'},
                        {label: 'Failed training jobs', value: failedTrainingJobs, status: 'Failed'},
                    ]}
                />
                <DashboardCard
                    title="Model monitoring"
                    rows={[
                        {label: 'Models', value: modelCount, status: 'Active'},
                        {label: 'Model cards', soon: true},
                    ]}
                />
                <DashboardCard
                    title="Inference"
                    rows={[
                        {label: 'Endpoint configs', value: endpointConfigCount, status: 'Created'},
                        {label: 'Endpoints', value: endpointCount, status: 'Created'},
                        {label: 'In-service endpoints', value: inServiceEndpoints, status: 'InService'},
                    ]}
                />
            </div>
        </section>
    )
}

function DashboardCard({title, soon = false, rows}: {title: string; soon?: boolean; rows: Array<{label: string; value?: number; status?: string; soon?: boolean}>}) {
    return (
        <article className="sagemaker-card">
            <h4>
                {title}
                {soon && <span className="coming-soon-pill">Soon</span>}
            </h4>
            <div className="sagemaker-card-rows">
                {rows.map((row) => (
                    <div className="sagemaker-card-row" key={`${title}:${row.label}`}>
                        <span>{row.label}</span>
                        {row.soon && <strong className="sagemaker-row-soon">Soon</strong>}
                        {row.value !== undefined && row.status && <strong>{row.value} <em>{row.status}</em></strong>}
                    </div>
                ))}
            </div>
        </article>
    )
}

function countType(resources: CloudResource[], type: string): number {
    return resources.filter((resource) => resource.type === type).length
}
