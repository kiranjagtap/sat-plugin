/** A time window (ms since epoch) to search for log lines in — roughly the request's lifetime. */
export interface LogTimeWindow {
  startedAt: number;
  finishedAt: number;
}

/**
 * Something that can answer "what did the application log while handling this request?".
 * Two implementations exist: a local-file reader (for `./gradlew bootRun` on the same
 * machine as the tests) and a Splunk-backed one (for a real non-prod deployment, where the
 * app and the test runner are on different machines and the only shared place the logs live
 * is the log aggregator). See log-sources/index.ts for how one is selected.
 */
export interface LogSource {
  /** Short label stored alongside captured logs, so the certificate can show where they came from. */
  readonly name: string;

  /**
   * Returns every log line correlated to `requestId`, in order. Should resolve to `[]` (not
   * throw) when nothing is found — callers treat an exception as "the source itself is
   * unavailable/misconfigured" and a warning, not as "this call produced no logs".
   */
  fetchLogsForRequest(requestId: string, window: LogTimeWindow): Promise<string[]>;
}
