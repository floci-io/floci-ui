import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {render, screen} from "@testing-library/react";
import {describe, expect, test, vi} from "vitest";
import {ServerlessInvokePanel} from "@/components/ServerlessInvokePanel";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({invokeCloudResource: vi.fn()}));

function resource(type: string): CloudResource {
  return {
    id: `ocid1.${type}`,
    name: type,
    cloud: "oci",
    service: "serverless",
    type,
    region: "us-ashburn-1",
    createdAt: null,
    status: "ACTIVE",
    metadata: {},
  };
}

function renderPanel(selected: CloudResource | undefined, cloud: CloudProvider = "oci") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ServerlessInvokePanel cloud={cloud} resource={selected} runtimeReachable={true} />
    </QueryClientProvider>,
  );
}

describe("ServerlessInvokePanel", () => {
  test("asks for a function instead of reporting the runtime unavailable for an application", () => {
    renderPanel(resource("oci-function-application"));
    expect(screen.getByText("Select a serverless function")).toBeInTheDocument();
    expect(screen.queryByText("Runtime unavailable")).not.toBeInTheDocument();
  });

  test("is ready for a function when the runtime is reachable", () => {
    renderPanel(resource("oci-function"));
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  test.each([
    ["aws", "Select a Lambda function to invoke it from Cloud Explorer."],
    ["azure", "Select an Azure Function to invoke it from Cloud Explorer."],
    ["gcp", "Select a Google Cloud Function to invoke it from Cloud Explorer."],
    ["oci", "Select an OCI function to invoke it from Cloud Explorer."],
  ] as const)("names only the %s function kind in the empty-state hint", (cloud, hint) => {
    renderPanel(undefined, cloud);
    const text = screen.getByText(hint).textContent ?? "";
    const otherKinds = ["Lambda", "Azure Function", "Google Cloud Function", "OCI function"]
      .filter((kind) => !hint.includes(kind));
    for (const kind of otherKinds) expect(text).not.toContain(kind);
  });
});
