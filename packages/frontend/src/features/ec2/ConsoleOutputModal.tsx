import {Icon, Terminal} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import { useEc2ConsoleOutputQuery } from "@/api/aws/ec2.queries";
import { ModalOverlay } from "@/components/ModalOverlay";

interface Props {
  instanceId: string;
  onClose: () => void;
}

export function ConsoleOutputModal({ instanceId, onClose }: Props) {
  const query = useEc2ConsoleOutputQuery(instanceId);

  return (
    <ModalOverlay onClose={onClose}>
      <div className="create-table-modal max-w-180 flex flex-col max-h-[85vh]">
        <h2 className="flex items-center gap-1.5">
          <Icon icon={Terminal} size={14} />
          Console output, {instanceId}
        </h2>

        {query.isLoading && (
          <p className="type-caption text-text-2">Loading…</p>
        )}

        {query.isError && (
          <p className="type-caption text-fail-text">
            {query.error instanceof Error ? query.error.message : "Failed to fetch console output."}
          </p>
        )}

        {query.data && (
          <>
            {query.data.timestamp && (
              <p className="type-caption text-text-2 mt-0 mx-0 mb-2">
                As of {new Date(query.data.timestamp).toLocaleString()}
              </p>
            )}
            <pre
              className="mono flex-1 overflow-y-auto p-3 type-caption m-0 whitespace-pre-wrap break-all bg-panel"
            >
              {query.data.output || "(no output yet)"}
            </pre>
          </>
        )}

        <div className="modal-footer mt-3">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
