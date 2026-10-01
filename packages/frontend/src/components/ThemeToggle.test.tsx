import {act, render, renderHook, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, test, vi} from "vitest";
import {ThemeToggle} from "@/components/ThemeToggle";
import {useTheme} from "@/lib/useTheme";

beforeEach(() => {
  const {result, unmount} = renderHook(() => useTheme());
  act(() => result.current.setTheme("dark"));
  unmount();
});

function toggle() {
  return screen.getByRole("button", {name: "Dark theme"});
}

describe("ThemeToggle", () => {
  test("keeps a stable name and reports dark mode through aria-pressed", async () => {
    render(<ThemeToggle/>);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(toggle()).toHaveAttribute("title", "Switch to light theme");

    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(toggle()).toHaveAttribute("title", "Switch to dark theme");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("floci-theme")).toBe("light");
  });

  test("switches back to dark on a second click", async () => {
    render(<ThemeToggle/>);
    await userEvent.click(toggle());
    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("floci-theme")).toBe("dark");
  });

  test("stays in sync with a theme chosen elsewhere, such as Settings", () => {
    render(<ThemeToggle/>);
    const {result} = renderHook(() => useTheme());

    act(() => result.current.setTheme("light"));

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  test("restores the saved theme after a reload", async () => {
    localStorage.setItem("floci-theme", "light");
    vi.resetModules();
    const {ThemeToggle: FreshToggle} = await import("@/components/ThemeToggle");

    render(<FreshToggle/>);

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
