import { FormEvent, useEffect, useRef, useState } from "react";
import { Code2, Database, Play, Plug, RefreshCw, Table2, Unplug } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import {
  listSqlDatabases,
  listSqlTables,
  querySql,
} from "@/api/cloudProxyClient";
import type { CloudProvider } from "@/types/cloud";
import type {
  CloudResource,
  SqlCredentials,
  SqlDatabase,
  SqlEngine,
  SqlQueryResult,
  SqlTable,
} from "@/types/resource";

const SQL_SERVER_DEFAULT_QUERY = `SELECT
  DB_NAME() AS database_name,
  @@SERVERNAME AS server_name,
  @@VERSION AS version;`;
const POSTGRES_DEFAULT_QUERY = `SELECT
  current_database() AS database_name,
  current_user AS username,
  version();`;

interface AzureSqlPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

interface TablesRequest {
  database: string;
  requestId: number;
}

export function AzureSqlPanel({
  cloud,
  resource,
  runtimeReachable,
}: AzureSqlPanelProps) {
  const serverId = resource?.id;
  const engine: SqlEngine =
    resource?.type === "postgres-flexible-server" ? "postgresql" : "azure-sql";
  const defaultDatabase = engine === "postgresql" ? "postgres" : "master";
  const defaultQuery =
    engine === "postgresql" ? POSTGRES_DEFAULT_QUERY : SQL_SERVER_DEFAULT_QUERY;
  const administratorLogin = metadataString(
    resource?.metadata.administratorLogin,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connected, setConnected] = useState(false);
  const [databases, setDatabases] = useState<SqlDatabase[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState(defaultDatabase);
  const [tables, setTables] = useState<SqlTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<SqlTable>();
  const [queryText, setQueryText] = useState(defaultQuery);
  const latestTablesRequestId = useRef(0);

  const credentials: SqlCredentials = { username, password };

  const tablesMut = useMutation({
    mutationFn: ({ database }: TablesRequest) =>
      listSqlTables(cloud, serverId ?? "", engine, database, credentials),
    onSuccess: (items, request) => {
      if (request.requestId === latestTablesRequestId.current) {
        setTables(items);
      }
    },
  });

  const databasesMut = useMutation({
    mutationFn: () =>
      listSqlDatabases(cloud, serverId ?? "", engine, credentials),
    onSuccess: (items) => {
      setDatabases(items);
      setConnected(true);
      const database = items.some((item) => item.name === selectedDatabase)
        ? selectedDatabase
        : (items[0]?.name ?? defaultDatabase);
      setSelectedDatabase(database);
      loadTables(database);
    },
  });

  const queryMut = useMutation({
    mutationFn: ({ database, query }: { database: string; query: string }) =>
      querySql(cloud, serverId ?? "", engine, database, credentials, query),
  });

  useEffect(() => {
    latestTablesRequestId.current += 1;
    setUsername(administratorLogin);
    setPassword("");
    setConnected(false);
    setDatabases([]);
    setSelectedDatabase(defaultDatabase);
    setTables([]);
    setSelectedTable(undefined);
    setQueryText(defaultQuery);
  }, [administratorLogin, cloud, defaultDatabase, defaultQuery, serverId]);

  if (cloud !== "azure") return null;

  if (!serverId) {
    return (
      <section className="sql-panel">
        <div className="empty compact">
          <h3>Select an Azure database server</h3>
          <p>Databases, tables, rows, and SQL queries load after connection.</p>
        </div>
      </section>
    );
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username || !password) return;
    latestTablesRequestId.current += 1;
    tablesMut.reset();
    queryMut.reset();
    databasesMut.mutate();
  }

  function disconnect() {
    latestTablesRequestId.current += 1;
    setConnected(false);
    setPassword("");
    setDatabases([]);
    setTables([]);
    setSelectedTable(undefined);
    databasesMut.reset();
    tablesMut.reset();
    queryMut.reset();
  }

  function selectDatabase(database: SqlDatabase) {
    setSelectedDatabase(database.name);
    setSelectedTable(undefined);
    setTables([]);
    queryMut.reset();
    loadTables(database.name);
  }

  function loadTables(database: string) {
    tablesMut.mutate({
      database,
      requestId: ++latestTablesRequestId.current,
    });
  }

  function previewTable(table: SqlTable) {
    const tableName = `${quoteIdentifier(table.schema, engine)}.${quoteIdentifier(table.name, engine)}`;
    const query = engine === "postgresql"
      ? `SELECT * FROM ${tableName} LIMIT 100;`
      : `SELECT TOP (100) * FROM ${tableName};`;
    setSelectedTable(table);
    setQueryText(query);
    queryMut.mutate({ database: selectedDatabase, query });
  }

  function runQuery() {
    if (!queryText.trim()) return;
    queryMut.mutate({ database: selectedDatabase, query: queryText });
  }

  const connectionError =
    databasesMut.error instanceof Error ? databasesMut.error.message : null;

  return (
    <section className="sql-panel">
      <form className="sql-connection-bar" onSubmit={connect}>
        <div className="sql-connection-title">
          <Plug size={16} />
          <span>
            <small>{engine === "postgresql" ? "POSTGRESQL DATA PLANE" : "SQL DATA PLANE"}</small>
            <strong>{resource.name}</strong>
            <em>{metadataString(resource.metadata.fullyQualifiedDomainName)}</em>
          </span>
        </div>
        <label>
          <span>Username</span>
          <input
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={connected || !runtimeReachable}
            autoComplete="username"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={connected || !runtimeReachable}
            autoComplete="current-password"
          />
        </label>
        {connected ? (
          <button className="button" type="button" onClick={disconnect}>
            <Unplug size={14} />
            Disconnect
          </button>
        ) : (
          <button
            className="button primary"
            type="submit"
            disabled={
              !runtimeReachable ||
              databasesMut.isPending ||
              !username ||
              !password
            }
          >
            <Plug size={14} />
            {databasesMut.isPending ? "Connecting" : "Connect"}
          </button>
        )}
        <small className="sql-credential-note">
          Credentials remain in this page only and are sent to the local API per request.
        </small>
        {connectionError && <div className="form-error">{connectionError}</div>}
      </form>

      {!connected ? (
        <div className="empty compact sql-connect-empty">
          <h3>Connect to browse SQL data</h3>
          <p>Use the administrator login configured for this local engine.</p>
        </div>
      ) : (
        <div className="sql-explorer">
          <div className="sql-column">
            <SqlPanelHeader
              icon={Database}
              eyebrow="Databases"
              title={resource.name}
              detail={`${databases.length} databases`}
              action={
                <button
                  className="icon-btn"
                  type="button"
                  title="Refresh databases"
                  disabled={databasesMut.isPending}
                  onClick={() => databasesMut.mutate()}
                >
                  <RefreshCw size={13} />
                </button>
              }
            />
            <div className="sql-list">
              {databases.map((database) => (
                <button
                  key={database.name}
                  className={`sql-list-row ${selectedDatabase === database.name ? "selected" : ""}`}
                  type="button"
                  onClick={() => selectDatabase(database)}
                >
                  <span>
                    <strong>{database.name}</strong>
                    <small>{database.state}</small>
                  </span>
                  {database.isSystem && <em>System</em>}
                </button>
              ))}
            </div>
          </div>

          <div className="sql-column">
            <SqlPanelHeader
              icon={Table2}
              eyebrow="Tables and views"
              title={selectedDatabase}
              detail={`${tables.length} objects`}
              action={
                <button
                  className="icon-btn"
                  type="button"
                  title="Refresh tables"
                  disabled={tablesMut.isPending}
                  onClick={() => loadTables(selectedDatabase)}
                >
                  <RefreshCw size={13} />
                </button>
              }
            />
            {tablesMut.error instanceof Error && (
              <div className="form-error">{tablesMut.error.message}</div>
            )}
            <div className="sql-list">
              {tablesMut.isPending && <div className="muted padded">Loading objects</div>}
              {!tablesMut.isPending && tables.length === 0 && (
                <div className="muted padded">No user tables or views</div>
              )}
              {tables.map((table) => (
                <button
                  key={`${table.schema}.${table.name}`}
                  className={`sql-list-row ${selectedTable?.schema === table.schema && selectedTable.name === table.name ? "selected" : ""}`}
                  type="button"
                  onClick={() => previewTable(table)}
                >
                  <span>
                    <strong>{table.schema}.{table.name}</strong>
                    <small>{table.type}</small>
                  </span>
                  <em>{table.rowCount === null ? "—" : `${table.rowCount} rows`}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="sql-column sql-workspace">
            <SqlPanelHeader
              icon={Code2}
              eyebrow="Query editor"
              title={selectedDatabase}
              detail={engine === "postgresql"
                ? "PostgreSQL SQL against selected database"
                : "T-SQL against selected database"}
            />
            <div className="sql-query-editor">
              <textarea
                className="textarea code-textarea small"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                spellCheck={false}
              />
              <button
                className="button primary"
                type="button"
                disabled={queryMut.isPending || !queryText.trim()}
                onClick={runQuery}
              >
                <Play size={14} />
                {queryMut.isPending ? "Running" : "Run query"}
              </button>
            </div>
            {queryMut.error instanceof Error && (
              <div className="form-error">{queryMut.error.message}</div>
            )}
            <SqlQueryResults result={queryMut.data} />
          </div>
        </div>
      )}
    </section>
  );
}

function SqlQueryResults({ result }: { result?: SqlQueryResult }) {
  if (!result) {
    return (
      <div className="empty compact sql-results-empty">
        <h3>No query results</h3>
        <p>Select a table for a 100-row preview or run SQL.</p>
      </div>
    );
  }

  const affected = result.rowsAffected.reduce((total, count) => total + count, 0);

  return (
    <div className="sql-results">
      <div className="sql-results-summary">
        <span>{result.resultSets.length} result sets</span>
        <span>{affected} rows affected</span>
        <span>{result.durationMs} ms</span>
      </div>
      {result.resultSets.length === 0 && (
        <div className="muted padded">Command completed without a result set.</div>
      )}
      {result.resultSets.map((resultSet, resultSetIndex) => (
        <div className="sql-result-set" key={resultSetIndex}>
          <div className="sql-result-set-label">
            Result {resultSetIndex + 1} · {resultSet.rows.length} rows
            {resultSet.truncated && " · first 500 shown"}
          </div>
          <div className="sql-result-table-wrap">
            <table className="table sql-result-table">
              <thead>
                <tr>
                  {resultSet.columns.map((column) => (
                    <th key={column.name} title={column.type}>
                      {column.name}
                      <small>{column.type}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultSet.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {resultSet.columns.map((column) => {
                      const value = formatSqlValue(row[column.name]);
                      return (
                        <td key={column.name} title={value}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function SqlPanelHeader({
  icon: Icon,
  eyebrow,
  title,
  detail,
  action,
}: {
  icon: typeof Database;
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="sql-panel-header">
      <Icon size={15} />
      <span>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <em>{detail}</em>
      </span>
      {action}
    </div>
  );
}

function metadataString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function quoteIdentifier(value: string, engine: SqlEngine): string {
  return engine === "postgresql"
    ? `"${value.replace(/"/g, '""')}"`
    : `[${value.replace(/]/g, "]]")}]`;
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
