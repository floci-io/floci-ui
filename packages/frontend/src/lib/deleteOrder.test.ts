import type { CloudResource } from "@/types/resource";
import { deleteWaves } from "@/lib/deleteOrder";

const resource = (id: string) => ({ id }) as CloudResource;
const ids = (waves: CloudResource[][]) => waves.map((wave) => wave.map((item) => item.id));

describe("deleteWaves", () => {
  it("deletes tables before the dataset that holds them", () => {
    expect(ids(deleteWaves([resource("sales"), resource("sales/orders"), resource("sales/items")]))).toEqual([
      ["sales/orders", "sales/items"],
      ["sales"],
    ]);
  });

  it("keeps unrelated resources in a single wave", () => {
    expect(ids(deleteWaves([resource("a"), resource("b/c"), resource("ab")]))).toEqual([["a", "b/c", "ab"]]);
  });

  it("does not treat a shared name prefix as a parent", () => {
    expect(ids(deleteWaves([resource("sales"), resource("sales2/orders")]))).toEqual([["sales", "sales2/orders"]]);
  });

  it("returns no waves for an empty selection", () => {
    expect(deleteWaves([])).toEqual([]);
  });
});
