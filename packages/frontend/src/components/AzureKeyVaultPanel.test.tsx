import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {purgeDeletedSecretResource, recoverSecretResource} from "@/api/cloudProxyClient";
import {AzureKeyVaultPanel} from "@/components/AzureKeyVaultPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  recoverSecretResource: vi.fn(),
  purgeDeletedSecretResource: vi.fn(),
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
    expect(onChanged).toHaveBeenCalledTimes(1);
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
    expect(onChanged).toHaveBeenCalledTimes(1);
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
      <AzureKeyVaultPanel resource={{...activeSecret, service: "kms"}} runtimeReachable={true} onChanged={vi.fn()}/>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
