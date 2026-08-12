import { useState } from "react";
import { ChevronLeft, RefreshCw, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useLogEventsPagesQuery } from "@/api/aws/logs.queries";
import { formatDateTime } from "@/lib/format";

interface LogEventsPanelProps {
  group: string;
  stream: string;
  onBack: () => void;
}

export function LogEventsPanel({ group, stream, onBack }: LogEventsPanelProps) {
  const [tokens, setTokens] = useState<Array<string | undefined>>([undefined]);

  // Switching streams starts a fresh drill-in, not a continuation of the
  // previous stream's pages. Resetting during render (rather than in a
  // useEffect) avoids an interim render where the new stream would be
  // fetched with the previous stream's leftover tokens.
  const streamKey = `${group}:${stream}`;
  const [seenStreamKey, setSeenStreamKey] = useState(streamKey);
  if (streamKey !== seenStreamKey) {
    setSeenStreamKey(streamKey);
    setTokens([undefined]);
  }

  const pages = useLogEventsPagesQuery(group, stream, tokens);
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const events = pages.flatMap((page) => page.data?.events ?? []);
  const nextToken = lastPage?.data?.nextToken;
  const loadingMore = pages.length > 1 && lastPage?.isLoading;

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <button className="button" onClick={onBack}>
            <ChevronLeft size={13} />
            Log streams
          </button>
          <h2>{stream}</h2>
          <span className="info-link">{group}</span>
        </div>
        <button className="button" onClick={() => void firstPage?.refetch()}>
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div className="content">
        <div className="table-panel">
          <div className="widget-header">
            <h3>Log events</h3>
          </div>
          {firstPage?.isError ? (
            <EmptyState
              icon={ScrollText}
              title="Cannot load log events"
              description="CloudWatch Logs did not respond from the Floci endpoint."
            />
          ) : firstPage?.isLoading ? (
            <div className="empty">
              <p>Loading log events…</p>
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No log events"
              description="Events written to this stream will appear here."
            />
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, index) => (
                    // Events have no stable id of their own; a page never
                    // reorders once fetched, so position is a safe key.
                    <tr key={index}>
                      <td className="mono" style={{ color: "#8d9cad", whiteSpace: "nowrap" }}>
                        {formatDateTime(event.timestamp) ?? "-"}
                      </td>
                      <td className="mono">{event.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextToken && (
                <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
                  <button
                    className="button"
                    disabled={loadingMore}
                    onClick={() => setTokens((prev) => [...prev, nextToken])}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
