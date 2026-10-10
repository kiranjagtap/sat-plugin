import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';
import { getLogSource } from './log-sources';

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// One log file per test run (process start), so repeated runs don't overwrite each other.
const runLogFile = path.join(
  logsDir,
  `api-test-run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
);

// Logback flushes each line as it's written, but leave a small buffer so the log-source read
// below doesn't race the app's own I/O (or, for Splunk, the forwarder's indexing lag).
const LOG_SETTLE_MS = Number(process.env.LOG_SETTLE_MS || 200);

// Resolved once per run: LOG_SOURCE=file (default, reads the app's local log file) or
// LOG_SOURCE=splunk (queries Splunk — see utils/log-sources/splunk-source.ts). Resolving it
// eagerly means a Splunk misconfiguration fails fast with a clear error, rather than quietly
// on the first API call.
const logSource = getLogSource();

type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

/**
 * Makes one API call and logs it four ways:
 *  1. console.log — shows up live in the terminal via the `list` reporter
 *  2. appended to a run-wide .log file under playwright-tests/logs/
 *  3. attached to this specific test's entry in the HTML report / results.json (so
 *     generate-qa-certificate.js can render it per-test)
 *  4. correlated application-side: a per-call `X-Request-Id` is sent to the app, the app tags
 *     every log line it emits while handling that request with the same id (via SLF4J MDC —
 *     see RequestIdFilter.java), and this function reads those matching lines back out via
 *     whichever LogSource is configured (local file for a local bootRun, Splunk for a
 *     deployed non-prod instance) so they travel with the test result, not just Playwright's
 *     HTTP-level view.
 */
export async function callAndLog(
  testInfo: TestInfo,
  label: string,
  request: APIRequestContext,
  method: HttpMethod,
  url: string,
  options?: { data?: unknown; headers?: Record<string, string> },
): Promise<APIResponse> {
  const requestId = randomUUID();
  const headers = { ...(options?.headers ?? {}), 'X-Request-Id': requestId };
  const start = Date.now();

  const response = await request[method](url, { data: options?.data, headers });
  const durationMs = Date.now() - start;
  const finish = Date.now();

  await new Promise((resolve) => setTimeout(resolve, LOG_SETTLE_MS));
  let appLogs: string[] = [];
  try {
    appLogs = await logSource.fetchLogsForRequest(requestId, { startedAt: start, finishedAt: finish });
  } catch (err) {
    console.warn(
      `[callAndLog] log source "${logSource.name}" failed for request ${requestId}: ${(err as Error).message}`,
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text();
  }

  const entry = {
    timestamp: new Date().toISOString(),
    test: testInfo.title,
    label,
    requestId,
    request: { method: method.toUpperCase(), url, headers, body: options?.data ?? null },
    response: {
      status: response.status(),
      statusText: response.statusText(),
      headers: response.headers(),
      body: responseBody,
    },
    durationMs,
    logSource: logSource.name,
    appLogs,
  };

  const pretty = JSON.stringify(entry, null, 2);

  console.log(
    `\n--- [${label}] ${method.toUpperCase()} ${url} -> ${response.status()} (${durationMs}ms) [reqId=${requestId}, logSource=${logSource.name}] ---\n${pretty}`,
  );
  fs.appendFileSync(runLogFile, pretty + '\n---\n');

  await testInfo.attach(`${label} - ${method.toUpperCase()} ${url}`, {
    body: pretty,
    contentType: 'application/json',
  });

  return response;
}
