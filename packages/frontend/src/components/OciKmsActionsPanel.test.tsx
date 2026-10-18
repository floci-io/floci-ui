import {act, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {
  rotateKmsResource,
  signKmsResource,
  verifyKmsResource,
  type KmsSignResponse,
} from "@/api/cloudProxyClient";
import {OciKmsActionsPanel} from "@/components/OciKmsActionsPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  cancelKmsDeletionResource: vi.fn(),
  rotateKmsResource: vi.fn(),
  signKmsResource: vi.fn(),
  verifyKmsResource: vi.fn(),
}));

const ecdsaKey: CloudResource = {
  id: "ocid1.key.oc1.iad.key1",
  name: "signer",
  cloud: "oci",
  service: "kms",
  type: "key",
  region: "us-ashburn-1",
  createdAt: null,
  status: "ENABLED",
  metadata: {algorithm: "ECDSA", curveId: "NIST_P384", enabled: true, keyUsage: "SIGN_VERIFY", currentKeyVersion: "v1"},
};

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("OciKmsActionsPanel", () => {
  test("signs a UTF-8 message and verifies the returned signature with its version", async () => {
    const user = userEvent.setup();
    vi.mocked(signKmsResource).mockResolvedValue({
      signatureBase64: "AQID", keyId: ecdsaKey.id, keyVersionId: "v2", signingAlgorithm: "ECDSA_SHA_384",
    });
    vi.mocked(verifyKmsResource).mockResolvedValue({isSignatureValid: true});
    render(<OciKmsActionsPanel resource={ecdsaKey} runtimeReachable={true} onChanged={vi.fn()}/>);

    expect(screen.getByLabelText("Signing algorithm")).toHaveValue("ECDSA_SHA_384");
    await user.type(screen.getByLabelText("Message (UTF-8)"), "café");
    const signButtons = screen.getAllByRole("button", {name: "Sign"});
    await user.click(signButtons[signButtons.length - 1]);
    expect(vi.mocked(signKmsResource)).toHaveBeenCalledWith("oci", ecdsaKey.id, {
      messageBase64: "Y2Fmw6k=", signingAlgorithm: "ECDSA_SHA_384",
    }, expect.any(AbortSignal));
    await user.click(screen.getByRole("button", {name: "Use in Verify"}));
    expect(screen.getByLabelText("Signature (Base64)")).toHaveValue("AQID");
    expect(screen.getByLabelText("Key version ID")).toHaveValue("v2");
    const verifyButtons = screen.getAllByRole("button", {name: "Verify"});
    await user.click(verifyButtons[verifyButtons.length - 1]);
    expect(vi.mocked(verifyKmsResource)).toHaveBeenCalledWith("oci", ecdsaKey.id, {
      messageBase64: "Y2Fmw6k=", signatureBase64: "AQID", keyVersionId: "v2", signingAlgorithm: "ECDSA_SHA_384",
    }, expect.any(AbortSignal));
    expect(screen.getByText("Signature valid")).toBeInTheDocument();
  });

  test("clears the message and ignores a stale signature after the account changes", async () => {
    const user = userEvent.setup();
    let resolveSign: ((value: KmsSignResponse) => void) | undefined;
    vi.mocked(signKmsResource).mockReturnValue(new Promise((resolve) => { resolveSign = resolve; }));
    render(<OciKmsActionsPanel resource={ecdsaKey} runtimeReachable={true} onChanged={vi.fn()}/>);
    await user.type(screen.getByLabelText("Message (UTF-8)"), "private-message");
    const signButtons = screen.getAllByRole("button", {name: "Sign"});
    await user.click(signButtons[signButtons.length - 1]);
    act(() => setAccountId("111111111111"));
    expect(screen.getByLabelText("Message (UTF-8)")).toHaveValue("");
    await act(async () => {
      resolveSign?.({signatureBase64: "old-signature", keyId: ecdsaKey.id, keyVersionId: "old", signingAlgorithm: "ECDSA_SHA_384"});
      await Promise.resolve();
    });
    expect(screen.queryByText("old-signature")).not.toBeInTheDocument();
  });

  test("does not offer signing for an AES key", () => {
    render(<OciKmsActionsPanel resource={{...ecdsaKey, metadata: {...ecdsaKey.metadata, algorithm: "AES"}}} runtimeReachable={true} onChanged={vi.fn()}/>);
    expect(screen.queryByLabelText("Signing algorithm")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Rotate key"})).toBeEnabled();
  });

  test("invalidates verification when its inputs change", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyKmsResource).mockResolvedValue({isSignatureValid: true});
    render(<OciKmsActionsPanel resource={ecdsaKey} runtimeReachable={true} onChanged={vi.fn()}/>);
    await user.click(screen.getByRole("button", {name: "Verify"}));
    await user.type(screen.getByLabelText("Message (UTF-8)"), "original");
    await user.type(screen.getByLabelText("Signature (Base64)"), "AQID");
    await user.type(screen.getByLabelText("Key version ID"), "v1");
    const verifyButtons = screen.getAllByRole("button", {name: "Verify"});
    await user.click(verifyButtons[verifyButtons.length - 1]);
    expect(screen.getByText("Signature valid")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message (UTF-8)"), " changed");
    expect(screen.queryByText("Signature valid")).not.toBeInTheDocument();
  });

  test("keeps rotation pending across tabs and refreshes after completion", async () => {
    const user = userEvent.setup();
    let resolveRotation: ((value: CloudResource) => void) | undefined;
    vi.mocked(rotateKmsResource).mockReturnValue(new Promise((resolve) => { resolveRotation = resolve; }));
    const onChanged = vi.fn();
    render(<OciKmsActionsPanel resource={ecdsaKey} runtimeReachable={true} onChanged={onChanged}/>);
    await user.click(screen.getByRole("button", {name: "Rotate key"}));
    expect(screen.getByRole("button", {name: "Verify"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Rotate key"})).toBeDisabled();
    await act(async () => {
      resolveRotation?.({...ecdsaKey, metadata: {...ecdsaKey.metadata, currentKeyVersion: "v2"}});
      await Promise.resolve();
    });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByText("Current key version: v2")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Verify"})).toBeEnabled();
  });
});
