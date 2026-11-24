import {describe, expect, it, vi} from "vitest";
import {renderHook, act, waitFor} from "@testing-library/react";

import {useCopyToClipboard} from "@/lib/useCopyToClipboard";

describe("the clipboard", () => {
    it("copies a value and says it did", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
        const {result} = renderHook(() => useCopyToClipboard());

        await act(async () => {
            await result.current.copy("the value");
        });

        expect(writeText).toHaveBeenCalledWith("the value");
        await waitFor(() => expect(result.current.copied).toBe(true));
        expect(result.current.copyFailed).toBe(false);
    });

    it("says so when the clipboard refuses", async () => {
        const writeText = vi.fn().mockRejectedValue(new Error("denied"));
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
        const {result} = renderHook(() => useCopyToClipboard());

        await act(async () => {
            await result.current.copy("the value");
        });

        await waitFor(() => expect(result.current.copyFailed).toBe(true));
        expect(result.current.copied).toBe(false);
    });

    it("drops a write that resolves after a later one", async () => {
        // Both writes are in flight, and the first one lands while the second
        // is still going: it is stale, and it must not say the copy happened.
        let finishFirst: (() => void) | undefined;
        let finishSecond: (() => void) | undefined;
        const writeText = vi
            .fn()
            .mockImplementationOnce(() => new Promise((resolve) => {
                finishFirst = () => resolve(undefined);
            }))
            .mockImplementationOnce(() => new Promise((resolve) => {
                finishSecond = () => resolve(undefined);
            }));
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
        const {result} = renderHook(() => useCopyToClipboard());

        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = result.current.copy("the first");
            second = result.current.copy("the second");
        });

        await act(async () => {
            finishFirst?.();
            await first;
        });

        expect(result.current.copied).toBe(false);
        expect(result.current.copyFailed).toBe(false);

        // The second write lands, and it is the one on screen.
        await act(async () => {
            finishSecond?.();
            await second;
        });

        await waitFor(() => expect(result.current.copied).toBe(true));
        expect(writeText).toHaveBeenCalledTimes(2);
    });

    it("drops the copy when the caller resets it", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
        const {result} = renderHook(() => useCopyToClipboard());

        await act(async () => {
            await result.current.copy("the value");
        });
        await waitFor(() => expect(result.current.copied).toBe(true));

        // The resource under the button changed, so the copy that was made of
        // the last one is not claimed for this one.
        act(() => {
            result.current.reset();
        });

        expect(result.current.copied).toBe(false);
    });

    it("drops a write that fails after a later one", async () => {
        const writeText = vi
            .fn()
            .mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error("denied")), 50)))
            .mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
        const {result} = renderHook(() => useCopyToClipboard());

        await act(async () => {
            const first = result.current.copy("the first");
            await result.current.copy("the second");
            await first.catch(() => undefined);
        });

        // The copy that came first failed, and it failed late. The copy that
        // came second is the one on screen, so the console must not say that
        // the clipboard was refused over it.
        await waitFor(() => expect(result.current.copied).toBe(true));
        expect(result.current.copyFailed).toBe(false);
    });
});
