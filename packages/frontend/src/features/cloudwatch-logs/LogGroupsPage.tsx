import { useMemo, useState } from "react";
import { RefreshCw, ScrollText, Search } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useLogGroupsQuery } from "@/api/aws/logs.queries";
import { timeAgo } from "@/lib/utils";

export function LogGroupsPage() {
  const [search, setSearch] = useState("");
  const query = useLogGroupsQuery();

  const groups = useMemo(() => {
    const all = query.data ?? [];
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter((g) => g.name.toLowerCase().includes(q));
  }, [query.data, search]);

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
                  <tr key={group.arn ?? group.name}>
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
