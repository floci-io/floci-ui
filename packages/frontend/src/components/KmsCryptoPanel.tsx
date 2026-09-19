import {useEffect, useRef, useState} from "react";
import {Copy, KeyRound, Loader2, LockKeyhole, UnlockKeyhole} from "lucide-react";
import {
  decryptKmsResource,
  encryptKmsResource,
  type KmsEncryptionAlgorithm,
} from "@/api/cloudProxyClient";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface KmsCryptoPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

type CryptoMode = "encrypt" | "decrypt";
type CryptoResult = {label: string; value: string};

export function KmsCryptoPanel({cloud, resource, runtimeReachable}: KmsCryptoPanelProps) {
  const keySpec = metadataString(resource, "keySpec");
  const keyUsage = metadataString(resource, "keyUsage");
  const keyEnabled = resource?.status === "Enabled" && resource.metadata.enabled === true;
  const [mode, setMode] = useState<CryptoMode>("encrypt");
  const [plaintext, setPlaintext] = useState("");
  const [ciphertext, setCiphertext] = useState("");
  const [algorithm, setAlgorithm] = useState<KmsEncryptionAlgorithm>(defaultAlgorithm(keySpec));
  const [contextText, setContextText] = useState("");
  const [result, setResult] = useState<CryptoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setMode("encrypt");
    setPlaintext("");
    setCiphertext("");
    setAlgorithm(defaultAlgorithm(keySpec));
    setContextText("");
    setResult(null);
    setError(null);
    setPending(false);
    setCopied(false);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [resource?.id, keySpec]);

  const isKmsKey = resource?.service === "kms" && resource.type === "key";
  const isSupportedKey = keyUsage === "ENCRYPT_DECRYPT" && keyEnabled && isEncryptKeySpec(keySpec);
  const canSubmit = Boolean(isKmsKey && isSupportedKey && runtimeReachable && !pending);
  const isRsa = keySpec === "RSA_2048" || keySpec === "RSA_4096";

  const changeMode = (next: CryptoMode) => {
    if (next === mode) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setMode(next);
    setPlaintext("");
    setCiphertext("");
    setContextText("");
    setResult(null);
    setError(null);
    setPending(false);
    setCopied(false);
  };

  const submit = async () => {
    if (!resource || !canSubmit) return;

    setError(null);
    setResult(null);
    setCopied(false);
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    try {
      const encryptionContext = isRsa ? undefined : parseEncryptionContext(contextText);
      if (mode === "encrypt") {
        if (!plaintext) throw new Error("Enter plaintext to encrypt.");
        const response = await encryptKmsResource(cloud, resource.id, {
          plaintextBase64: utf8ToBase64(plaintext),
          encryptionAlgorithm: algorithm,
          ...(encryptionContext ? {encryptionContext} : {}),
        }, controller.signal);
        if (controller.signal.aborted) return;
        setResult({label: "Ciphertext (Base64)", value: response.ciphertextBlobBase64});
      } else {
        if (!ciphertext.trim()) throw new Error("Enter Base64 ciphertext to decrypt.");
        const response = await decryptKmsResource(cloud, resource.id, {
          ciphertextBlobBase64: ciphertext.trim(),
          encryptionAlgorithm: algorithm,
          ...(encryptionContext ? {encryptionContext} : {}),
        }, controller.signal);
        if (controller.signal.aborted) return;
        setResult(decryptedResult(response.plaintextBase64));
      }
    } catch (submitError) {
      if (controller.signal.aborted) return;
      setError(submitError instanceof Error ? submitError.message : "KMS operation failed.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending(false);
      }
    }
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (!resource || resource.service !== "kms") {
    return (
      <section className="table-panel">
        <div className="empty compact">
          <h3>Select an encryption key</h3>
          <p>Select an enabled ENCRYPT_DECRYPT KMS key to encrypt or decrypt data.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">KMS Actions</p>
          <h3><KeyRound size={15} /> Encrypt and decrypt</h3>
          <p className="muted compact-text">
            Values stay in this panel and are cleared when you switch keys or operations.
          </p>
        </div>
        <span className={`runtime-state ${canSubmit ? "ready" : "pending"}`}>
          {canSubmit ? "Ready" : operationUnavailableReason(keyUsage, keyEnabled, keySpec, runtimeReachable)}
        </span>
      </div>

      <div className="resource-create-inline">
        <div className="drawer-tabs">
          <button type="button" className={`drawer-tab ${mode === "encrypt" ? "active" : ""}`} onClick={() => changeMode("encrypt")}>
            <LockKeyhole size={13} /> Encrypt
          </button>
          <button type="button" className={`drawer-tab ${mode === "decrypt" ? "active" : ""}`} onClick={() => changeMode("decrypt")}>
            <UnlockKeyhole size={13} /> Decrypt
          </button>
        </div>

        <label className="metric-label" htmlFor="kms-encryption-algorithm">Encryption algorithm</label>
        <select
          id="kms-encryption-algorithm"
          className="input"
          value={algorithm}
          disabled={!isRsa}
          onChange={(event) => setAlgorithm(event.target.value as KmsEncryptionAlgorithm)}
        >
          {isRsa ? (
            <>
              <option value="RSAES_OAEP_SHA_256">RSAES_OAEP_SHA_256</option>
              <option value="RSAES_OAEP_SHA_1">RSAES_OAEP_SHA_1</option>
            </>
          ) : (
            <option value="SYMMETRIC_DEFAULT">SYMMETRIC_DEFAULT</option>
          )}
        </select>

        <label className="metric-label" htmlFor={`kms-${mode}-input`}>
          {mode === "encrypt" ? "Plaintext (UTF-8)" : "Ciphertext (Base64)"}
        </label>
        <textarea
          id={`kms-${mode}-input`}
          className="json-editor"
          value={mode === "encrypt" ? plaintext : ciphertext}
          onChange={(event) => mode === "encrypt" ? setPlaintext(event.target.value) : setCiphertext(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          style={{minHeight: 120}}
        />

        {!isRsa && (
          <>
            <label className="metric-label" htmlFor="kms-encryption-context">Encryption context (optional JSON)</label>
            <textarea
              id="kms-encryption-context"
              className="json-editor"
              value={contextText}
              onChange={(event) => setContextText(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={'{"purpose":"local-test"}'}
              style={{minHeight: 72}}
            />
            <p className="muted compact-text">Encryption context is authenticated metadata and may appear in audit records. Do not put secrets in it.</p>
          </>
        )}

        <button className="button primary" type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {pending ? <Loader2 size={13} className="spin" /> : mode === "encrypt" ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}
          {pending ? "Working" : mode === "encrypt" ? "Encrypt" : "Decrypt"}
        </button>

        {error && <p className="error-text compact-text">{error}</p>}
        {result && (
          <div className="inspector-section">
            <div className="inspector-section-header">
              <p className="metric-label">{result.label}</p>
              <button className="button" type="button" onClick={() => void copyResult()}>
                <Copy size={13} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="invoke-result success">{result.value}</pre>
          </div>
        )}
      </div>
    </section>
  );
}

function metadataString(resource: CloudResource | undefined, key: string): string | null {
  const value = resource?.metadata[key];
  return typeof value === "string" ? value : null;
}

function defaultAlgorithm(keySpec: string | null): KmsEncryptionAlgorithm {
  return keySpec === "RSA_2048" || keySpec === "RSA_4096"
    ? "RSAES_OAEP_SHA_256"
    : "SYMMETRIC_DEFAULT";
}

function isEncryptKeySpec(keySpec: string | null): boolean {
  return keySpec === "SYMMETRIC_DEFAULT" || keySpec === "RSA_2048" || keySpec === "RSA_4096";
}

function operationUnavailableReason(
  keyUsage: string | null,
  keyEnabled: boolean,
  keySpec: string | null,
  runtimeReachable: boolean,
): string {
  if (!runtimeReachable) return "Runtime unavailable";
  if (keyUsage !== "ENCRYPT_DECRYPT") return "Unsupported key usage";
  if (!keyEnabled) return "Key not enabled";
  if (!isEncryptKeySpec(keySpec)) return "Unsupported key spec";
  return "Unavailable";
}

function parseEncryptionContext(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Encryption context must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Encryption context must be a JSON object of string values.");
  }
  const entries = Object.entries(value);
  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) {
    throw new Error("Encryption context values must be strings.");
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries) as Record<string, string>;
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function decryptedResult(plaintextBase64: string): CryptoResult {
  try {
    const binary = window.atob(plaintextBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return {label: "Plaintext (UTF-8)", value: new TextDecoder("utf-8", {fatal: true}).decode(bytes)};
  } catch {
    return {label: "Plaintext (Base64)", value: plaintextBase64};
  }
}
