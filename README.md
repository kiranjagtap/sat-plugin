# sat

A Claude Code plugin for Spring Boot services: scaffolds correlated-log API test automation,
runs it, and produces a structured **SAT Test Certificate** with a recorded human approval —
the thing you'd point at before a production deployment.

A standalone companion to [saga](https://github.com/thepipeman/saga) — run it any time, on
any Spring Boot project, saga-managed or not. It doesn't touch saga's own workflow state.

## What it does

1. **`/sat-scaffold`** — one-time per project. Adds, after first checking what's already
   there (see "Adapting to an existing project" below):
   - `RequestIdFilter` — tags every request with a correlation id, placed in SLF4J's MDC so
     every log line the app emits while handling that request carries it. Skipped if the
     project already has an equivalent filter; its header/MDC key are reused instead.
   - A `logging.pattern.*` / `logging.file.name` entry in `application.yml` or
     `application.properties` so those correlated lines also land in a log file on disk —
     only when nothing else already controls logging output (see below).
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

3. **`/sat-approve`** — records a human sign-off against the most recent run: asks for
   release metadata (service, ticket, release version, description, scope, testers, SRE's, deployment
   date) plus the approver's name, role, and decision, appends all of it to
   `sat-approvals.jsonl` (a durable, committed audit trail), and stamps the certificate's own
   header fields and Endorsement section so the full record travels with the document, not
   just a separate log. Until this runs, those header fields show "Pending approval" and the
   certificate has no signature lines to fill in by hand — the endorsement is text recorded
   through this command, not a blank line waiting for a wet signature.

4. **`/sat-clean`** -- clears generated certificates and Playwright run output
   (`playwright-tests/qa-certificates/`, `playwright-tests/test-results/`) so the next
   `/sat-run` starts fresh. Handy when iterating on the plugin itself across several Spring
   Boot projects. Never touches `sat-approvals.jsonl` -- that's the committed audit trail,
   and resetting it is a deliberate git operation you do yourself, not something this command
   will do for you.

## Install

From a Claude Code session, in any project (or globally):
```
/plugin marketplace add /Users/kiranjagtap/work/sat-plugin
/plugin install sat@sat-marketplace
```
Same pattern as installing `saga`.

## Adapting to an existing project

This plugin doesn't assume a project's logging is "greenfield." `/sat-scaffold` checks, in
order:

- **Is there already a correlation-id filter?** If a class already reads a header and puts
  it in SLF4J's MDC, that filter's header name and MDC key are reused end-to-end — no second
  filter is added, and `/sat-run` tells the Playwright harness which header to send via
  `CORRELATION_HEADER` (not necessarily `X-Request-Id`).
- **Is logging controlled by a custom `logback.xml`/`logback-spring.xml`?** If so, Spring
  Boot's `logging.pattern.*` properties are not read at all (a plain `logback.xml` loads
  before Spring's context exists), so this command doesn't touch `application.yml` in that
  case. It checks whether the correlation MDC key already appears in the existing config; if
  not, it shows the smallest possible edit to add — the exact pattern-string splice, or the
  equivalent for a JSON/structured encoder — rather than attempting to rewrite someone's
  logging XML automatically. The project's own log format and Splunk field-extraction rules
  are left completely alone either way.
- **The log line's format never matters to this plugin.** Both the local-file and Splunk log
  sources find lines with a plain substring search on the correlation id — they don't parse
  structure — so plain text, JSON, or anything else all work identically as long as the id
  shows up somewhere in the line.

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
