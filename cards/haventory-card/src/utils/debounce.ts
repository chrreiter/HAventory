/**
 * Creates a debounced version of a function that delays invocation
 * until `ms` milliseconds have elapsed since the last call.
 *
 * There is no cancel: a pending call still fires even if the caller has since
 * disconnected, so whatever it touches has to tolerate arriving late.
 */
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number
): (...args: TArgs) => void {
  let timeoutId: number | undefined;
  return (...args: TArgs) => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => fn(...args), ms);
  };
}
