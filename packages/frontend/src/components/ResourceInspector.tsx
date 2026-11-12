import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {Icon, CheckSquared as Check, ChevronDown, ChevronUp, Copy, ZapSquared as Zap} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import { K8sEngineDetails } from "@/features/k8s/K8sEngineDetails";
import { listLambdaTriggers } from "@/api/cloudProxyClient";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource, StorageObject } from "@/types/resource";
import { formatBytes } from "@/lib/format";
import { InspectorTabs, type InspectorTab } from "@/components/InspectorTabs";
import { lazyPanel } from "@/lib/lazyPanel";
import {Hint} from '@/components/Hint'

const LogsExplorerPanel = lazyPanel(() => import("@/components/LogsExplorerPanel").then((m) => m.LogsExplorerPanel));
const LogsQueryPanel = lazyPanel(() => import("@/components/LogsQueryPanel").then((m) => m.LogsQueryPanel));
const GcpLogsPanel = lazyPanel(() => import("@/components/GcpLogsPanel").then((m) => m.GcpLogsPanel));
const LambdaTriggerPanel = lazyPanel(() => import("@/components/LambdaTriggerPanel").then((m) => m.LambdaTriggerPanel));

interface ResourceInspectorProps {
  resource?: CloudResource;
  object?: StorageObject;
  cloud?: CloudProvider;
  runtimeReachable?: boolean;
  serviceName?: string;
}

export type { InspectorTab };

export function ResourceInspector({
  resource,
  object,
  cloud,
  runtimeReachable,
  serviceName,
}: ResourceInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('plain');
  const [copiedJson, setCopiedJson] = useState(false);
  const copyRequestRef = useRef(0);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTriggers, setShowTriggers] = useState(false);
  const isLambda = Boolean(
    resource && (resource.service === "serverless" || resource.type === "lambda")
  );
  const resourceCloud = cloud ?? resource?.cloud;
  const isAwsLambda = isLambda && resourceCloud === "aws";

  useLayoutEffect(() => {
    setCopiedJson(false);
    return () => {
      copyRequestRef.current += 1;
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, [cloud, resource?.cloud, resource?.service, resource?.id, object?.key]);

  const handleCopyJson = async (metadata: Record<string, unknown>) => {
    const request = ++copyRequestRef.current;
    if (copyResetTimerRef.current !== null) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopiedJson(false);
    try {
      const text = JSON.stringify(metadata, null, 2);
      await navigator.clipboard.writeText(text);
      if (request !== copyRequestRef.current) return;
      setCopiedJson(true);
      copyResetTimerRef.current = setTimeout(() => {
        if (request === copyRequestRef.current) setCopiedJson(false);
        copyResetTimerRef.current = null;
      }, 1500);
    } catch {
      if (request === copyRequestRef.current) setCopiedJson(false);
    }
  };

  const triggersQuery = useQuery({
    queryKey: ["lambda-triggers", resourceCloud, resource?.id],
    queryFn: ({ signal }) =>
      resource ? listLambdaTriggers(resourceCloud!, resource.id, signal) : Promise.resolve([]),
    enabled: isAwsLambda && Boolean(runtimeReachable) && Boolean(resource),
  });
  const triggerCount = triggersQuery.data?.length ?? 0;

  if (!resource) {
    return (
      <div className="resource-inspector empty compact">
        <p className="eyebrow">Resource Inspector</p>
        <h2>Select a resource</h2>
        <p>Inspect normalized metadata returned by the cloud proxy.</p>
      </div>
    );
  }

  if (object) {
    return (
      <aside className="resource-inspector">
        <div className="widget-header">
          <h2>{object.name}</h2>
          <span className="badge neutral">{object.type}</span>
        </div>
        <InspectorTabs idPrefix="object" activeTab={activeTab} onChange={setActiveTab} />
        {activeTab === 'plain' && (
          <div
            role="tabpanel"
            id="object-tabpanel-plain"
            aria-labelledby="object-tab-plain"
          >
            <div className="inspector-grid">
              <InspectorItem label="Cloud" value={resource.cloud} />
              <InspectorItem label="Resource" value={resource.name} />
              <InspectorItem label="Key" value={object.key} />
              <InspectorItem
                label="Size"
                value={object.size === null ? "-" : formatBytes(object.size)}
              />
              <InspectorItem
                label="Last Modified"
                value={object.lastModified ?? "-"}
              />
            </div>
          </div>
        )}
        {activeTab === 'json' && (
          <div className="relative"
            role="tabpanel"
            id="object-tabpanel-json"
            aria-labelledby="object-tab-json"
          >
            <Hint label="Copy JSON data"><Button variant="secondary" size="sm"
              className="absolute inline-flex items-center gap-1 top-2 right-2 z-2"
              type="button"
              onClick={() => handleCopyJson(object.metadata)}
            >
              {copiedJson ? (
                <Icon icon={Check} className="text-ok-text" size={14} />
              ) : (
                <Icon icon={Copy} size={14} />
              )}
              <span>{copiedJson ? "Copied" : "Copy"}</span>
            </Button></Hint>
            <pre
              className="metadata-block pt-9 border-t-0"
            >
              {JSON.stringify(object.metadata, null, 2)}
            </pre>
          </div>
        )}
        {activeTab === 'table' && (
          <div
            role="tabpanel"
            id="object-tabpanel-table"
            aria-labelledby="object-tab-table"
          >
            <MetadataPanel metadata={object.metadata} />
          </div>
        )}
      </aside>
    );
  }

  if (resource.type === 'email') {
    return <EmailInspector key={resource.id} resource={resource} />
  }

  const tags = getTags(resource.metadata.tags);
  const tagsUnavailable = getBooleanMetadata(resource.metadata.tagsUnavailable) ?? false;
  const versioning = getStringMetadata(resource.metadata.versioning);
  const versioningEnabled = getBooleanMetadata(
    resource.metadata.versioningEnabled,
  );
  const isDatabase =
    resource.service === "database" || resource.type === "db-instance";
  const isAwsDatabase = isDatabase && resource.cloud === "aws";
  const isK8sEngine = resource.service === "k8s" || resource.type === "cluster";
  const isLogGroup = resource.cloud === "aws" && (resource.service === "logs" || resource.type === "log-group");
  const isGcpLog = resource.cloud === "gcp" && resource.service === "logs";
  const isSqsQueue =
    resource.cloud === "aws" &&
    (resource.service === "messaging" || resource.type === "queue" || resource.type === "fifo-queue");
  const isOciQueue = resource.cloud === "oci" && resource.service === "messaging" && resource.type === "queue";

  return (
    <aside className="resource-inspector">
      <div className="widget-header flex items-center gap-2 min-w-0">
        <h2 className="m-0 overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-auto"
          title={resource.name}
        >
          {resource.name}
        </h2>
        <span className="badge neutral shrink-0">
          {resource.type}
        </span>
        {isLambda && resource.cloud === "aws" && (
          <Button size="sm" variant={showTriggers ? 'primary' : 'secondary'} className="ml-auto shrink-0 whitespace-nowrap inline-flex items-center gap-1.5"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTriggers((prev) => !prev);
            }}
          >
            <Icon icon={Zap} className="shrink-0" size={14} />
            <span>Register Trigger ({triggerCount})</span>
            {showTriggers ? <Icon icon={ChevronUp} className="shrink-0" size={14} /> : <Icon icon={ChevronDown} className="shrink-0" size={14} />}
          </Button>
        )}
      </div>
      {isLambda && resource.cloud === "aws" && showTriggers && (
        <LambdaTriggerPanel
          key={resource.id}
          cloud={cloud ?? resource.cloud}
          resource={resource}
          runtimeReachable={runtimeReachable ?? false}
          initialRegisterOpen={true}
          onClose={() => setShowTriggers(false)}
        />
      )}
      <InspectorTabs idPrefix="inspector" activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'plain' && (
        <div
          role="tabpanel"
          id="inspector-tabpanel-plain"
          aria-labelledby="inspector-tab-plain"
        >
          <div className="inspector-grid">
            <InspectorItem label="Cloud" value={resource.cloud} />
            <InspectorItem label="Service" value={serviceName ?? resource.service} />
            <InspectorItem label="Region" value={resource.region ?? "-"} />
            <InspectorItem label="Created At" value={resource.createdAt ?? "-"} />
            {resource.status && (
              <InspectorItem label="Status" value={resource.status} />
            )}
            {resource.engine && (
              <InspectorItem label="Engine" value={resource.engine} />
            )}
            {resource.version && (
              <InspectorItem label="Version" value={resource.version} />
            )}
            {resource.instanceClass && (
              <InspectorItem label="Class" value={resource.instanceClass} />
            )}
            {versioning && (
              <InspectorItem
                label="Versioning"
                value={
                  resource.cloud === "aws" && versioning === "Unknown"
                    ? "Unknown (could not be read)"
                    : versioning
                }
              />
            )}
            {versioningEnabled !== null && (
              <InspectorItem
                label="Versioning Enabled"
                value={versioningEnabled ? "Yes" : "No"}
              />
            )}
            {getStringMetadata(resource.metadata.arn) && !isLambda && (
              <InspectorItem
                label="ARN"
                value={getStringMetadata(resource.metadata.arn)!}
              />
            )}
            <InspectorItem
              label="Tags"
              value={tagsUnavailable ? "Unavailable" : `${tags.length}`}
            />
            {isLambda && (
              <>
                <InspectorItem
                  label="Runtime"
                  value={getStringMetadata(resource.metadata.runtime) ?? "-"}
                />
                <InspectorItem
                  label="Handler"
                  value={getStringMetadata(resource.metadata.handler) ?? "-"}
                />
                <InspectorItem
                  label="Package Type"
                  value={getStringMetadata(resource.metadata.packageType) ?? "-"}
                />
              </>
            )}
          </div>
          <section className="inspector-section">
            <p className="metric-label">Tags</p>
            {tagsUnavailable ? (
              <p className="muted compact-text">
                Tags unavailable: the provider denied or failed the tag lookup.
              </p>
            ) : tags.length === 0 ? (
              <p className="muted compact-text">
                No tags returned for this resource.
              </p>
            ) : (
              <div className="metadata-tags">
                {tags.map((tag) => (
                  <span className="metadata-tag" key={`${tag.key}:${tag.value}`}>
                    <strong>{tag.key}</strong>
                    <span>{tag.value}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
          {isDatabase && (
            <DatabaseConnectionsSection metadata={resource.metadata} />
          )}
          {isAwsDatabase && <DatabaseLifecycleSection status={resource.status} />}
          {isDatabase && !isAwsDatabase && (
            <ProviderDatabaseSection cloud={resource.cloud} />
          )}
          {isK8sEngine && (
            <K8sEngineDetails cloud={resource.cloud} clusterName={resource.name} />
          )}
          {isLambda && (
            <section className="inspector-section">
              <p className="metric-label">Lambda Details</p>
              <div className="inspector-grid compact-grid">
                <InspectorItem
                  label="ARN"
                  value={getStringMetadata(resource.metadata.arn) ?? "-"}
                />
                <InspectorItem
                  label="Last Modified"
                  value={getStringMetadata(resource.metadata.lastModified) ?? "-"}
                />
                <InspectorItem
                  label="Memory"
                  value={
                    getNumberMetadata(resource.metadata.memorySize) === null
                      ? "-"
                      : `${getNumberMetadata(resource.metadata.memorySize)} MB`
                  }
                />
                <InspectorItem
                  label="Timeout"
                  value={
                    getNumberMetadata(resource.metadata.timeout) === null
                      ? "-"
                      : `${getNumberMetadata(resource.metadata.timeout)}s`
                  }
                />
              </div>
            </section>
          )}
          {isSqsQueue && (
            <section className="inspector-section">
              <p className="metric-label">Queue Details</p>
              <div className="inspector-grid compact-grid">
                <InspectorItem
                  label="Visibility Timeout"
                  value={
                    getNumberMetadata(resource.metadata.visibilityTimeout) !== null
                      ? `${getNumberMetadata(resource.metadata.visibilityTimeout)}s`
                      : "-"
                  }
                />
                <InspectorItem
                  label="Retention Period"
                  value={
                    getNumberMetadata(resource.metadata.messageRetentionPeriod) !== null
                      ? `${getNumberMetadata(resource.metadata.messageRetentionPeriod)}s`
                      : "-"
                  }
                />
                <InspectorItem
                  label="Delivery Delay"
                  value={
                    getNumberMetadata(resource.metadata.delaySeconds) !== null
                      ? `${getNumberMetadata(resource.metadata.delaySeconds)}s`
                      : "-"
                  }
                />
                <InspectorItem
                  label="Max Message Size"
                  value={
                    getNumberMetadata(resource.metadata.maximumMessageSize) !== null
                      ? formatBytes(getNumberMetadata(resource.metadata.maximumMessageSize)!)
                      : "-"
                  }
                />
                <InspectorItem
                  label="Receive Wait Time"
                  value={
                    getNumberMetadata(resource.metadata.receiveMessageWaitTimeSeconds) !== null
                      ? `${getNumberMetadata(resource.metadata.receiveMessageWaitTimeSeconds)}s`
                      : "-"
                  }
                />
                <InspectorItem
                  label="Messages in Flight"
                  value={
                    getNumberMetadata(resource.metadata.messagesInFlight) !== null
                      ? `${getNumberMetadata(resource.metadata.messagesInFlight)}`
                      : "-"
                  }
                />
                <InspectorItem
                  label="Messages Delayed"
                  value={
                    getNumberMetadata(resource.metadata.messagesDelayed) !== null
                      ? `${getNumberMetadata(resource.metadata.messagesDelayed)}`
                      : "-"
                  }
                />
              </div>
            </section>
          )}
          {isOciQueue && (
            <section className="inspector-section">
              <p className="metric-label">Queue Details</p>
              <div className="inspector-grid compact-grid">
                <InspectorItem
                  label="Visibility Timeout"
                  value={getNumberMetadata(resource.metadata.visibilityInSeconds) !== null
                    ? `${getNumberMetadata(resource.metadata.visibilityInSeconds)}s` : "-"}
                />
                <InspectorItem
                  label="Retention Period"
                  value={getNumberMetadata(resource.metadata.retentionInSeconds) !== null
                    ? `${getNumberMetadata(resource.metadata.retentionInSeconds)}s` : "-"}
                />
                <InspectorItem
                  label="Dead Letter Delivery Count"
                  value={getNumberMetadata(resource.metadata.deadLetterQueueDeliveryCount) !== null
                    ? `${getNumberMetadata(resource.metadata.deadLetterQueueDeliveryCount)}` : "-"}
                />
                <InspectorItem
                  label="Visible Messages"
                  value={getNumberMetadata(resource.metadata.approximateMessages) !== null
                    ? `${getNumberMetadata(resource.metadata.approximateMessages)}` : "-"}
                />
                <InspectorItem
                  label="Messages in Flight"
                  value={getNumberMetadata(resource.metadata.messagesInFlight) !== null
                    ? `${getNumberMetadata(resource.metadata.messagesInFlight)}` : "-"}
                />
                <InspectorItem
                  label="Dead Letter Messages"
                  value={getNumberMetadata(resource.metadata.deadLetterMessages) !== null
                    ? `${getNumberMetadata(resource.metadata.deadLetterMessages)}` : "-"}
                />
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'json' && (
        <div className="relative"
          role="tabpanel"
          id="inspector-tabpanel-json"
          aria-labelledby="inspector-tab-json"
        >
          <Hint label="Copy JSON data"><Button variant="secondary" size="sm"
            className="absolute inline-flex items-center gap-1 top-2 right-2 z-2"
            type="button"
            onClick={() => handleCopyJson(resource.metadata)}
          >
            {copiedJson ? (
              <Icon icon={Check} className="text-ok-text" size={14} />
            ) : (
              <Icon icon={Copy} size={14} />
            )}
            <span>{copiedJson ? "Copied" : "Copy"}</span>
          </Button></Hint>
          <pre
            className="metadata-block pt-9 border-t-0"
          >
            {JSON.stringify(resource.metadata, null, 2)}
          </pre>
        </div>
      )}

      {activeTab === 'table' && (
        <div
          role="tabpanel"
          id="inspector-tabpanel-table"
          aria-labelledby="inspector-tab-table"
        >
          <MetadataPanel metadata={resource.metadata} />
        </div>
      )}

      {isLogGroup && cloud && (
        <>
          <LogsQueryPanel cloud={cloud} logGroupName={resource.id} runtimeReachable={runtimeReachable ?? false} />
          <LogsExplorerPanel cloud={cloud} resource={resource} runtimeReachable={runtimeReachable ?? false} />
        </>
      )}
      {isGcpLog && <GcpLogsPanel key={resource.id} logName={resource.id} runtimeReachable={runtimeReachable ?? false} />}
    </aside>
  );
}

function EmailInspector({ resource }: { resource: CloudResource }) {
  const [tab, setTab] = useState<'preview' | 'text' | 'raw'>('preview')
  const source = getStringMetadata(resource.metadata.source) ?? '-'
  const toAddresses = getStringList(resource.metadata.toAddresses)
  const ccAddresses = getStringList(resource.metadata.ccAddresses)
  const bccAddresses = getStringList(resource.metadata.bccAddresses)
  const replyToAddresses = getStringList(resource.metadata.replyToAddresses)
  const textBody = getStringMetadata(resource.metadata.textBody)
  const htmlBody = getStringMetadata(resource.metadata.htmlBody)
  const rawData = getStringMetadata(resource.metadata.rawData)
  const hasPreview = Boolean(htmlBody || textBody)
  const activeTab = tab === 'preview' && !hasPreview ? (rawData ? 'raw' : 'text') : tab

  return (
    <aside className="resource-inspector">
      <div className="widget-header">
        <h2 title={resource.name}>{resource.name}</h2>
        <span className="badge neutral">{getStringMetadata(resource.metadata.messageType) ?? 'email'}</span>
      </div>
      <div className="inspector-grid">
        <InspectorItem label="From" value={source} />
        <InspectorItem label="To" value={toAddresses.join(', ') || '-'} />
        {ccAddresses.length > 0 && <InspectorItem label="Cc" value={ccAddresses.join(', ')} />}
        {bccAddresses.length > 0 && <InspectorItem label="Bcc" value={bccAddresses.join(', ')} />}
        {replyToAddresses.length > 0 && <InspectorItem label="Reply-To" value={replyToAddresses.join(', ')} />}
        <InspectorItem label="Captured At" value={resource.createdAt ?? '-'} />
      </div>
      <section className="inspector-section">
        <div className="drawer-tabs mb-2.5">
          <Button variant={activeTab === 'preview' ? 'secondary' : 'ghost'} disabled={!hasPreview} onClick={() => setTab('preview')}>Preview</Button>
          <Button variant={activeTab === 'text' ? 'secondary' : 'ghost'} disabled={!textBody} onClick={() => setTab('text')}>Text</Button>
          <Button variant={activeTab === 'raw' ? 'secondary' : 'ghost'} disabled={!rawData} onClick={() => setTab('raw')}>Raw</Button>
        </div>
        {activeTab === 'preview' && htmlBody ? (
          <iframe className="email-preview-frame w-full min-h-65 border border-line"
            title="Email HTML preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={safeEmailDocument(htmlBody)}
          />
        ) : activeTab === 'preview' ? (
          <pre className="metadata-block whitespace-pre-wrap m-0">{textBody ?? 'No preview content captured.'}</pre>
        ) : activeTab === 'text' ? (
          <pre className="metadata-block whitespace-pre-wrap m-0">{textBody ?? 'No text body captured.'}</pre>
        ) : (
          <pre className="metadata-block whitespace-pre-wrap break-all m-0">{rawData ?? 'No raw MIME data captured.'}</pre>
        )}
      </section>
    </aside>
  )
}

function safeEmailDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head><body>${html}</body></html>`
}

function ProviderDatabaseSection({ cloud }: { cloud: string }) {
  const label =
    cloud === "azure"
      ? "Azure database"
      : cloud === "gcp"
        ? "Google Cloud SQL"
        : "Database";

  return (
    <section className="inspector-section">
      <p className="metric-label">Lifecycle</p>
      <p className="muted compact-text">
        {label} lifecycle and snapshot actions are exposed through the
        normalized resource metadata only.
      </p>
    </section>
  );
}

function DatabaseConnectionsSection({
  metadata,
}: {
  metadata: Record<string, unknown>;
}) {
  const endpoint = getRecordMetadata(metadata.endpoint);
  const subnetGroup = getRecordMetadata(metadata.subnetGroup);
  const securityGroups = getSecurityGroups(metadata.vpcSecurityGroups);
  const address = getStringMetadata(endpoint?.address);
  const port = getNumberMetadata(endpoint?.port);
  const vpcId = getStringMetadata(subnetGroup?.vpcId);
  const subnetGroupName = getStringMetadata(subnetGroup?.name);
  const subnetGroupStatus = getStringMetadata(subnetGroup?.status);

  return (
    <section className="inspector-section">
      <p className="metric-label">Connections</p>
      <div className="inspector-grid compact-grid">
        <InspectorItem label="Endpoint" value={address ?? "-"} />
        <InspectorItem
          label="Port"
          value={port === null ? "-" : String(port)}
        />
        <InspectorItem label="VPC" value={vpcId ?? "-"} />
        <InspectorItem label="Subnet Group" value={subnetGroupName ?? "-"} />
        <InspectorItem label="Subnet Status" value={subnetGroupStatus ?? "-"} />
        <InspectorItem
          label="Security Groups"
          value={`${securityGroups.length}`}
        />
      </div>
      {securityGroups.length > 0 && (
        <div className="metadata-tags">
          {securityGroups.map((group) => (
            <span className="metadata-tag" key={`${group.id}:${group.status}`}>
              <strong>{group.id}</strong>
              <span>{group.status}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function DatabaseLifecycleSection({ status }: { status?: string | null }) {
  return (
    <section className="inspector-section">
      <p className="metric-label">Lifecycle</p>
      <div className="lifecycle-actions">
        <Button variant="secondary" size="sm" type="button" disabled>
          Start
        </Button>
        <Button variant="secondary" size="sm" type="button" disabled>
          Stop
        </Button>
      </div>
      <p className="muted compact-text">
        Current status: {status ?? "unknown"}. Start and stop are not supported
        by the local Floci RDS runtime.
      </p>
    </section>
  );
}


function InspectorItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="metric-label">{label}</p>
      <p className="metric-value mono">{value}</p>
    </div>
  );
}

function MetadataPanel({ metadata }: { metadata: Record<string, unknown> }) {
  const rows = Object.entries(metadata).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );

  if (rows.length === 0) {
    return (
      <div className="metadata-block empty-metadata">
        <span>No metadata returned</span>
      </div>
    );
  }

  return (
    <div className="metadata-block metadata-table">
      {rows.map(([key, value]) => (
        <div key={key}>
          <span>{humanizeKey(key)}</span>
          <code>{formatMetadataValue(value)}</code>
        </div>
      ))}
    </div>
  );
}

function formatMetadataValue(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


function getStringMetadata(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function getBooleanMetadata(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function getRecordMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getTags(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tag = item as Record<string, unknown>;
    return typeof tag.key === "string" && typeof tag.value === "string"
      ? [{ key: tag.key, value: tag.value }]
      : [];
  });
}

function getSecurityGroups(
  value: unknown,
): Array<{ id: string; status: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const group = item as Record<string, unknown>;
    return typeof group.id === "string"
      ? [
        {
          id: group.id,
          status: typeof group.status === "string" ? group.status : "-",
        },
      ]
      : [];
  });
}
