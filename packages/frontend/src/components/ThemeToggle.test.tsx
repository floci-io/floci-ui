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
  return screen.getByRole("button", {name: /^Theme: /});
}

describe("ThemeToggle", () => {
  test("names the current setting and the one a click moves to", () => {
    render(<ThemeToggle/>);

    expect(toggle()).toHaveAccessibleName("Theme: Dark");
    expect(toggle()).toHaveAttribute("title", "Theme: Dark. Switch to Light.");
  });

  test("steps through Dark, Light and System in the order Settings lists them", async () => {
    render(<ThemeToggle/>);

    await userEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: Light");
    expect(toggle()).toHaveAttribute("title", "Theme: Light. Switch to System.");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("floci-theme")).toBe("light");

    await userEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: System");
    expect(toggle()).toHaveAttribute("title", "Theme: System. Switch to Dark.");
    expect(localStorage.getItem("floci-theme")).toBe("system");

    await userEvent.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: Dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("floci-theme")).toBe("dark");
  });

  test.each(["light", "dark", "system"] as const)("shows %s when it is chosen elsewhere, such as Settings", (theme) => {
    render(<ThemeToggle/>);
    const {result} = renderHook(() => useTheme());

    act(() => result.current.setTheme(theme));

    expect(toggle()).toHaveAccessibleName(`Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`);
  });

  test.each(["light", "dark"] as const)("stays on System while a %s system theme changes underneath it", async (colorScheme) => {
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

    expect(toggle()).toHaveAccessibleName("Theme: System");
    expect(document.documentElement).toHaveAttribute("data-theme", colorScheme);
    expect(localStorage.getItem("floci-theme")).toBe("system");

    act(() => {
      dark = !dark;
      listeners.forEach((listener) => listener());
    });

    expect(toggle()).toHaveAccessibleName("Theme: System");
    expect(document.documentElement).toHaveAttribute("data-theme", dark ? "dark" : "light");
    expect(localStorage.getItem("floci-theme")).toBe("system");

    // Leaving System pins a fixed theme that no longer follows the OS.
    await userEvent.click(toggle());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    act(() => {
      dark = !dark;
      listeners.forEach((listener) => listener());
    });

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  test("restores the saved theme after a reload", async () => {
    localStorage.setItem("floci-theme", "light");
    vi.resetModules();
    const {ThemeToggle: FreshToggle} = await import("@/components/ThemeToggle");

    render(<FreshToggle/>);

    expect(toggle()).toHaveAccessibleName("Theme: Light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
