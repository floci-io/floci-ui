import {useEffect, useRef, useState} from "react";
import {Icon, Copy, KeyRound, Loader2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {Textarea} from '@/components/sodium/ui/textarea'
import {
  cancelKmsDeletionResource,
  rotateKmsResource,
  signKmsResource,
  verifyKmsResource,
  type KmsSignResponse,
  type KmsSigningAlgorithm,
} from "@/api/cloudProxyClient";
import {useAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

interface OciKmsActionsPanelProps {
  resource?: CloudResource;
  runtimeReachable: boolean;
  onChanged: () => void;
}

type SigningMode = "sign" | "verify";

const RSA_ALGORITHMS: KmsSigningAlgorithm[] = [
  "SHA_256_RSA_PKCS1_V1_5",
  "SHA_384_RSA_PKCS1_V1_5",
  "SHA_512_RSA_PKCS1_V1_5",
];
const ECDSA_ALGORITHMS: KmsSigningAlgorithm[] = [
  "ECDSA_SHA_256",
  "ECDSA_SHA_384",
  "ECDSA_SHA_512",
];

export function OciKmsActionsPanel({resource, runtimeReachable, onChanged}: OciKmsActionsPanelProps) {
  const accountId = useAccountId();
  const shape = resource?.metadata.algorithm;
  const isKey = resource?.type === "key";
  const pendingDeletion = resource?.status === "PENDING_DELETION" || resource?.status === "SCHEDULING_DELETION";
  const enabled = resource?.status === "ENABLED" && resource?.metadata.enabled === true;
  const canSign = isKey && enabled && (shape === "RSA" || shape === "ECDSA");
  const algorithms = shape === "RSA" ? RSA_ALGORITHMS : ECDSA_ALGORITHMS;
  const initialAlgorithm = defaultSigningAlgorithm(resource);
  const [mode, setMode] = useState<SigningMode>("sign");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [versionId, setVersionId] = useState("");
  const [algorithm, setAlgorithm] = useState<KmsSigningAlgorithm>(initialAlgorithm);
  const [signed, setSigned] = useState<KmsSignResponse | null>(null);
  const [verification, setVerification] = useState<boolean | null>(null);
  const [operationResult, setOperationResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setMode("sign");
    setMessage("");
    setSignature("");
    setVersionId("");
    setAlgorithm(initialAlgorithm);
    setSigned(null);
    setVerification(null);
    setOperationResult(null);
    setError(null);
    setPending(false);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [accountId, resource?.id, initialAlgorithm]);

  if (!resource || resource.cloud !== "oci" || resource.service !== "kms") return null;

  const switchMode = (next: SigningMode) => {
    if (next === mode || pending) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setMode(next);
    setMessage("");
    setSignature("");
    setVersionId("");
    setSigned(null);
    setVerification(null);
    setError(null);
    setPending(false);
  };

  const changeInput = (field: "message" | "signature" | "version" | "algorithm", value: string) => {
    if (pending) return;
    setSigned(null);
    setVerification(null);
    setError(null);
    if (field === "message") setMessage(value);
    else if (field === "signature") setSignature(value);
    else if (field === "version") setVersionId(value);
    else setAlgorithm(value as KmsSigningAlgorithm);
  };

  const run = async (operation: "sign" | "verify" | "rotate" | "cancel") => {
    if (pending || !runtimeReachable) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    setError(null);
    setSigned(null);
    setVerification(null);
    setOperationResult(null);
    try {
      if (operation === "rotate") {
        const updated = await rotateKmsResource("oci", resource.id);
        onChanged();
        if (controller.signal.aborted) return;
        setOperationResult(`Current key version: ${String(updated.metadata.currentKeyVersion ?? "unknown")}`);
      } else if (operation === "cancel") {
        await cancelKmsDeletionResource("oci", resource.id);
        onChanged();
        if (controller.signal.aborted) return;
        setOperationResult("Scheduled deletion cancelled.");
      } else {
        if (!message) throw new Error("Enter a message to sign or verify.");
        const messageBase64 = utf8ToBase64(message);
        if (operation === "sign") {
          const result = await signKmsResource("oci", resource.id, {messageBase64, signingAlgorithm: algorithm}, controller.signal);
          if (controller.signal.aborted) return;
          setSigned(result);
        } else {
          if (!signature.trim() || !versionId.trim()) throw new Error("Enter the signature and key version ID.");
          const result = await verifyKmsResource("oci", resource.id, {
            messageBase64,
            signatureBase64: signature.trim(),
            keyVersionId: versionId.trim(),
            signingAlgorithm: algorithm,
          }, controller.signal);
          if (controller.signal.aborted) return;
          setVerification(result.isSignatureValid);
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "KMS operation failed.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending(false);
      }
    }
  };

  const useSignature = () => {
    if (!signed) return;
    setSignature(signed.signatureBase64);
    setVersionId(signed.keyVersionId);
    setAlgorithm(signed.signingAlgorithm);
    setMode("verify");
    setSigned(null);
  };

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">OCI Vault Actions</p>
          <h2><Icon icon={KeyRound} /> Key operations</h2>
          <p className="muted compact-text">Messages and signatures stay in this panel and clear when the key or account changes.</p>
        </div>
      </div>
      <div className="resource-create-inline oci-kms-actions">
        {isKey && (
          <>
            <p className="muted compact-text">Current key version: {String(resource.metadata.currentKeyVersion ?? "unknown")}</p>
            <Button variant="secondary" type="button" disabled={!enabled || !runtimeReachable || pending} onClick={() => void run("rotate")}>
              {pending ? <Icon icon={Loader2} size={14} className="spin"/> : null} Rotate key
            </Button>
          </>
        )}
        {pendingDeletion && (
          <Button variant="secondary" type="button" disabled={!runtimeReachable || pending} onClick={() => void run("cancel")}>
            Cancel scheduled deletion
          </Button>
        )}
        {canSign && (
          <>
            <div className="drawer-tabs">
              <Button variant={mode === "sign" ? 'secondary' : 'ghost'} type="button" disabled={pending} onClick={() => switchMode("sign")}>Sign</Button>
              <Button variant={mode === "verify" ? 'secondary' : 'ghost'} type="button" disabled={pending} onClick={() => switchMode("verify")}>Verify</Button>
            </div>
            <label className="metric-label" htmlFor="oci-kms-signing-algorithm">Signing algorithm</label>
            <OptionSelect id="oci-kms-signing-algorithm" value={algorithm} disabled={pending} onValueChange={(value) => changeInput("algorithm", value)}>
              {algorithms.map((value) => <option key={value} value={value}>{value}</option>)}
            </OptionSelect>
            <label className="metric-label" htmlFor="oci-kms-message">Message (UTF-8)</label>
            <Textarea id="oci-kms-message" className="json-editor" value={message} disabled={pending} onChange={(event) => changeInput("message", event.target.value)}
              spellCheck={false} autoComplete="off"/>
            {mode === "verify" && (
              <>
                <label className="metric-label" htmlFor="oci-kms-signature">Signature (Base64)</label>
                <Textarea id="oci-kms-signature" className="json-editor" value={signature} disabled={pending} onChange={(event) => changeInput("signature", event.target.value)}
                  spellCheck={false} autoComplete="off"/>
                <label className="metric-label" htmlFor="oci-kms-version">Key version ID</label>
                <Input id="oci-kms-version" value={versionId} disabled={pending} onChange={(event) => changeInput("version", event.target.value)} autoComplete="off"/>
              </>
            )}
            <Button type="button" disabled={!runtimeReachable || pending} onClick={() => void run(mode)}>
              {pending ? "Working" : mode === "sign" ? "Sign" : "Verify"}
            </Button>
          </>
        )}
        {signed && (
          <div className="inspector-section">
            <p className="metric-label">Signature (Base64)</p>
            <pre className="invoke-result success">{signed.signatureBase64}</pre>
            <p className="muted compact-text">Key version: {signed.keyVersionId}</p>
            <Button variant="secondary" type="button" onClick={() => void navigator.clipboard.writeText(signed.signatureBase64)}>
              <Icon icon={Copy} size={14}/> Copy signature
            </Button>
            <Button variant="secondary" type="button" onClick={useSignature}>Use in Verify</Button>
          </div>
        )}
        {verification !== null && <p className={verification ? "success-text" : "error-text"}>Signature {verification ? "valid" : "invalid"}</p>}
        {operationResult && <p className="muted compact-text">{operationResult}</p>}
        {error && <p className="error-text compact-text">{error}</p>}
      </div>
    </section>
  );
}

function defaultSigningAlgorithm(resource?: CloudResource): KmsSigningAlgorithm {
  if (resource?.metadata.algorithm === "RSA") return "SHA_256_RSA_PKCS1_V1_5";
  if (resource?.metadata.curveId === "NIST_P384") return "ECDSA_SHA_384";
  if (resource?.metadata.curveId === "NIST_P521") return "ECDSA_SHA_512";
  return "ECDSA_SHA_256";
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}
