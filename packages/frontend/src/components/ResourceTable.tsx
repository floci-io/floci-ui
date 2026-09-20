import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Pencil, Trash2} from 'lucide-react';
import type {CloudResource} from '@/types/resource';
import type {ServiceSchema} from '@/types/schema';
import {getPath} from '@/lib/resourcePath';
import {renderColumnValue} from '@/lib/columnFormat';

interface ResourceTableProps {
  schema: ServiceSchema;
  resources: CloudResource[];
  selectedId?: string;
  onSelect: (resource: CloudResource) => void;
  onEdit?: (resource: CloudResource) => void;
  onDelete: (resource: CloudResource) => void;
  deletingId?: string;
  dataPath?: (resource: CloudResource) => string | undefined;
}

export function ResourceTable({
  schema,
  resources,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  deletingId,
  dataPath,
}: ResourceTableProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const canDelete = schema.actions.includes('delete');
  const canEdit = schema.actions.includes('update') && Boolean(schema.updateFields?.length) && Boolean(onEdit);
  const hasActions = canDelete || canEdit || Boolean(dataPath && resources.some((resource) => dataPath(resource)));

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
            <th key={column.name} style={column.width ? {width: column.width} : undefined}>
              {column.label}
            </th>
          ))}
          {hasActions && <th aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {resources.map((resource) => {
          const explorePath = dataPath?.(resource);
          return (
          <tr key={resource.id} className={selectedId === resource.id ? 'selected' : ''}>
            {schema.columns.map((column) => (
              <td key={column.name} onClick={() => onSelect(resource)}>
                {renderColumnValue(getPath(resource, column.path ?? column.name), column)}
              </td>
            ))}
            {hasActions && (
              <td className="table-actions">
                {explorePath && (
                  <Link className="button compact" to={explorePath} aria-label={`Explore data in ${resource.name}`}>
                    Explore data
                  </Link>
                )}
                {canEdit && (
                  <button
                    className="icon-btn"
                    type="button"
                    title={`Edit ${resource.name}`}
                    aria-label={`Edit ${resource.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit?.(resource);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {canDelete && (
                  confirmId === resource.id ? (
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
                      aria-label={`Delete ${resource.name}`}
                      disabled={deletingId === resource.id}
                      onClick={() => setConfirmId(resource.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )
                )}
              </td>
            )}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

