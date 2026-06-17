import {CloudAdapterRegistry} from './registry/CloudAdapterRegistry'
import {AwsComputeAdapter} from './adapter-aws/AwsComputeAdapter'
import {AwsNetworkingAdapter} from './adapter-aws/AwsNetworkingAdapter'
import {AwsDatabaseAdapter} from './adapter-aws/AwsDatabaseAdapter'
import {AwsEksAdapter} from './adapter-aws/AwsEksAdapter'
import {AwsStorageAdapter} from './adapter-aws/AwsStorageAdapter'
import {AzureDatabaseAdapter} from './adapter-azure/AzureDatabaseAdapter'
import {AzureStorageAdapter} from './adapter-azure/AzureStorageAdapter'
import {GcpStorageAdapter} from './adapter-gcp/GcpStorageAdapter'
import {CloudProxyService} from './service/CloudProxyService'
import {AzureServerlessAdapter} from './adapter-azure/AzureServerlessAdapter'
import {AwsServerlessAdapter} from './adapter-aws/AwsServerlessAdapter'
import {awsClientsForAccount, resolveAccountId} from './aws'
import {createEc2Service} from './services/ec2'
import {createEksService} from './services/eks'
import {createRdsService} from './services/rds'

/**
 * Build a CloudProxyService whose AWS adapters are bound to a specific account.
 * The account id drives the AWS SDK credentials (see aws.ts), so every AWS call
 * the returned service makes is isolated to that account. Azure and GCP adapters
 * use their own runtime auth model and are account-neutral.
 */
export function createCloudProxyService(accountId?: string | null): CloudProxyService {
    const clients = awsClientsForAccount(accountId)
    const ec2Service = createEc2Service(clients.ec2)

    const registry = new CloudAdapterRegistry([
        new AwsStorageAdapter(clients.s3),
        new AwsEksAdapter(createEksService(clients.eks)),
        new AwsDatabaseAdapter(createRdsService(clients.rds), clients.rds),
        new AwsComputeAdapter(ec2Service),
        new AwsNetworkingAdapter(ec2Service),
        new AwsServerlessAdapter(clients.lambda),
        new AzureStorageAdapter(),
        new AzureDatabaseAdapter(),
        new GcpStorageAdapter(),
        new AzureServerlessAdapter(),
    ])

    return new CloudProxyService(registry)
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
