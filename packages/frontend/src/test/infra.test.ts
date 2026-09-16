describe("test infrastructure", () => {
  it("runs in a jsdom environment with a mutable document", () => {
    expect(document.body).toBeInstanceOf(HTMLElement);

    const marker = document.createElement("div");
    marker.id = "jsdom-marker";
    document.body.appendChild(marker);

    expect(document.getElementById("jsdom-marker")).toBe(marker);
  });

  it("registers the jest-dom matchers", () => {
    const el = document.createElement("p");
    el.textContent = "hello from jest-dom";
    document.body.appendChild(el);

    expect(el).toBeInTheDocument();
  });
});
