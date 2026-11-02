import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Icon, PencilSquared as Pencil, Trash2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import type {CloudResource} from '@/types/resource';
import type {ServiceSchema} from '@/types/schema';
import {getPath} from '@/lib/resourcePath';
import {renderColumnValue} from '@/lib/columnFormat';
import {Checkbox} from '@/components/sodium/ui/checkbox'
import {EmptyState} from '@/components/EmptyState'
import {Hint} from '@/components/Hint'

interface ResourceTableProps {
  schema: ServiceSchema;
  resources: CloudResource[];
  selectedId?: string;
  onSelect: (resource: CloudResource) => void;
  onEdit?: (resource: CloudResource) => void;
  onDelete: (resource: CloudResource) => void;
  deletingId?: string;
  dataPath?: (resource: CloudResource) => string | undefined;
  isDeleteMulti?: boolean;
  selectedItems?: CloudResource[];
  onToggleSelect?: (resource: CloudResource) => void;
  onToggleSelectAll?: () => void;
  setAllSelected?: (value: boolean) => void;
  isAllSelected?: boolean;
  canDeleteResource?: (resource: CloudResource) => boolean;
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
  isDeleteMulti,
  selectedItems,
  onToggleSelect,
  onToggleSelectAll,
  setAllSelected,
  isAllSelected = false,
  canDeleteResource,
}: ResourceTableProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const canDelete = schema.actions.includes('delete');
  const canEdit = schema.actions.includes('update') && Boolean(schema.updateFields?.length) && Boolean(onEdit);
  const rowCanDelete = (resource: CloudResource) => canDelete && (canDeleteResource?.(resource) ?? true);
  const hasActions = canEdit
    || resources.some((resource) => rowCanDelete(resource))
    || Boolean(dataPath && resources.some((resource) => dataPath(resource)));

  if (resources.length === 0) {
    const emptyTitle = `No ${schema.displayName} found.`;
    const emptyDescription = `The connected runtime did not return any ${schema.displayName} resources.`;
    return (
      <EmptyState compact title={<>{emptyTitle}</>} description={<>{emptyDescription}</>}/>
    );
  }

  return (
    <div className="table-scroll">
      <table className="table resource-table">
        <thead>
          <tr>
            {isDeleteMulti && (
              <th className="w-[1%]">
                <Checkbox
                  aria-label="Select all resources"
                  checked={isAllSelected && resources.length > 0}
                  onCheckedChange={() => {
                    if (onToggleSelectAll) {
                      onToggleSelectAll();
                    } else {
                      setAllSelected?.(!isAllSelected);
                    }
                  }}
                />
              </th>
            )}
            {schema.columns.map((column) => (
              <th key={column.name} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </th>
            ))}
            {hasActions && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {resources.map((resource) => {
            const explorePath = dataPath?.(resource);
            const canDeleteRow = rowCanDelete(resource);
            return (
              <tr key={resource.id} className={selectedId === resource.id ? 'selected' : ''}>
                {isDeleteMulti && (
                  <td className="w-[1%]" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${resource.name || resource.id}`}
                      checked={canDeleteRow && (selectedItems?.some((item) => item.id === resource.id) ?? false)}
                      disabled={!canDeleteRow}
                      title={canDeleteRow ? undefined : `${resource.name} cannot be deleted`}
                      onCheckedChange={() => {
                        onToggleSelect?.(resource);
                      }}
                    />
                  </td>
                )}
                {schema.columns.map((column) => (
                  <td key={column.name} onClick={() => onSelect(resource)}>
                    {renderColumnValue(getPath(resource, column.path ?? column.name), column)}
                  </td>
                ))}
                {hasActions && (
                  <td className="table-actions">
                    <div className="table-actions-group">
                      {explorePath && (
                        <Link
                          className="button compact"
                          to={explorePath}
                          aria-label={`Explore data in ${resource.name}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Explore data
                        </Link>
                      )}
                      {canEdit && (
                        <Hint label={`Edit ${resource.name}`}><Button variant="ghost" size="icon-sm"
                          type="button"
                          aria-label={`Edit ${resource.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit?.(resource);
                          }}
                        >
                          <Icon icon={Pencil} size={14} />
                        </Button></Hint>
                      )}
                      {canDeleteRow && (
                        confirmId === resource.id ? (
                          <div
                            className="table-confirm-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button variant="destructive" size="sm"
                              type="button"
                              disabled={deletingId === resource.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDelete(resource);
                              }}
                            >
                              Confirm
                            </Button>
                            <Button variant="secondary" size="sm"
                              className="success"
                              type="button"
                              disabled={deletingId === resource.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmId(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Hint label={`Delete ${resource.name}`}><Button variant="ghost" size="icon-sm"
                            type="button"
                            aria-label={`Delete ${resource.name}`}
                            disabled={deletingId === resource.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmId(resource.id);
                            }}
                          >
                            <Icon icon={Trash2} size={14} />
                          </Button></Hint>
                        )
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

