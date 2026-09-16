import { Terminal } from "lucide-react";
import { useEc2ConsoleOutputQuery } from "@/api/aws/ec2.queries";

interface Props {
  instanceId: string;
  onClose: () => void;
}

export function ConsoleOutputModal({ instanceId, onClose }: Props) {
  const query = useEc2ConsoleOutputQuery(instanceId);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="create-table-modal" style={{ maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Terminal size={14} />
          Console output — {instanceId}
        </h3>

        {query.isLoading && (
          <p style={{ fontSize: 12, color: "var(--text-2)" }}>Loading…</p>
        )}

        {query.isError && (
          <p style={{ fontSize: 12, color: "var(--status-error)" }}>
            {query.error instanceof Error ? query.error.message : "Failed to fetch console output."}
          </p>
        )}

        {query.data && (
          <>
            {query.data.timestamp && (
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "0 0 8px" }}>
                As of {new Date(query.data.timestamp).toLocaleString()}
              </p>
            )}
            <pre
              className="mono"
              style={{
                flex: 1,
                overflowY: "auto",
                background: "var(--surface-2)",
                padding: 12,
                borderRadius: 4,
                fontSize: 11,
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {query.data.output || "(no output yet)"}
            </pre>
          </>
        )}

        <div className="modal-footer" style={{ marginTop: 12 }}>
          <button className="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
