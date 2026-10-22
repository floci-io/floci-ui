import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {
  purgeDeletedCertificateResource,
  purgeDeletedKmsResource,
  purgeDeletedSecretResource,
  recoverCertificateResource,
  recoverKmsResource,
  recoverSecretResource,
  rotateKmsResource,
} from "@/api/cloudProxyClient";
import {AzureKeyVaultPanel} from "@/components/AzureKeyVaultPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  recoverSecretResource: vi.fn(),
  purgeDeletedSecretResource: vi.fn(),
  recoverKmsResource: vi.fn(),
  purgeDeletedKmsResource: vi.fn(),
  rotateKmsResource: vi.fn(),
  recoverCertificateResource: vi.fn(),
  purgeDeletedCertificateResource: vi.fn(),
}));

const activeSecret: CloudResource = {
  id: "db-password",
  name: "db-password",
  cloud: "azure",
  service: "secrets",
  type: "secret",
  region: null,
  createdAt: null,
  status: "enabled",
  metadata: {
    versions: [
      {version: "bbb222", enabled: true, createdAt: "2026-05-20T20:01:40.000Z", contentType: "application/json", current: true},
      {version: "aaa111", enabled: false, createdAt: "2026-05-20T20:00:00.000Z", contentType: null, current: false},
    ],
  },
};

const deletedSecret: CloudResource = {
  ...activeSecret,
  status: "deleted",
  metadata: {deletedAt: "2026-05-20T20:01:40.000Z", scheduledPurgeAt: "2026-05-27T20:01:40.000Z"},
};

const activeKey: CloudResource = {
  id: "app-key",
  name: "app-key",
  cloud: "azure",
  service: "kms",
  type: "key",
  region: null,
  createdAt: null,
  status: "enabled",
  metadata: {
    versions: [
      {version: "bbb222", enabled: true, createdAt: "2026-05-20T20:01:40.000Z", current: true},
      {version: "aaa111", enabled: true, createdAt: "2026-05-20T20:00:00.000Z", current: false},
    ],
  },
};

const deletedKey: CloudResource = {
  ...activeKey,
  status: "deleted",
  metadata: {deletedAt: "2026-05-20T20:01:40.000Z", scheduledPurgeAt: "2026-05-27T20:01:40.000Z"},
};

const activeCertificate: CloudResource = {
  id: "app-tls",
  name: "app-tls",
  cloud: "azure",
  service: "certificates",
  type: "certificate",
  region: null,
  createdAt: null,
  status: "enabled",
  metadata: {
    versions: [{version: "bbb222", enabled: true, createdAt: "2026-05-20T20:01:40.000Z", current: true}],
  },
};

const deletedCertificate: CloudResource = {
  ...activeCertificate,
  status: "deleted",
  metadata: {deletedAt: "2026-05-20T20:01:40.000Z", scheduledPurgeAt: "2026-05-27T20:01:40.000Z"},
};

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("AzureKeyVaultPanel", () => {
  test("lists the versions of an active secret without recover or purge controls", () => {
    render(<AzureKeyVaultPanel resource={activeSecret} runtimeReachable={true} onChanged={vi.fn()}/>);

    expect(screen.getByText("bbb222")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.getByText("aaa111")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Recover"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Purge"})).not.toBeInTheDocument();
  });

  test("recovers a deleted secret and reports the change", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(recoverSecretResource).mockResolvedValue(activeSecret);
    render(<AzureKeyVaultPanel resource={deletedSecret} runtimeReachable={true} onChanged={onChanged}/>);

    await user.click(screen.getByRole("button", {name: "Recover"}));

    expect(recoverSecretResource).toHaveBeenCalledWith("azure", "db-password", expect.any(AbortSignal));
    expect(onChanged).toHaveBeenCalledExactlyOnceWith("removed");
  });

  test("asks for confirmation before purging and cancelling sends nothing", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(purgeDeletedSecretResource).mockResolvedValue(undefined);
    render(<AzureKeyVaultPanel resource={deletedSecret} runtimeReachable={true} onChanged={onChanged}/>);

    await user.click(screen.getByRole("button", {name: "Purge"}));
    await user.click(screen.getByRole("button", {name: "Cancel"}));
    expect(purgeDeletedSecretResource).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", {name: "Purge"}));
    await user.click(screen.getByRole("button", {name: "Confirm purge"}));

    expect(purgeDeletedSecretResource).toHaveBeenCalledWith("azure", "db-password", expect.any(AbortSignal));
    expect(onChanged).toHaveBeenCalledExactlyOnceWith("removed");
  });

  test("shows the runtime error and keeps the secret selected when recover fails", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(recoverSecretResource).mockRejectedValue(new Error("A deleted secret was not found"));
    render(<AzureKeyVaultPanel resource={deletedSecret} runtimeReachable={true} onChanged={onChanged}/>);

    await user.click(screen.getByRole("button", {name: "Recover"}));

    expect(await screen.findByText("A deleted secret was not found")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("disables recover and purge while the runtime is unreachable", () => {
    render(<AzureKeyVaultPanel resource={deletedSecret} runtimeReachable={false} onChanged={vi.fn()}/>);

    expect(screen.getByRole("button", {name: "Recover"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Purge"})).toBeDisabled();
  });

  test("renders nothing for another service", () => {
    const {container} = render(
      <AzureKeyVaultPanel resource={{...activeSecret, service: "storage"}} runtimeReachable={true} onChanged={vi.fn()}/>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("lists key versions without a content type column and offers rotate", () => {
    render(<AzureKeyVaultPanel resource={activeKey} runtimeReachable={true} onChanged={vi.fn()}/>);

    expect(screen.getByText("Key versions")).toBeInTheDocument();
    expect(screen.getByText("Key material is never shown in the console.")).toBeInTheDocument();
    expect(screen.getByText("bbb222")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.queryByText("Content type")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Rotate key"})).toBeEnabled();
  });

  test("rotates a key and reports it as updated so the selection stays", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(rotateKmsResource).mockResolvedValue(activeKey);
    render(<AzureKeyVaultPanel resource={activeKey} runtimeReachable={true} onChanged={onChanged}/>);

    await user.click(screen.getByRole("button", {name: "Rotate key"}));

    expect(rotateKmsResource).toHaveBeenCalledWith("azure", "app-key", expect.any(AbortSignal));
    expect(onChanged).toHaveBeenCalledExactlyOnceWith("updated");
  });

  test("does not offer rotate for a disabled key or while the runtime is unreachable", () => {
    const {rerender} = render(
      <AzureKeyVaultPanel resource={{...activeKey, status: "disabled"}} runtimeReachable={true} onChanged={vi.fn()}/>,
    );
    expect(screen.getByRole("button", {name: "Rotate key"})).toBeDisabled();

    rerender(<AzureKeyVaultPanel resource={activeKey} runtimeReachable={false} onChanged={vi.fn()}/>);
    expect(screen.getByRole("button", {name: "Rotate key"})).toBeDisabled();
  });

  test("recovers and purges a deleted key through the key endpoints, never the secret ones", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(recoverKmsResource).mockResolvedValue(activeKey);
    vi.mocked(purgeDeletedKmsResource).mockResolvedValue(undefined);
    render(<AzureKeyVaultPanel resource={deletedKey} runtimeReachable={true} onChanged={onChanged}/>);

    expect(screen.getByText("Deleted key")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Rotate key"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Recover"}));
    expect(recoverKmsResource).toHaveBeenCalledWith("azure", "app-key", expect.any(AbortSignal));

    await user.click(screen.getByRole("button", {name: "Purge"}));
    await user.click(screen.getByRole("button", {name: "Confirm purge"}));
    expect(purgeDeletedKmsResource).toHaveBeenCalledWith("azure", "app-key", expect.any(AbortSignal));
    expect(recoverSecretResource).not.toHaveBeenCalled();
    expect(purgeDeletedSecretResource).not.toHaveBeenCalled();
  });

  test("lists certificate versions with no rotate or content type", () => {
    render(<AzureKeyVaultPanel resource={activeCertificate} runtimeReachable={true} onChanged={vi.fn()}/>);

    expect(screen.getByText("Certificate versions")).toBeInTheDocument();
    expect(screen.getByText("Private keys are never shown in the console.")).toBeInTheDocument();
    expect(screen.getByText("bbb222")).toBeInTheDocument();
    expect(screen.queryByText("Content type")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Rotate key"})).not.toBeInTheDocument();
  });

  test("recovers and purges a deleted certificate through the certificate endpoints only", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(recoverCertificateResource).mockResolvedValue(activeCertificate);
    vi.mocked(purgeDeletedCertificateResource).mockResolvedValue(undefined);
    render(<AzureKeyVaultPanel resource={deletedCertificate} runtimeReachable={true} onChanged={onChanged}/>);

    expect(screen.getByText("Deleted certificate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Recover"}));
    expect(recoverCertificateResource).toHaveBeenCalledWith("azure", "app-tls", expect.any(AbortSignal));
    expect(onChanged).toHaveBeenCalledWith("removed");

    await user.click(screen.getByRole("button", {name: "Purge"}));
    await user.click(screen.getByRole("button", {name: "Confirm purge"}));
    expect(purgeDeletedCertificateResource).toHaveBeenCalledWith("azure", "app-tls", expect.any(AbortSignal));
    expect(recoverKmsResource).not.toHaveBeenCalled();
    expect(recoverSecretResource).not.toHaveBeenCalled();
  });
});
