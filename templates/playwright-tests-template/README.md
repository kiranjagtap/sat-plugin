# __PROJECT_NAME__ API test automation (Playwright)

API test automation for __PROJECT_NAME__, scaffolded by the `sat` Claude Code plugin
(`/sat-scaffold`). Uses Playwright's `request` fixture — pure HTTP API testing, no browser
involved — so these tests run against a live instance of the app, not against its source.

## Prerequisites

1. The app's dependencies (database, etc.) are running.
2. The app itself is reachable (default assumed: `http://localhost:8080`). Check its health
   endpoint, or however you normally confirm it's up.

## Install

```bash
npm install
```

## Writing a test

Use the `callAndLog` helper from `utils/logger.ts` for every request — it sends a per-call
correlation id, logs the request/response three ways (console, run log file, HTML report
attachment), and pulls back the application's own correlated log lines (see "Application log
correlation" below). A minimal spec:

```ts
import { test, expect } from '@playwright/test';
import { callAndLog } from '../utils/logger';

test('creates a widget', async ({ request }, testInfo) => {
  const response = await callAndLog(testInfo, 'create-widget', request, 'post', '/api/widgets', {
    data: { name: 'Example' },
  });
  expect(response.status()).toBe(201);
});
```

Put specs under `tests/`.

## Run the tests

```bash
npm test
```

Points at `http://localhost:8080` by default. To target a different instance:
```bash
BASE_URL=http://localhost:9090 npm test
```

## Reports and logs

After a run:
- **HTML report** (interactive, includes a full request/response JSON attachment per test):
  ```bash
  npm run report
  ```
  Opens `playwright-report/index.html` in your browser.
- **JSON results**: `test-results/results.json`
- **JUnit XML** (for CI): `test-results/results.xml`
- **Plain-text request/response log** (one file per run): `logs/api-test-run-<timestamp>.log`

## Application log correlation

Each API call made via `callAndLog` sends a per-request `X-Request-Id` header. The app's
`RequestIdFilter` (added by `/sat-scaffold` to the Spring Boot project this was scaffolded
into) reads that header, puts it in SLF4J's MDC for the duration of the request, and the
console/file logging patterns added to `application.yml`/`application.properties` render it
on every log line, e.g.:

```
03:12:04.118 [http-nio-8080-exec-1] [3f1b9e2a-...] INFO  c.example.app.web.WidgetController - POST /api/widgets
```

After each call, the test harness asks a **log source** for every line tagged with that
request id, and attaches them to the test result alongside the HTTP request/response — so
`generate-qa-certificate.js` can show, per test, exactly what the application logged while
handling that specific call, not just what Playwright saw over HTTP.

There are two log sources, picked via `LOG_SOURCE` (default: `file`):

- **`LOG_SOURCE=file`** — reads the app's own log file on disk. Works when the app and the
  test runner share a filesystem, i.e. a local run on the same machine as the tests
  (configured via `logging.file.name`, default `logs/__ARTIFACT_NAME__.log` at the project
  root). Override the path with `APP_LOG_FILE=/path/to/__ARTIFACT_NAME__.log`.

- **`LOG_SOURCE=splunk`** — queries Splunk's REST Search API for lines matching the request
  id within a padded window around the call's actual start/finish time. Use this once the app
  is deployed somewhere that doesn't share a filesystem with wherever the tests run (a non-prod
  environment, say) and its logs only exist in the log aggregator. This is scaffolded but not
  yet exercised against a real Splunk instance — see `utils/log-sources/splunk-source.ts` for
  the full env var list (`SPLUNK_BASE_URL`, `SPLUNK_INDEX`, and either `SPLUNK_TOKEN` or
  `SPLUNK_USERNAME`/`SPLUNK_PASSWORD`, plus optional `SPLUNK_SOURCETYPE` /
  `SPLUNK_TIME_PADDING_SECONDS` / `SPLUNK_INSECURE_TLS`) before pointing it at a real instance.

Example:
```bash
# local (default)
npm test

# against a deployed non-prod instance, logs via Splunk
LOG_SOURCE=splunk \
SPLUNK_BASE_URL=https://splunk.example.internal:8089 \
SPLUNK_INDEX=nonprod_app_logs \
SPLUNK_TOKEN=*** \
BASE_URL=https://__PROJECT_NAME__-nonprod.example.internal \
npm test
```

If a log source can't fetch anything (file missing, Splunk unreachable or misconfigured),
the call still logs and the test still runs — `appLogs` just comes back empty and a warning
is printed, rather than the test suite failing because of a log-plumbing problem.

## SAT Test Certificate (for deployment approvals)

Generates a self-contained, printable HTML certificate from the latest test run's
`test-results/results.json` — pass/fail verdict, summary stats, per-test results with
correlated application logs, the git commit tested, and a sign-off section for a QA
engineer and release approver.

```bash
npm run qa-certificate          # from the existing test-results/results.json
npm run test:certify            # runs the tests, then generates the certificate in one step
```

Output lands in `qa-certificates/qa-certificate-<timestamp>.html`. The `sat` plugin's
`/sat-run` command does this for you and records the result; `/sat-approve` then records a
durable sign-off against it. See the plugin's own README for the full `/sat-scaffold` →
`/sat-run` → `/sat-approve` workflow.

**Scope note:** the verdict only reflects whatever tests actually ran. As you add more specs
under `tests/`, the certificate automatically covers more ground on every rerun — no changes
needed to the generator itself.

Override the displayed project name/environment if needed:
```bash
PROJECT_NAME="__PROJECT_NAME__ (staging)" ENVIRONMENT="Staging" npm run qa-certificate
```
