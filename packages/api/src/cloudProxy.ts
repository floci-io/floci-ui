import {CloudAdapterRegistry} from './registry/CloudAdapterRegistry'
import {AwsComputeAdapter} from './adapter-aws/AwsComputeAdapter'
import {AwsNetworkingAdapter} from './adapter-aws/AwsNetworkingAdapter'
import {AwsDatabaseAdapter} from './adapter-aws/AwsDatabaseAdapter'
import {AwsEksAdapter} from './adapter-aws/AwsEksAdapter'
import {AwsStorageAdapter} from './adapter-aws/AwsStorageAdapter'
import {AzureDatabaseAdapter} from './adapter-azure/AzureDatabaseAdapter'
import {AzureStorageAdapter} from './adapter-azure/AzureStorageAdapter'
import {AzureNetworkingAdapter} from './adapter-azure/AzureNetworkingAdapter'
import {GcpStorageAdapter} from './adapter-gcp/GcpStorageAdapter'
import {GcpCloudFunctionsAdapter} from './adapter-gcp/GcpCloudFunctionsAdapter'
import {GcpCloudSqlAdapter} from './adapter-gcp/GcpCloudSqlAdapter'
import {GcpGkeAdapter} from './adapter-gcp/GcpGkeAdapter'
import {CloudProxyService} from './service/CloudProxyService'
import {AzureServerlessAdapter} from './adapter-azure/AzureServerlessAdapter'
import {AzureKeyVaultAdapter} from './adapter-azure/AzureKeyVaultAdapter'
import {AwsServerlessAdapter} from './adapter-aws/AwsServerlessAdapter'
import {awsClientsForAccount, resolveAccountId} from './aws'
import {createEc2Service} from './services/ec2'
import {createEksService} from './services/eks'
import {createRdsService} from './services/rds'

/**
 * Build the adapter registry for an account. The account id drives the AWS SDK
 * credentials (see aws.ts), so every AWS call is isolated to that account; Azure
 * and GCP adapters use their own runtime auth model and are account-neutral.
 *
 * Exported separately from the service so tests can assert registry contents —
 * notably that every adapter implements what its schema advertises — without
 * reaching into private state.
 */
export function createCloudAdapterRegistry(accountId?: string | null): CloudAdapterRegistry {
    const clients = awsClientsForAccount(accountId)
    const ec2Service = createEc2Service(clients.ec2)

    return new CloudAdapterRegistry([
        new AwsStorageAdapter(clients.s3),
        new AwsEksAdapter(createEksService(clients.eks)),
        new AwsDatabaseAdapter(createRdsService(clients.rds), clients.rds),
        new AwsComputeAdapter(ec2Service),
        new AwsNetworkingAdapter(ec2Service),
        new AwsServerlessAdapter(clients.lambda),
        new AzureStorageAdapter(),
        new AzureDatabaseAdapter(),
        new AzureNetworkingAdapter(),
        new GcpStorageAdapter(),
        new GcpCloudFunctionsAdapter(),
        new GcpCloudSqlAdapter(),
        new GcpGkeAdapter(),
        new AzureServerlessAdapter(),
        new AzureKeyVaultAdapter(),
    ])
}

export function createCloudProxyService(accountId?: string | null): CloudProxyService {
    return new CloudProxyService(createCloudAdapterRegistry(accountId))
}

const serviceCache = new Map<string, CloudProxyService>()

/** Return a cached account-scoped CloudProxyService, building it on first use. */
export function serviceForAccount(accountId?: string | null): CloudProxyService {
    const id = resolveAccountId(accountId)
    let service = serviceCache.get(id)
    if (!service) {
        service = createCloudProxyService(id)
        serviceCache.set(id, service)
    }
    return service
}
