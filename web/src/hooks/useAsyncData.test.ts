import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsyncData } from "./useAsyncData.js";

afterEach(() => {
  vi.resetAllMocks();
});

/**
 * 制御可能なPromiseを作る。`isLoading`がfetch完了前は`true`であることを確認するテスト（要件16.4）で、
 * fetch関数の解決/拒否のタイミングをテスト側から明示的に制御するために使う。
 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsyncData", () => {
  it("reports isLoading as true while the fetch is in flight (Requirement 16.4)", async () => {
    const deferred = createDeferred<string>();
    const fetchFn = vi.fn(() => deferred.promise);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      deferred.resolve("value");
      await deferred.promise;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("stores the resolved value in data, clears error, and sets isLoading false on success", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ id: 1 });

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ id: 1 });
    expect(result.current.error).toBeNull();
  });

  it("stores the rejection reason in error and sets isLoading false on failure", async () => {
    const failure = new Error("boom");
    const fetchFn = vi.fn().mockRejectedValue(failure);

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it(
    "keeps previously fetched data untouched when a subsequent refetch fails " +
      "(task 1.1 completion condition, Requirement 16.5)",
    async () => {
      const failure = new Error("network down");
      const fetchFn = vi.fn().mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(failure);

      const { result } = renderHook(() => useAsyncData(fetchFn, []));

      await waitFor(() => expect(result.current.data).toEqual({ id: 1 }));
      expect(result.current.error).toBeNull();

      act(() => {
        result.current.refetch();
      });

      // 2回目の取得が失敗した直後もローディング表示になる（要件16.4）。
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toEqual({ id: 1 });

      await waitFor(() => expect(result.current.error).toBe(failure));

      // 取得失敗時にエラー状態のみが更新され、直前に取得済みのデータは破棄されない。
      expect(result.current.data).toEqual({ id: 1 });
      expect(result.current.isLoading).toBe(false);
    },
  );

  it(
    "recovers from a prior failure when a subsequent refetch succeeds " +
      "(inverse of the succeed-then-fail case, Requirements 16.4/16.5)",
    async () => {
      const failure = new Error("network down");
      const recovered = { id: 2 };
      const fetchFn = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(recovered);

      const { result } = renderHook(() => useAsyncData(fetchFn, []));

      await waitFor(() => expect(result.current.error).toBe(failure));
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);

      act(() => {
        result.current.refetch();
      });

      // 再取得直後もローディング表示になる（要件16.4）。
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => expect(result.current.data).toEqual(recovered));

      // 復旧時は新しいデータが保持されるだけでなく、直前のエラー状態も破棄される。
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    },
  );

  it(
    "keeps concurrently-running instances independent: one instance's failure " +
      "does not affect another instance's successful result (Requirements 16.4/16.5)",
    async () => {
      const successValue = { id: 42 };
      const failure = new Error("network down");
      const successFetchFn = vi.fn().mockResolvedValue(successValue);
      const failureFetchFn = vi.fn().mockRejectedValue(failure);

      // 同一のレンダーツリー内で`useAsyncData`を2回呼び出し、互いの状態が独立していることを検証する。
      const { result } = renderHook(() => ({
        success: useAsyncData(successFetchFn, []),
        failure: useAsyncData(failureFetchFn, []),
      }));

      await waitFor(() => {
        expect(result.current.success.isLoading).toBe(false);
        expect(result.current.failure.isLoading).toBe(false);
      });

      // 成功した取得は、もう一方が失敗していてもdataが保持されエラーは発生しない。
      expect(result.current.success.data).toEqual(successValue);
      expect(result.current.success.error).toBeNull();

      // 失敗した取得は、もう一方が成功していてもdataはnullのままエラーを保持する。
      expect(result.current.failure.data).toBeNull();
      expect(result.current.failure.error).toBe(failure);
    },
  );

  it("re-runs the fetch function each time refetch is called", async () => {
    const fetchFn = vi.fn().mockResolvedValue("v1");

    const { result } = renderHook(() => useAsyncData(fetchFn, []));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });

  it("re-runs the fetch function when an entry in deps changes", async () => {
    const fetchFn = vi.fn().mockResolvedValue("v1");

    const { rerender } = renderHook(({ dep }: { dep: number }) => useAsyncData(fetchFn, [dep]), {
      initialProps: { dep: 1 },
    });

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    rerender({ dep: 2 });

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });

  it("does not update state after unmount while a fetch is still in flight", async () => {
    const deferred = createDeferred<string>();
    const fetchFn = vi.fn(() => deferred.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderHook(() => useAsyncData(fetchFn, []));
    unmount();

    await act(async () => {
      deferred.resolve("late value");
      await deferred.promise.catch(() => undefined);
    });

    // アンマウント後のsetState呼び出しはReactの警告としてconsole.errorに出力されるため、
    // 呼ばれていないことでアンマウント後に状態更新が起きていないことを確認する。
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
