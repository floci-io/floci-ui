import {useEffect, useState} from "react";
import {ChevronDown, ChevronUp, Copy, Loader2, Play, Zap} from "lucide-react";
import {useMutation} from "@tanstack/react-query";
import {invokeCloudResource} from "@/api/cloudProxyClient";
import type {ServerlessInvokeResult} from "@/api/cloudProxyClient";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

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
      resource.type === "gcp-function");

  const canInvoke = Boolean(resource && isSupportedResource && runtimeReachable);
  const canSubmit = canInvoke && !validationError;

  const providerLabel =
    cloud === "aws"
      ? "Lambda function"
      : cloud === "azure"
        ? "Azure Function"
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

  const copyResponse = async () => {
    if (!invokeResult) return;
    await navigator.clipboard.writeText(invokeResult.payload || "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (!resource || resource.service !== "serverless") {
    return (
      <section className="table-panel">
        <div className="empty compact">
          <h3>Select a serverless function</h3>
          <p>
            Select a Lambda function, Azure Function, or Google Cloud Function to
            invoke it from Cloud Explorer.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Serverless Actions</p>
          <h3>
            <Zap size={15} />
            Invoke {providerLabel}
          </h3>
          <p className="muted compact-text">
            Send a JSON event payload to the selected serverless function.
          </p>
        </div>
        <span className={`runtime-state ${canInvoke ? "ready" : "pending"}`}>
          {canInvoke ? "Ready" : "Runtime unavailable"}
        </span>
      </div>

      <div className="resource-create-inline">
        <label>
          <span className="metric-label">Event payload JSON</span>
          <textarea
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
            style={{minHeight: 140}}
          />
        </label>

        {validationError && (
          <p className="error-text compact-text">
            {validationError}
          </p>
        )}

        <button
          className="button primary"
          type="button"
          disabled={!canSubmit || invokeMutation.isPending}
          onClick={() => invokeMutation.mutate()}
        >
          {invokeMutation.isPending ? <Loader2 size={13} /> : <Play size={13} />}
          {invokeMutation.isPending ? "Invoking" : "Invoke"}
        </button>

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

            <button className="button" type="button" onClick={copyResponse}>
              <Copy size={13} />
              {copied ? "Copied" : "Copy response"}
            </button>

            <pre className={`invoke-result ${isInvokeError ? "error" : "success"}`}>
              {tryFormatJson(invokeResult.payload) || "(empty)"}
            </pre>

            {invokeResult.logResult && (
              <div>
                <button
                  className="button"
                  type="button"
                  onClick={() => setShowLog((open) => !open)}
                >
                  Log tail
                  {showLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
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