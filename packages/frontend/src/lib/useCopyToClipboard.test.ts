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
        const writeText = vi
            .fn()
            .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(undefined), 50)))
            .mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
        const {result} = renderHook(() => useCopyToClipboard());

        await act(async () => {
            const first = result.current.copy("the first");
            await result.current.copy("the second");
            await first;
        });

        await waitFor(() => expect(result.current.copied).toBe(true));
        expect(writeText).toHaveBeenCalledTimes(2);
    });
});
