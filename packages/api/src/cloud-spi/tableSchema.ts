import type {ServiceSchema} from './types'

export function azureTableSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'table',
        displayName: 'Azure Table Storage',
        fields: [{
            name: 'tableName',
            label: 'Table Name',
            type: 'text',
            required: true,
            description: '3-63 letters and numbers, starting with a letter. The name "tables" is reserved.',
            validation: {
                pattern: '^(?![Tt][Aa][Bb][Ll][Ee][Ss]$)[A-Za-z][A-Za-z0-9]{2,62}$',
                minLength: 3,
                maxLength: 63,
                message: 'Use 3-63 letters and numbers, starting with a letter. The name "tables" is reserved.',
            },
        }],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List tables', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create table', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete table', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect table', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'Table Name'},
            {name: 'cloud', label: 'Cloud'},
        ],
    }
}
