# sat

A Claude Code plugin for Spring Boot services: scaffolds correlated-log API test automation,
runs it, and produces a structured **SAT Test Certificate** with a recorded human approval —
the thing you'd point at before a production deployment.

A standalone companion to [saga](https://github.com/thepipeman/saga) — run it any time, on
any Spring Boot project, saga-managed or not. It doesn't touch saga's own workflow state.

## What it does

1. **`/sat-scaffold`** — one-time per project. Adds:
   - `RequestIdFilter` — tags every request with a correlation id (`X-Request-Id`), placed
     in SLF4J's MDC so every log line the app emits while handling that request carries it.
   - A `logging.pattern.*` / `logging.file.name` entry in `application.yml` or
     `application.properties` so those correlated lines also land in a log file on disk.
   - `playwright-tests/` — a Playwright API test harness (TypeScript) with a `callAndLog`
     helper that sends the correlation id, and a pluggable log source (local file, or Splunk
     for a deployed non-prod environment) that reads back the matching application log lines
     per call.
   - `generate-qa-certificate.js` — turns a test run's results into a self-contained,
     printable HTML certificate: pass/fail verdict, per-test results, and — per API call —
     the request/response alongside the application's own correlated log lines.

   Idempotent: re-running it skips anything already present rather than overwriting it.

2. **`/sat-run`** — runs the test suite against a running instance of the app (local or a
   deployed non-prod URL via `--base-url`), generates the certificate, and records the
   verdict + git commit in `.claude/sat/state.json`.

3. **`/sat-approve`** — records a human sign-off against the most recent run: asks for the
   approver's name, role, and decision, appends it to `sat-approvals.jsonl` (a durable,
   committed audit trail), and annotates the certificate's own sign-off section so the
   approval travels with the document, not just a separate log.

## Install

From a Claude Code session, in any project (or globally):
```
/plugin marketplace add /Users/kiranjagtap/work/sat-plugin
/plugin install sat@sat-marketplace
```
Same pattern as installing `saga`.

## A note on scope

This is Spring Boot-specific by design — the filter, the logging config format, and the
"find the `@SpringBootApplication` class" detection logic all assume that stack. It won't do
anything useful on a non-Java service.

There's deliberately **no hard git-push gate** here (unlike saga's own `code_reviewed` gate
on commit/push). `/sat-approve` records the decision, but doesn't block anything on its own —
blanket-blocking every `git push` across every project this plugin is installed in felt like
overreach for something not explicitly asked for, and it would double up awkwardly with
saga's existing gate on the same repos. If you want a hard gate later (e.g. only on pushes to
`main`/`release/*`, or only for a separate `/sat-deploy` command), that's a small, targeted
addition — just ask.

## Splunk log source

Not yet exercised against a real instance — see `templates/playwright-tests-template/utils/log-sources/splunk-source.ts`
for the full env var list. Once you have real Splunk connection details for a non-prod
environment, pass them via `SPLUNK_BASE_URL` / `SPLUNK_INDEX` / `SPLUNK_TOKEN` (or
`SPLUNK_USERNAME`/`SPLUNK_PASSWORD`) and `LOG_SOURCE=splunk` to `/sat-run`.
