import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import {
  createCloudResource,
  listDatabaseOrderableClasses,
} from "@/api/cloudProxyClient";
import {
  listEc2SecurityGroups,
  type Ec2SecurityGroup,
} from "@/api/aws/ec2.api";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource } from "@/types/resource";

const IDENTIFIER_PATTERN = /^(?!.*--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const DEFAULT_RDS_CLASSES = [
  "db.t3.micro",
  "db.t3.small",
  "db.t3.medium",
  "db.t3.large",
  "db.m5.large",
  "db.m5.xlarge",
  "db.r5.large",
];

interface CreateRdsInstanceFormProps {
  cloud: CloudProvider;
  onSuccess: (resource: CloudResource) => void;
  onCancel: () => void;
}

export function CreateRdsInstanceForm({
  cloud,
  onSuccess,
  onCancel,
}: CreateRdsInstanceFormProps) {
  const qc = useQueryClient();

  // Instance configuration
  const [dbInstanceIdentifier, setDbInstanceIdentifier] = useState("");
  const [engine, setEngine] = useState("postgres");
  const [dbInstanceClass, setDbInstanceClass] = useState("db.t3.micro");
  const [masterUserPassword, setMasterUserPassword] = useState("");

  // Networking settings
  const [selectedSgs, setSelectedSgs] = useState<string[]>([]);

  // Additional settings
  const [masterUsername, setMasterUsername] = useState("root");
  const [allocatedStorage, setAllocatedStorage] = useState("20");
  const [dbName, setDbName] = useState("");
  const [engineVersion, setEngineVersion] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Fetch available instance classes from AWS SDK via backend
  const classesQuery = useQuery({
    queryKey: ["cloud-database-orderable-classes", cloud, engine],
    queryFn: ({ signal }) => listDatabaseOrderableClasses(cloud, engine, signal),
    enabled: Boolean(engine),
  });

  const availableClasses = classesQuery.data ?? [];

  // Fetch available security groups (AWS)
  const sgsQuery = useQuery({
    queryKey: ["ec2", "security-groups"],
    queryFn: ({ signal }) => listEc2SecurityGroups(undefined, signal),
    enabled: cloud === "aws",
  });

  function toggleSg(groupId: string, checked: boolean) {
    setSelectedSgs((prev) =>
      checked ? [...prev, groupId] : prev.filter((id) => id !== groupId),
    );
  }

  const createMut = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      createCloudResource(cloud, "database", values),
    onSuccess: (created) => {
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", cloud, "database"],
      });
      onSuccess(created);
    },
  });

  const instanceClasses =
    availableClasses.length > 0 ? availableClasses : DEFAULT_RDS_CLASSES;
  const classOptions = instanceClasses.includes(dbInstanceClass)
    ? instanceClasses
    : [dbInstanceClass, ...instanceClasses];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const trimmedIdentifier = dbInstanceIdentifier.trim();
    if (!trimmedIdentifier) {
      setValidationError("DB Instance Identifier is required.");
      return;
    }

    if (!IDENTIFIER_PATTERN.test(trimmedIdentifier)) {
      setValidationError(
        "DB Instance Identifier must start with a lowercase letter, contain only lowercase letters, digits, and hyphens, and cannot end with a hyphen or contain consecutive hyphens.",
      );
      return;
    }

    if (masterUserPassword.length < 8) {
      setValidationError("Master User Password must be at least 8 characters.");
      return;
    }

    createMut.mutate({
      dbInstanceIdentifier: trimmedIdentifier,
      engine,
      dbInstanceClass: dbInstanceClass.trim() || "db.t3.micro",
      masterUserPassword,
      masterUsername: masterUsername.trim() || "root",
      allocatedStorage: allocatedStorage.trim() || "20",
      dbName: dbName.trim() || undefined,
      engineVersion: engineVersion.trim() || undefined,
      securityGroupIds: selectedSgs.length ? selectedSgs : undefined,
    });
  }

  const errorMessage =
    validationError ??
    (createMut.error instanceof Error ? createMut.error.message : null);

  return (
    <form className="launch-form" onSubmit={handleSubmit} noValidate={false}>
      {/* ── Required Instance Settings ─────────────────────────────── */}
      <div className="launch-form-group">Instance Configuration</div>

      <label className="launch-field">
        <span>
          DB Instance Identifier <em className="field-required">*</em>
        </span>
        <input
          className="input"
          value={dbInstanceIdentifier}
          onChange={(e) => setDbInstanceIdentifier(e.target.value)}
          placeholder="e.g. orders-database"
          required
          maxLength={63}
        />
      </label>

      <label className="launch-field">
        <span>
          Engine <em className="field-required">*</em>
        </span>
        <select
          className="input"
          value={engine}
          onChange={(e) => {
            const nextEngine = e.target.value;
            setEngine(nextEngine);
          }}
          required
        >
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mariadb">MariaDB</option>
        </select>
      </label>

      <label className="launch-field">
        <span>
          DB Instance Class <em className="field-required">*</em>
          {classesQuery.isFetching && (
            <Loader2
              size={11}
              className="spin"
              style={{ marginLeft: 6, display: "inline-block" }}
            />
          )}
        </span>
        <select
          className="input"
          value={dbInstanceClass}
          onChange={(e) => setDbInstanceClass(e.target.value)}
          required
        >
          {classOptions.map((cls) => (
            <option key={cls} value={cls}>
              {cls}
            </option>
          ))}
        </select>
      </label>

      <label className="launch-field">
        <span>
          Master User Password <em className="field-required">*</em>
        </span>
        <input
          type="password"
          className="input"
          value={masterUserPassword}
          onChange={(e) => setMasterUserPassword(e.target.value)}
          placeholder="Min 8 characters"
          required
          minLength={8}
          maxLength={128}
        />
      </label>

      {/* ── Networking — optional ─────────────────────────────────── */}
      {cloud === "aws" && (
        <>
          <div className="launch-form-group">Networking — optional</div>
          <div className="launch-field launch-field--span">
            <span style={{ fontSize: "12px", color: "var(--text-2)" }}>
              Security Groups
            </span>
            <div className="sg-checklist" style={{ marginTop: "4px" }}>
              {sgsQuery.isLoading && <span className="muted">Loading…</span>}
              {!sgsQuery.isLoading && (sgsQuery.data ?? []).length === 0 && (
                <span className="muted">No security groups found.</span>
              )}
              {(sgsQuery.data ?? []).map((sg: Ec2SecurityGroup) => (
                <label key={sg.groupId} className="sg-check-item">
                  <input
                    type="checkbox"
                    checked={selectedSgs.includes(sg.groupId)}
                    onChange={(e) => toggleSg(sg.groupId, e.target.checked)}
                  />
                  <span>{sg.groupName || sg.groupId}</span>
                  {sg.groupName && <code>{sg.groupId}</code>}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Additional Database Settings ───────────────────────────── */}
      <div className="launch-form-group">Database Settings — optional</div>

      <label className="launch-field">
        <span>Master Username</span>
        <input
          className="input"
          value={masterUsername}
          onChange={(e) => setMasterUsername(e.target.value)}
          placeholder="root"
          maxLength={63}
        />
      </label>

      <label className="launch-field">
        <span>Allocated Storage (GiB)</span>
        <input
          type="number"
          className="input"
          value={allocatedStorage}
          onChange={(e) => setAllocatedStorage(e.target.value)}
          placeholder="20"
          min={5}
          max={65536}
        />
      </label>

      <label className="launch-field">
        <span>Database Name</span>
        <input
          className="input"
          value={dbName}
          onChange={(e) => setDbName(e.target.value)}
          placeholder="e.g. myapp"
          maxLength={64}
        />
      </label>

      <label className="launch-field">
        <span>Engine Version</span>
        <input
          className="input"
          value={engineVersion}
          onChange={(e) => setEngineVersion(e.target.value)}
          placeholder="e.g. 16.3"
        />
      </label>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className="launch-form-actions">
        <button
          className="button"
          type="button"
          onClick={onCancel}
          disabled={createMut.isPending}
        >
          Cancel
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? (
            <Loader2 className="spin" size={13} />
          ) : (
            <Plus size={13} />
          )}
          {createMut.isPending ? "Creating…" : "Create DB Instance"}
        </button>
      </div>

      {errorMessage && (
        <div
          className="field-error launch-field--span"
          role="alert"
          style={{ marginTop: "4px" }}
        >
          {errorMessage}
        </div>
      )}
    </form>
  );
}
