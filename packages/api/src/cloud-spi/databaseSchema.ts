import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const databaseColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'Status'},
    {name: 'engine', label: 'Engine'},
    {name: 'version', label: 'Version'},
    {name: 'instanceClass', label: 'Class'},
]

/** Cloud SQL reports a connection endpoint, which RDS does not surface here. */
const cloudSqlColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'engine', label: 'Version'},
    {name: 'region', label: 'Region'},
    {name: 'instanceClass', label: 'Tier'},
    {name: 'connectionName', label: 'Connection', path: 'metadata.connectionName', format: 'code'},
]

const databaseFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsDatabaseSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'database',
        displayName: 'AWS RDS',
        fields: [
            {
                name: 'dbInstanceIdentifier',
                label: 'DB Instance Identifier',
                type: 'text',
                required: true,
                validation: {
                    pattern: '^(?!.*--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$',
                    minLength: 1,
                    maxLength: 63,
                },
            },
            {
                name: 'engine',
                label: 'Engine',
                type: 'select',
                required: true,
                defaultValue: 'postgres',
                options: [
                    {label: 'PostgreSQL', value: 'postgres'},
                    {label: 'MySQL', value: 'mysql'},
                    {label: 'MariaDB', value: 'mariadb'},
                ],
            },
            {
                name: 'masterUserPassword',
                label: 'Master User Password',
                type: 'password',
                required: true,
                span: true,
                validation: {minLength: 8, maxLength: 128},
            },
            {
                name: 'dbInstanceClass',
                label: 'DB Instance Class',
                type: 'text',
                required: false,
                defaultValue: 'db.t3.micro',
            },
            {
                name: 'allocatedStorage',
                label: 'Allocated Storage',
                type: 'text',
                required: false,
                defaultValue: '20',
                validation: {pattern: '^[1-9][0-9]*$'},
            },
            {
                name: 'masterUsername',
                label: 'Master Username',
                type: 'text',
                required: false,
                defaultValue: 'root',
                validation: {maxLength: 63},
            },
            {
                name: 'dbName',
                label: 'Database Name',
                type: 'text',
                required: false,
                defaultValue: '',
                validation: {maxLength: 64},
            },
            {
                name: 'engineVersion',
                label: 'Engine Version',
                type: 'text',
                required: false,
                defaultValue: '',
            },
            {
                name: 'securityGroupIds',
                label: 'Security Group IDs',
                type: 'text',
                required: false,
                span: true,
                description: 'One or more SG IDs separated by commas — e.g. sg-111, sg-222',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List DB instances', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create DB instance', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete DB instance', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect DB instance', enabled: true, status: 'available', runtimeRequired: true},
            ],
            databaseActions: [
                {
                    name: 'listSnapshots',
                    label: 'List DB snapshots',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {
                    name: 'createSnapshot',
                    label: 'Create DB snapshot',
                    enabled: true,
                    status: 'partial',
                    reason: 'The Cloud Proxy operation is available, but the current Floci runtime does not implement CreateDBSnapshot.',
                    runtimeRequired: true,
                },
            ],
        },
        filters: databaseFilters,
        columns: databaseColumns,
    }
}

export function azureDatabaseSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'database',
        displayName: 'Azure Databases',
        fields: [
            {
                name: 'engine',
                label: 'Database Engine',
                type: 'select',
                required: true,
                defaultValue: 'azure-sql',
                options: [
                    {label: 'Azure SQL Database', value: 'azure-sql'},
                    {label: 'Azure Database for PostgreSQL', value: 'postgresql'},
                ],
            },
            {
                name: 'serverName',
                label: 'Server Name',
                type: 'text',
                required: true,
                validation: {
                    minLength: 1,
                    maxLength: 63,
                    pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$',
                    message: 'Use 1-63 lowercase letters, numbers, or hyphens.',
                },
            },
            {
                name: 'location',
                label: 'Location',
                type: 'text',
                required: true,
                defaultValue: 'eastus',
            },
            {
                name: 'administratorLogin',
                label: 'Administrator Login',
                type: 'text',
                required: true,
                defaultValue: 'sa',
            },
            {
                name: 'administratorLoginPassword',
                label: 'Administrator Password',
                type: 'password',
                required: true,
                span: true,
                description: 'Required by the local database runtime. The value is not returned by the API.',
                validation: {
                    minLength: 8,
                    message: 'Use at least 8 characters.',
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List database servers', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create database server', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete database server', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect metadata', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: databaseFilters,
        columns: [
            {name: 'name', label: 'Name'},
            {name: 'engine', label: 'Engine'},
            {name: 'status', label: 'Status'},
            {name: 'region', label: 'Region'},
        ],
    }
}

export function gcpDatabaseSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'database',
        displayName: 'Cloud SQL',
        fields: [
            {
                name: 'instanceName',
                label: 'Instance Name',
                type: 'text',
                required: true,
                description: 'Lowercase letters, numbers, and hyphens; must start with a letter.',
            },
            {
                name: 'databaseVersion',
                label: 'Database Version',
                type: 'select',
                required: false,
                // The runtime backs instances with real Postgres containers and
                // rejects every other engine, so this is not the full GCP list.
                description: 'The local runtime supports PostgreSQL only.',
                options: [
                    {label: 'PostgreSQL 15', value: 'POSTGRES_15'},
                    {label: 'PostgreSQL 16', value: 'POSTGRES_16'},
                ],
            },
            {
                name: 'region',
                label: 'Region',
                type: 'text',
                required: false,
                description: 'Defaults to us-central1.',
            },
            {
                name: 'tier',
                label: 'Machine Tier',
                type: 'text',
                required: false,
                description: 'Defaults to db-f1-micro.',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: databaseFilters,
        columns: cloudSqlColumns,
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List instances', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create instance', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete instance', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect instance', enabled: true, status: 'available', runtimeRequired: false},
            ],
        },
    }
}
