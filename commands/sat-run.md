---
name: sat-run
description: Runs the Playwright API test suite against a running instance of the app and generates a SAT Test Certificate from the results. Requires /sat-scaffold to have been run first.
disable-model-invocation: true
allowed-tools: Read, Write, Bash(npm *), Bash(curl *), Bash(git *)
argument-hint: "[--base-url <url>] [--env <label>] [--log-source file|splunk]"
---

Run the API test suite and produce a SAT Test Certificate for the current state of the app.

## 1. Preconditions

Read `.claude/sat/state.json`. If it doesn't exist or `scaffolded` isn't `true`, tell the
user to run `/sat-scaffold` first and stop.

## 2. Resolve run parameters

From `$ARGUMENTS` (or sensible defaults if not given):
- `BASE_URL` — default `http://localhost:8080`.
- `ENVIRONMENT` — a human label for the certificate; default `"Local (developer machine)"`.
- `LOG_SOURCE` — default `file`. If `splunk`, remind the user this needs `SPLUNK_BASE_URL`,
  `SPLUNK_INDEX`, and `SPLUNK_TOKEN` (or `SPLUNK_USERNAME`/`SPLUNK_PASSWORD`) set in the
  environment already — don't try to collect secrets through the conversation and write them
  anywhere.

## 3. Preflight check

Try `curl -sS -o /dev/null -w '%{http_code}' <BASE_URL>/actuator/health` (or ask the user for
the right health path if the project doesn't expose actuator). If it's not reachable, tell
the user clearly — "the app isn't reachable at <BASE_URL>, start it first" — and stop, rather
than letting Playwright fail with a confusing connection-refused wall of text.

## 4. Run

In `playwright-tests/`, run:
```bash
BASE_URL=<BASE_URL> ENVIRONMENT="<ENVIRONMENT>" LOG_SOURCE=<LOG_SOURCE> npm run test:certify
```
Let it run to completion even if some tests fail — a FAIL verdict is a valid, useful result
here, not an error to recover from.

## 5. Record the result

Find the certificate just written (newest file in `playwright-tests/qa-certificates/`).
Read `playwright-tests/test-results/results.json` for the verdict (no `unexpected`/`flaky`,
and at least one test ran → PASS, otherwise FAIL).

Get the current commit: `git rev-parse --short HEAD` (note if the working tree is dirty via
`git status --porcelain` — a dirty tree means this result may not reflect exactly what's
committed, which matters for anyone relying on it later).

Update `.claude/sat/state.json`'s `last_run`:
```json
{
  "timestamp": "<ISO timestamp>",
  "verdict": "PASS" | "FAIL",
  "certificate_path": "playwright-tests/qa-certificates/qa-certificate-<...>.html",
  "git_commit": "<short sha>",
  "git_dirty": true | false,
  "environment": "<ENVIRONMENT>",
  "log_source": "<LOG_SOURCE>"
}
```

## 6. Report

Tell the user the verdict, the certificate's path, and:
- If PASS and the tree is clean: "`/sat-approve` can record a sign-off against this run."
- If PASS but the tree is dirty: say so plainly — this run doesn't correspond to a committed
  state, so an approval against it wouldn't mean much for traceability.
- If FAIL: "do not proceed to approval — fix the failures and rerun."
