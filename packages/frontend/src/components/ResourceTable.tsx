import {useState} from 'react';
import {Trash2} from 'lucide-react';
import type {CloudResource} from '@/types/resource';
import type {ServiceSchema} from '@/types/schema';

interface ResourceTableProps {
  schema: ServiceSchema;
  resources: CloudResource[];
  selectedId?: string;
  onSelect: (resource: CloudResource) => void;
  onDelete: (resource: CloudResource) => void;
  deletingId?: string;
}

export function ResourceTable({
  schema,
  resources,
  selectedId,
  onSelect,
  onDelete,
  deletingId,
}: ResourceTableProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const canDelete = schema.actions.includes('delete');

  if (resources.length === 0) {
    const emptyTitle = `No ${schema.displayName} found.`;
    const emptyDescription = `The connected runtime did not return any ${schema.displayName} resources.`;
    return (
      <div className="empty compact">
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <table className="table resource-table">
      <thead>
        <tr>
          {schema.columns.map((column) => (
            <th key={column.name}>{column.label}</th>
          ))}
          {canDelete && <th aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {resources.map((resource) => (
          <tr key={resource.id} className={selectedId === resource.id ? 'selected' : ''}>
            {schema.columns.map((column) => (
              <td key={column.name} onClick={() => onSelect(resource)}>
                {formatValue(resource[column.name as keyof CloudResource])}
              </td>
            ))}
            {canDelete && (
              <td className="table-actions">
                {confirmId === resource.id ? (
                  <button
                    className="button danger compact"
                    type="button"
                    disabled={deletingId === resource.id}
                    onClick={() => {
                      onDelete(resource);
                      setConfirmId(null);
                    }}
                  >
                    Confirm
                  </button>
                ) : (
                  <button
                    className="icon-btn danger"
                    type="button"
                    title={`Delete ${resource.name}`}
                    disabled={deletingId === resource.id}
                    onClick={() => setConfirmId(resource.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}
