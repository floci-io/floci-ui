import type {CloudResource} from '@/types/resource'

export function dataExplorerKind(resource: CloudResource): 'dynamodb' | 'cosmos' | 'sql' | undefined {
    if (resource.cloud === 'aws' && resource.service === 'nosql' && resource.type === 'dynamodb-table') return 'dynamodb'
    if (resource.cloud === 'azure' && resource.service === 'nosql' && resource.type === 'cosmos-database') return 'cosmos'
    if (resource.cloud === 'azure' && resource.service === 'database' &&
        (resource.type === 'sql-server' || resource.type === 'postgres-flexible-server')) return 'sql'
}

export function dataExplorerPath(resource: CloudResource): string | undefined {
    if (!dataExplorerKind(resource)) return undefined
    return `/cloud-explorer/${resource.cloud}/${resource.service}/${encodeURIComponent(resource.id)}/data`
}
