import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {Icon, Loader2, PlusSquared as Plus} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
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
import {Checkbox} from '@/components/sodium/ui/checkbox'

const IDENTIFIER_PATTERN = /^(?!.*--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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
  const [dbInstanceClass, setDbInstanceClass] = useState("");
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
  const selectedClass =
    dbInstanceClass && availableClasses.includes(dbInstanceClass)
      ? dbInstanceClass
      : (availableClasses[0] ?? "");

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

    if (!selectedClass) {
      setValidationError("DB Instance Class is required.");
      return;
    }

    if (masterUserPassword.length < 8) {
      setValidationError("Master User Password must be at least 8 characters.");
      return;
    }

    createMut.mutate({
      dbInstanceIdentifier: trimmedIdentifier,
      engine,
      dbInstanceClass: selectedClass,
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
        <Input aria-label="DB instance identifier"
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
        <OptionSelect
          value={engine}
          onValueChange={(value) => {
            const nextEngine = value;
            setEngine(nextEngine);
            setDbInstanceClass("");
          }}
          required
        >
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mariadb">MariaDB</option>
        </OptionSelect>
      </label>

      <label className="launch-field">
        <span>
          DB Instance Class <em className="field-required">*</em>
          {classesQuery.isFetching && (
            <Icon icon={Loader2}
              size={14}
              className="spin ml-1.5 inline-block"
            />
          )}
        </span>
        <OptionSelect
          value={selectedClass}
          onValueChange={(value) => setDbInstanceClass(value)}
          disabled={classesQuery.isLoading || availableClasses.length === 0}
          required
        >
          {classesQuery.isLoading && (
            <option value="" disabled>
              Loading available instance classes…
            </option>
          )}
          {classesQuery.isError && (
            <option value="" disabled>
              Failed to load instance classes
            </option>
          )}
          {!classesQuery.isLoading &&
            !classesQuery.isError &&
            availableClasses.length === 0 && (
              <option value="" disabled>
                No instance classes available
              </option>
            )}
          {availableClasses.map((cls) => (
            <option key={cls} value={cls}>
              {cls}
            </option>
          ))}
        </OptionSelect>
      </label>

      <label className="launch-field">
        <span>
          Master User Password <em className="field-required">*</em>
        </span>
        <Input aria-label="Master password"
          type="password"
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
          <div className="launch-form-group">Networking, optional</div>
          <div className="launch-field launch-field--span">
            <span className="type-caption text-text-2">
              Security Groups
            </span>
            <div className="sg-checklist mt-1">
              {sgsQuery.isLoading && <span className="muted">Loading…</span>}
              {!sgsQuery.isLoading && (sgsQuery.data ?? []).length === 0 && (
                <span className="muted">No security groups found.</span>
              )}
              {(sgsQuery.data ?? []).map((sg: Ec2SecurityGroup) => (
                <label key={sg.groupId} className="sg-check-item">
                  <Checkbox
                    checked={selectedSgs.includes(sg.groupId)}
                    onCheckedChange={(checked) => toggleSg(sg.groupId, checked)}
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
      <div className="launch-form-group">Database Settings, optional</div>

      <label className="launch-field">
        <span>Master Username</span>
        <Input aria-label="Master username"
          value={masterUsername}
          onChange={(e) => setMasterUsername(e.target.value)}
          placeholder="root"
          maxLength={63}
        />
      </label>

      <label className="launch-field">
        <span>Allocated Storage (GiB)</span>
        <Input aria-label="20"
          type="number"
          value={allocatedStorage}
          onChange={(e) => setAllocatedStorage(e.target.value)}
          placeholder="20"
          min={5}
          max={65536}
        />
      </label>

      <label className="launch-field">
        <span>Database Name</span>
        <Input aria-label="Database name"
          value={dbName}
          onChange={(e) => setDbName(e.target.value)}
          placeholder="e.g. myapp"
          maxLength={64}
        />
      </label>

      <label className="launch-field">
        <span>Engine Version</span>
        <Input aria-label="16.3"
          value={engineVersion}
          onChange={(e) => setEngineVersion(e.target.value)}
          placeholder="e.g. 16.3"
        />
      </label>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className="launch-form-actions">
        <Button variant="secondary"
          type="button"
          onClick={onCancel}
          disabled={createMut.isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? (
            <Icon icon={Loader2} className="spin" size={14} />
          ) : (
            <Icon icon={Plus} size={14} />
          )}
          {createMut.isPending ? "Creating…" : "Create DB Instance"}
        </Button>
      </div>

      {errorMessage && (
        <div
          className="field-error launch-field--span mt-1"
          role="alert"
        >
          {errorMessage}
        </div>
      )}
    </form>
  );
}
