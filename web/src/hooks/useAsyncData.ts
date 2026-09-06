import { useCallback, useEffect, useState, type DependencyList } from "react";

/**
 * `useAsyncData`が返す統一的な状態。各セクションコンポーネントが拡張する
 * `DashboardSectionProps<T>`（design.md: Shared Interface）と`data`/`isLoading`/`error`の
 * フィールド名を一致させている。
 */
export interface AsyncDataState<T> {
  /** 直近に成功した取得結果。取得が一度も成功していない場合は`null`。 */
  data: T | null;
  /** 取得処理が実行中かどうか（要件16.4: 処理中は該当セクションに読み込み中であることを示す）。 */
  isLoading: boolean;
  /**
   * 直近の取得で発生したエラー（呼び出し先クライアントが返す上流spec固有のエラー型を
   * そのまま保持する。design.md: Error Envelope）。エラーが発生していない場合は`null`。
   */
  error: unknown;
  /** 取得処理を再実行する。 */
  refetch: () => void;
}

/**
 * 非同期取得関数を受け取り、ローディング状態・データ・エラーを統一的に返す共通フック。
 *
 * `deps`が変化する、または`refetch`が呼ばれるたびに`fetchFn`を再実行する。取得が失敗した場合は
 * `error`のみを更新し、直前に取得済みの`data`は破棄しない（task 1.1の明示的な確認条件、要件16.5）。
 */
export function useAsyncData<T>(fetchFn: () => Promise<T>, deps: DependencyList = []): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);

    fetchFn().then(
      (value) => {
        if (isCancelled) return;
        // 成功時: データを更新しエラーをクリアする。
        setData(value);
        setError(null);
        setIsLoading(false);
      },
      (reason: unknown) => {
        if (isCancelled) return;
        // 失敗時: エラー状態のみを更新し、直前に取得済みのdataはそのまま保持する（要件16.5）。
        setError(reason);
        setIsLoading(false);
      },
    );

    return () => {
      // アンマウントまたは再実行により古い取得が無効化された場合、その結果でstateを更新しない
      // （メモリセーフティ: アンマウント後のsetState呼び出しを防ぐ）。
      isCancelled = true;
    };
    // `deps`は呼び出し元が指定する依存配列であり、要素数は呼び出しごとに固定されている前提。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refetchToken]);

  const refetch = useCallback(() => {
    setRefetchToken((token) => token + 1);
  }, []);

  return { data, isLoading, error, refetch };
}
