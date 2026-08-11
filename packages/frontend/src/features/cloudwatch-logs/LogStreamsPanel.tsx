import { ChevronLeft, ChevronRight, RefreshCw, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useLogStreamsQuery } from "@/api/aws/logs.queries";
import { timeAgo } from "@/lib/utils";
import { formatBytes } from "@/lib/format";

interface LogStreamsPanelProps {
  group: string;
  onBack: () => void;
  onSelectStream: (stream: string) => void;
}

export function LogStreamsPanel({ group, onBack, onSelectStream }: LogStreamsPanelProps) {
  const query = useLogStreamsQuery(group);
  const streams = query.data ?? [];

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <button className="button" onClick={onBack}>
            <ChevronLeft size={13} />
            Log groups
          </button>
          <h2>{group}</h2>
          <span className="info-link">
            {query.data ? `${streams.length} log streams` : "Log streams"}
          </span>
        </div>
        <button className="button" onClick={() => void query.refetch()}>
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div className="content">
        <div className="table-panel">
          <div className="widget-header">
            <h3>Log streams</h3>
          </div>
          {query.isError ? (
            <EmptyState
              icon={ScrollText}
              title="Cannot load log streams"
              description="CloudWatch Logs did not respond from the Floci endpoint."
            />
          ) : query.isLoading ? (
            <div className="empty">
              <p>Loading log streams…</p>
            </div>
          ) : streams.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No log streams"
              description="Log streams created in this group will appear here."
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Last event</th>
                  <th>Stored</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((stream) => (
                  <tr
                    key={stream.name}
                    onClick={() => onSelectStream(stream.name)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="mono" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ScrollText size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      {stream.name}
                      <ChevronRight size={12} style={{ color: "#8d9cad", marginLeft: "auto" }} />
                    </td>
                    <td style={{ color: "#8d9cad" }}>{timeAgo(stream.lastEventTimestamp)}</td>
                    <td>{stream.storedBytes !== undefined ? formatBytes(stream.storedBytes) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
