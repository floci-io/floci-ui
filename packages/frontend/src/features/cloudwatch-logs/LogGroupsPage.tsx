import { useMemo, useState } from "react";
import { RefreshCw, ScrollText, Search } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useLogGroupsQuery } from "@/api/aws/logs.queries";
import { timeAgo } from "@/lib/utils";
import { LogStreamsPanel } from "./LogStreamsPanel";
import { LogEventsPanel } from "./LogEventsPanel";

type View =
  | { kind: "groups" }
  | { kind: "streams"; group: string }
  | { kind: "events"; group: string; stream: string };

export function LogGroupsPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>({ kind: "groups" });
  const query = useLogGroupsQuery();

  const groups = useMemo(() => {
    const all = query.data ?? [];
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter((g) => g.name.toLowerCase().includes(q));
  }, [query.data, search]);

  if (view.kind === "streams") {
    return (
      <LogStreamsPanel
        group={view.group}
        onBack={() => setView({ kind: "groups" })}
        onSelectStream={(stream) => setView({ kind: "events", group: view.group, stream })}
      />
    );
  }

  if (view.kind === "events") {
    return (
      <LogEventsPanel
        group={view.group}
        stream={view.stream}
        onBack={() => setView({ kind: "streams", group: view.group })}
      />
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h2>CloudWatch Logs</h2>
          <span className="info-link">
            {query.data ? `${groups.length} log groups` : "Log groups"}
          </span>
        </div>
        <button className="button" onClick={() => void query.refetch()}>
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div className="input-row">
        <Search size={14} color="#8d9cad" />
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search log groups…"
        />
      </div>

      <div className="content">
        <div className="table-panel">
          <div className="widget-header">
            <h3>Log groups</h3>
          </div>
          {query.isError ? (
            <EmptyState
              icon={ScrollText}
              title="Cannot load log groups"
              description="CloudWatch Logs did not respond from the Floci endpoint."
            />
          ) : query.isLoading ? (
            <div className="empty">
              <p>Loading log groups…</p>
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={search ? "No log groups match your search" : "No log groups"}
              description={
                search
                  ? "Try a different name."
                  : "Log groups created in this account will appear here."
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Retention</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr
                    key={group.arn ?? group.name}
                    onClick={() => setView({ kind: "streams", group: group.name })}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="mono" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ScrollText size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      {group.name}
                    </td>
                    <td>
                      {group.retentionInDays ? `${group.retentionInDays} days` : "Never expires"}
                    </td>
                    <td style={{ color: "#8d9cad" }}>{timeAgo(group.creationTime)}</td>
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
