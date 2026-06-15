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

export function createCloudProxyService(): CloudProxyService {
    const registry = new CloudAdapterRegistry([
        new AwsStorageAdapter(),
        new AwsEksAdapter(),
        new AwsDatabaseAdapter(),
        new AwsComputeAdapter(),
        new AwsNetworkingAdapter(),
        new AwsServerlessAdapter(),
        new AzureStorageAdapter(),
        new AzureDatabaseAdapter(),
        new GcpStorageAdapter(),
        new AzureServerlessAdapter(),
    ])

    return new CloudProxyService(registry)
}
