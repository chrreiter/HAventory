/**
 * Delay `fn` until `ms` milliseconds have passed since the last call. There is
 * no cancel, so whatever it touches has to tolerate arriving late.
 */
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number
): (...args: TArgs) => void {
  let timeoutId: number | undefined;
  return (...args: TArgs) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), ms);
  };
}
