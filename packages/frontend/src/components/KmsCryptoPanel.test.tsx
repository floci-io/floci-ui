import {act, fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {encryptKmsResource, type KmsEncryptResponse} from "@/api/cloudProxyClient";
import {KmsCryptoPanel} from "@/components/KmsCryptoPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  decryptKmsResource: vi.fn(),
  encryptKmsResource: vi.fn(),
}));

const resource: CloudResource = {
  id: "key-1",
  name: "key-1",
  cloud: "aws",
  service: "kms",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "Enabled",
  metadata: {
    enabled: true,
    keySpec: "SYMMETRIC_DEFAULT",
    keyUsage: "ENCRYPT_DECRYPT",
  },
};

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("KmsCryptoPanel", () => {
  test("clears sensitive state and ignores an old response when the account changes", async () => {
    setAccountId(DEFAULT_ACCOUNT_ID);
    let resolveEncrypt: ((value: KmsEncryptResponse) => void) | undefined;
    vi.mocked(encryptKmsResource).mockReturnValue(new Promise((resolve) => {
      resolveEncrypt = resolve;
    }));
    const user = userEvent.setup();

    render(<KmsCryptoPanel cloud="aws" resource={resource} runtimeReachable={true}/>);

    await user.type(screen.getByLabelText("Plaintext (UTF-8)"), "account-a-secret");
    fireEvent.change(screen.getByLabelText("Encryption context (optional JSON)"), {
      target: {value: '{"tenant":"a"}'},
    });
    const encryptButtons = screen.getAllByRole("button", {name: "Encrypt"});
    await user.click(encryptButtons[encryptButtons.length - 1]);
    expect(screen.getByRole("button", {name: "Working"})).toBeDisabled();

    act(() => {
      setAccountId("111111111111");
    });

    expect(screen.getByLabelText("Plaintext (UTF-8)")).toHaveValue("");
    expect(screen.getByLabelText("Encryption context (optional JSON)")).toHaveValue("");
    const resetEncryptButtons = screen.getAllByRole("button", {name: "Encrypt"});
    expect(resetEncryptButtons[resetEncryptButtons.length - 1]).toBeEnabled();

    await act(async () => {
      resolveEncrypt?.({
        ciphertextBlobBase64: "old-account-result",
        keyId: "key-1",
        encryptionAlgorithm: "SYMMETRIC_DEFAULT",
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("old-account-result")).not.toBeInTheDocument();
  });
});
