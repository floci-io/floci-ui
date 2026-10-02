import {act, render, renderHook, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {ThemeToggle} from "@/components/ThemeToggle";
import {useTheme} from "@/lib/useTheme";

beforeEach(() => {
  const {result, unmount} = renderHook(() => useTheme());
  act(() => result.current.setTheme("dark"));
  unmount();
});

afterEach(() => vi.unstubAllGlobals());

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

  test.each(["light", "dark"] as const)("follows a %s system theme until the header selects a fixed theme", async (colorScheme) => {
    let dark = colorScheme === "dark";
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return dark; },
      media: "(prefers-color-scheme: dark)",
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    })));
    render(<ThemeToggle/>);
    const {result} = renderHook(() => useTheme());

    act(() => result.current.setTheme("system"));

    expect(toggle()).toHaveAttribute("aria-pressed", String(dark));
    expect(toggle()).toHaveAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
    expect(localStorage.getItem("floci-theme")).toBe("system");

    act(() => {
      dark = !dark;
      listeners.forEach((listener) => listener());
    });

    expect(toggle()).toHaveAttribute("aria-pressed", String(dark));
    expect(document.documentElement).toHaveAttribute("data-theme", dark ? "dark" : "light");
    expect(localStorage.getItem("floci-theme")).toBe("system");

    await userEvent.click(toggle());

    expect(result.current.theme).toBe(colorScheme);
    expect(toggle()).toHaveAttribute("aria-pressed", String(colorScheme === "dark"));
    expect(document.documentElement).toHaveAttribute("data-theme", colorScheme);
    expect(localStorage.getItem("floci-theme")).toBe(colorScheme);

    act(() => {
      dark = !dark;
      listeners.forEach((listener) => listener());
    });
    act(() => {
      dark = !dark;
      listeners.forEach((listener) => listener());
    });

    expect(result.current.theme).toBe(colorScheme);
    expect(document.documentElement).toHaveAttribute("data-theme", colorScheme);
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
