import {useEffect, useState} from "react";
import {Icon, ChevronDown, ChevronUp, Copy, Loader2, Play, Wand2, ZapSquared as Zap} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Textarea} from '@/components/sodium/ui/textarea'
import {useMutation} from "@tanstack/react-query";
import {invokeCloudResource} from "@/api/cloudProxyClient";
import type {ServerlessInvokeResult} from "@/api/cloudProxyClient";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";
import {EmptyState} from '@/components/EmptyState'

interface ServerlessInvokePanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

export function ServerlessInvokePanel({
  cloud,
  resource,
  runtimeReachable,
}: ServerlessInvokePanelProps) {
  const [payload, setPayload] = useState("{\n  \n}");
  const [invokeResult, setInvokeResult] = useState<ServerlessInvokeResult | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setPayload("{\n  \n}");
    setInvokeResult(null);
    setShowLog(false);
    setCopied(false);
    setValidationError(null);
  }, [resource?.id]);

  const isSupportedResource =
    resource?.service === "serverless" &&
    (resource.type === "lambda" ||
      resource.type === "azure-function" ||
      resource.type === "gcp-function" ||
      resource.type === "oci-function");

  const canInvoke = Boolean(resource && isSupportedResource && runtimeReachable);
  const canSubmit = canInvoke && !validationError;

  const providerLabel =
    cloud === "aws"
      ? "Lambda function"
      : cloud === "azure"
        ? "Azure Function"
        : cloud === "oci"
          ? "OCI function"
          : "Google Cloud Function";

  const invokeMutation = useMutation({
    mutationFn: () =>
      invokeCloudResource(cloud, "serverless", resource!.id, payload),
    onSuccess: (result) => {
      setInvokeResult(result);
      setShowLog(false);
      setCopied(false);
    },
  });

  const isInvokeError = Boolean(
    invokeResult?.functionError || (invokeResult && invokeResult.statusCode >= 400),
  );

    const formatPayload = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(payload), null, 2);
      setPayload(formatted);
      setValidationError(null);
    } catch {
      setValidationError("Payload must be valid JSON before formatting.");
    }
  };

const clearPayload = () => {
  setPayload("{}");
  setValidationError(null);
};

  const copyResponse = async () => {
    if (!invokeResult) return;
    await navigator.clipboard.writeText(invokeResult.payload || "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  // Non-function rows (an OCI application, for example) get the empty state, not a runtime badge.
  if (!resource || resource.service !== "serverless" || !isSupportedResource) {
    return (
      <section className="table-panel">
        <EmptyState compact title="Select a serverless function" description={<>Select a Lambda function, Azure Function, Google Cloud Function, or OCI function to
            invoke it from Cloud Explorer.</>}/>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Serverless Actions</p>
          <h2>
            <Icon icon={Zap}  />
            Invoke {providerLabel}
          </h2>
          <p className="muted compact-text">
            Send a JSON event payload to the selected serverless function.
          </p>
        </div>
        <span className={`runtime-state ${canInvoke ? "ready" : "pending"}`}>
          {canInvoke ? "Ready" : "Runtime unavailable"}
        </span>
      </div>

      <div className="resource-create-inline">
      
  <div className="inspector-section-header">
  <label className="metric-label" htmlFor="serverless-invoke-payload">
    Event payload JSON
  </label>

  <Button variant="secondary" type="button" onClick={formatPayload}>
    <Icon icon={Wand2} size={14} />
    Format JSON
  </Button>

<Button variant="secondary" type="button" onClick={clearPayload}>
  Clear
</Button>
</div>

<Textarea
  id="serverless-invoke-payload"
  className="json-editor"
  value={payload}
  onChange={(event) => {
    const value = event.target.value;
    setPayload(value);

    try {
      JSON.parse(value);
      setValidationError(null);
    } catch {
      setValidationError("Payload must be valid JSON.");
    }
  }}
  spellCheck={false}
  placeholder="{}"
/>
        {validationError && (
          <p className="error-text compact-text">
            {validationError}
          </p>
        )}

        <Button
          type="button"
          disabled={!canSubmit || invokeMutation.isPending}
          onClick={() => invokeMutation.mutate()}
        >
          {invokeMutation.isPending ? <Icon icon={Loader2} size={14} /> : <Icon icon={Play} size={14} />}
          {invokeMutation.isPending ? "Invoking" : "Invoke"}
        </Button>

        {invokeMutation.isError && (
          <p className="error-text compact-text">
            {invokeMutation.error instanceof Error
              ? invokeMutation.error.message
              : "Invocation failed"}
          </p>
        )}

        {invokeResult && (
          <div className="inspector-section">
            <div className="inspector-section-header">
              <p className="metric-label">Invocation Result</p>
              <span className={`runtime-state ${isInvokeError ? "unavailable" : "ready"}`}>
                HTTP {invokeResult.statusCode}
              </span>
            </div>

            {invokeResult.executionDuration !== undefined && (
              <p className="muted compact-text">
                Completed in {invokeResult.executionDuration}ms
              </p>
            )}

            {invokeResult.functionError && (
              <p className="error-text compact-text">
                {invokeResult.functionError}
              </p>
            )}

            <Button variant="secondary" type="button" onClick={copyResponse}>
              <Icon icon={Copy} size={14} />
              {copied ? "Copied" : "Copy response"}
            </Button>

            <pre className={`invoke-result ${isInvokeError ? "error" : "success"}`}>
              {tryFormatJson(invokeResult.payload) || "(empty)"}
            </pre>

            {invokeResult.logResult && (
              <div>
                <Button variant="secondary"
                  type="button"
                  onClick={() => setShowLog((open) => !open)}
                >
                  Log tail
                  {showLog ? <Icon icon={ChevronUp} size={14} /> : <Icon icon={ChevronDown} size={14} />}
                </Button>
                {showLog && <div className="log-tail">{invokeResult.logResult}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function tryFormatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}