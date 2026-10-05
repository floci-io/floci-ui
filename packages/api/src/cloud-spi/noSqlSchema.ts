import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const noSqlFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const noSqlColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'engine', label: 'Engine'},
    {name: 'status', label: 'Status'},
    {name: 'createdAt', label: 'Created At'},
]

export function azureNoSqlSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'nosql',
        displayName: 'Azure Cosmos DB NoSQL',
        fields: [
            {
                name: 'databaseName',
                label: 'Database Name',
                type: 'text',
                required: true,
                validation: {
                    minLength: 1,
                    maxLength: 255,
                    pattern: '^[A-Za-z0-9._-]+$',
                    message: 'Use letters, numbers, dot, underscore, or dash.',
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List Cosmos databases', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create Cosmos database', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete Cosmos database', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect metadata', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: noSqlFilters,
        columns: noSqlColumns,
    }
}

const gcpFirestoreColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Collection'},
    {name: 'documentCount', label: 'Documents', path: 'metadata.documentCount'},
    {name: 'database', label: 'Database', path: 'metadata.database', format: 'code'},
]

export function gcpNoSqlSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'nosql',
        displayName: 'Firestore',
        fields: [
            {
                name: 'collectionId',
                label: 'Collection ID',
                type: 'text',
                required: true,
                description: 'A Firestore collection exists once it holds a document, so creating one also creates its first document.',
                validation: {
                    minLength: 1,
                    maxLength: 1500,
                    pattern: '^(?!\\.{1,2}$)(?!__.*__$)[^/]+$',
                    message: 'Use a non-empty ID without "/", not "." or "..", and not of the form __name__.',
                },
            },
            {
                name: 'documentId',
                label: 'Document ID',
                type: 'text',
                required: false,
                description: 'Leave empty to let Firestore generate an ID.',
                validation: {
                    maxLength: 1500,
                    pattern: '^((?!\\.{1,2}$)(?!__.*__$)[^/]+)?$',
                    message: 'Use an ID without "/", not "." or "..", and not of the form __name__.',
                },
            },
            {
                name: 'document',
                label: 'Document (JSON)',
                type: 'textarea',
                required: false,
                span: true,
                description: 'A JSON object with the fields of the first document. Empty creates a document with no fields.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List collections', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create collection', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete collection', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect collection', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: noSqlFilters,
        columns: gcpFirestoreColumns,
    }
}
