---
name: sat-scaffold
description: One-time setup for a Spring Boot project — adds request-correlated SLF4J logging and a Playwright API test harness that can produce a SAT Test Certificate. Safe to re-run anytime -- skips what already exists, and auto-refreshes plugin-owned generated files (like generate-qa-certificate.js) to the latest template without touching hand-written test specs.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm *), Bash(git *), Bash(find *), Bash(grep *), Bash(cat *), Bash(mkdir *)
argument-hint: "[--artifact-id <name>]"
---

Set up this Spring Boot project for the `sat` workflow (`/sat-scaffold` → `/sat-run` →
`/sat-approve`): request-correlated SLF4J logging in the app, and a Playwright API test
harness that can turn a test run into a structured SAT Test Certificate. This command is
safe to re-run at any time, including after a plugin update: steps 1-4 skip anything already
present, and step 5 auto-refreshes the Playwright harness's plugin-owned generated files
(e.g. `generate-qa-certificate.js`) to match the plugin's current templates. It never
silently clobbers hand-written test specs, `package.json`, or an existing filter -- see step
5 for exactly what counts as plugin-owned vs. yours.

## 1. Confirm this is a Spring Boot project

Look for `build.gradle`/`build.gradle.kts` (Gradle) or `pom.xml` (Maven) containing a
`spring-boot` plugin/dependency. If this isn't a Spring Boot project, tell the user this
plugin is Spring Boot-specific (per its design) and stop — don't improvise a different
stack's equivalent.

Determine the artifact name (Gradle: `rootProject.name` in `settings.gradle`; Maven:
`<artifactId>` in `pom.xml`). Use `--artifact-id` from `$ARGUMENTS` instead if given. This
becomes `__ARTIFACT_NAME__` below (used for the log file name and default project name).

## 2. Detect any existing request-correlation mechanism

Before adding anything, check whether this project already has a way to correlate a request
across its log lines — reusing it beats adding a second, competing one:

- Search for a class extending `OncePerRequestFilter` (or a `HandlerInterceptor`) that reads
  a request header and calls `MDC.put(...)`. If found, read its header name and MDC key out
  of the source (the header constant/literal, and the string passed to `MDC.put`) and treat
  those as **the header and MDC key in effect** for the rest of this command. Report where
  the filter is and do not add `RequestIdFilter` — skip step 3 entirely.
- Otherwise, if `management.tracing.*` is configured or a `micrometer-tracing` dependency is
  present: note it, but don't try to repurpose it. Micrometer's `traceId` is generated per
  span, not from an incoming header, so it gives the Playwright side no way to tag a specific
  outgoing request with an id to look for afterwards. Treat this project as having nothing
  reusable and continue to step 3.
- Otherwise there's nothing to reuse — continue to step 3, where the header/MDC key in
  effect will be the defaults, `X-Request-Id` / `requestId`.

Whatever header and MDC key end up "in effect" here get recorded in `.claude/sat/state.json`
(step 6) and passed to the Playwright harness by `/sat-run` as `CORRELATION_HEADER` — so the
test side always sends whatever header the app is actually reading, which won't always be
`X-Request-Id`.

## 3. Add the request-correlation filter (skip if step 2 found one)

If step 2 found an existing filter, skip this step and move to step 4.

Otherwise, find the main `@SpringBootApplication` class to get the base package. Decide
where the filter belongs:
- If a package named `<base>.web` or `<base>.config` already exists (look for existing
  `@RestControllerAdvice`, filters, or config classes), use it.
- Otherwise create `<base>.web`.

Read `${CLAUDE_PLUGIN_ROOT}/templates/RequestIdFilter.java.template`, replace
`__TARGET_PACKAGE__` with the chosen package, and write it to that package's directory as
`RequestIdFilter.java`. It defaults to header `X-Request-Id` / MDC key `requestId`, both
later overridable via `sat.correlation.header` / `sat.correlation.mdc-key` properties
without touching the code.

## 4. Detect and adapt the logging configuration

The exact log line *format* doesn't matter to this plugin — both the local-file and Splunk
log sources find lines by a plain substring match on the correlation id, not by parsing
structure. The only thing that matters is that whatever logging config is actually in
control renders `%X{<mdc-key>}` (the key decided in step 2) somewhere in every log line. So
detect what's actually in control before assuming Spring Boot's simplified properties will
do anything — they won't, on a project with its own Logback config file.

**4a. Check for a dedicated Logback config** — `src/main/resources/logback.xml`,
`logback-spring.xml`, or `logback.groovy`.

- **`logback.xml` present**: Logback loads this directly, before Spring's context starts, so
  `logging.pattern.*`/`logging.file.name` in `application.yml`/`.properties` are never
  consulted — appending them would silently do nothing. Go to 4b.
- **`logback-spring.xml` present**: check whether it includes Spring Boot's own defaults
  (`<include resource="org/springframework/boot/logging/logback/defaults.xml"/>`, or any
  `${CONSOLE_LOG_PATTERN}`/`${FILE_LOG_PATTERN}` reference). If so, Spring Boot's properties
  *are* honored here — treat this the same as "no custom config" (go to 4c). If it defines
  its own pattern/encoder independently of those, go to 4b.
- **`logback.groovy` present**: treat like a custom config that doesn't include Spring's
  defaults — go to 4b (Groovy config isn't a format this command edits).
- **None of these exist**: go to 4c — the original behavior.

**4b. A custom Logback config is in control — don't edit it automatically.**

Grep the file for `%X{` to see what MDC keys it already renders anywhere, in any appender's
pattern/encoder:
- If the key from step 2 (or its default, `requestId`) is already there, this project's own
  config already does the job — report that and skip, nothing to change.
- If it isn't, don't try to splice XML automatically — encoder styles vary too much (a plain
  `<pattern>`, `PatternLayoutEncoder`, a JSON/structured encoder like
  `net.logstash.logback.encoder.LogstashEncoder`, async wrapper appenders) to safely guess at
  structure, and a mis-edit to someone's existing, production logging config is a worse
  outcome than asking. Instead, show the smallest change needed and ask the user to apply it:
  - Pattern-based encoder: show their exact existing pattern string with `%X{<mdc-key>:-}`
    spliced in, changing nothing else — so it keeps matching whatever Splunk field extraction
    already depends on this project's current format.
  - JSON/structured encoder: name the MDC-inclusion option it supports instead of a pattern
    edit (most do — e.g. logstash-logback-encoder's `<mdc/>` or `<includeMdcKeyName>` tag).
  Record this as pending manual action in state.json (step 6), and say so clearly in the
  final summary (step 7) — the filter and Playwright harness still work independently of
  this, but no log lines will correlate to a specific test call until it's done.

**4c. No custom Logback config (or one deferring to Spring Boot's defaults) — use
properties.**

The original behavior. Find `src/main/resources/application.yml`/`.yaml` or
`application.properties`. Check whether it already has a `logging.pattern.console`
(properties) or `logging: pattern: console:` (YAML) entry — if so, skip and report that
logging config already exists, don't duplicate it. Otherwise append
`${CLAUDE_PLUGIN_ROOT}/templates/logging-block.yml` (or `.properties`), substituting
`__ARTIFACT_NAME__` with the real artifact name and `__MDC_KEY__` with the key decided in
step 2 (`requestId` unless an existing filter uses something else) — merged under the file's
existing top-level keys, not as a second `logging:` block if one already exists for other
settings.

In every branch above, add `logs/` to the project's `.gitignore` if it isn't already
ignored.

## 5. Scaffold or refresh the Playwright test harness

First, split the template's files into two groups:

- **Plugin-owned** — this command fully owns these and keeps them in sync with the plugin's
  templates on every run: `generate-qa-certificate.js`, `playwright.config.ts`,
  `tsconfig.json`, `.gitignore`, `README.md`, `utils/logger.ts`, and everything under
  `utils/log-sources/`.
- **Never touched by this command, under any circumstance**: everything under `tests/` (the
  user's own hand-written specs -- the template only ships a `.gitkeep` there), and
  `package.json`, `package-lock.json`, `node_modules/` (all three are also managed by `npm
  install`, which the user runs themselves and may have added real dependencies to).

**5a. If `playwright-tests/` doesn't exist yet** (first time in this project): copy
`${CLAUDE_PLUGIN_ROOT}/templates/playwright-tests-template/` to `playwright-tests/` at the
project root in full, preserving its structure. In the copy, replace every occurrence of
`__PROJECT_NAME__` with a human-readable project name (derive one from the artifact name,
e.g. `widget-service` → `widget-service`) and `__ARTIFACT_NAME__` with the real artifact
name, across `package.json`, `generate-qa-certificate.js`, `playwright.config.ts`,
`README.md`, and `utils/log-sources/*.ts`. Then run `npm install` inside `playwright-tests/`.

**5b. If `playwright-tests/` already exists** (re-run, typically after a plugin update):
this is a refresh, not a fresh scaffold -- don't touch `tests/`, `package.json`,
`package-lock.json`, or `node_modules/` at all, and don't run `npm install`. For each
plugin-owned file listed above:
- Read it from `${CLAUDE_PLUGIN_ROOT}/templates/playwright-tests-template/`, substitute
  `__PROJECT_NAME__`/`__ARTIFACT_NAME__` using the artifact name already recorded in
  `.claude/sat/state.json` (no need to re-derive it), and compare the result to what's
  currently on disk at the matching path under `playwright-tests/`.
- Identical → nothing to do; just count it.
- Different, or missing from this project entirely (the template gained a file since this
  project was scaffolded) → write it, overwriting if present, and count it as refreshed.

Then, separately, compare only the template `package.json`'s `scripts` section (not the rest
of the file) to the project's `playwright-tests/package.json`. If a script the plugin
depends on (`test`, `test:certify`, or any other the template defines) is missing or
differs, don't touch `package.json` -- instead show the user the exact script line(s) that
differ and ask them to apply it by hand, the same way step 4b hands back a logging-config
snippet instead of editing someone's file for them. If the scripts already match, say
nothing further about it.

Report counts, not a huge file-by-file listing: e.g. "Refreshed 1 file
(generate-qa-certificate.js), 7 already up to date."

## 6. Record state

**First-time scaffold** — create `.claude/sat/state.json` at the project root:
```json
{
  "scaffolded": true,
  "scaffolded_at": "<ISO timestamp>",
  "artifact_name": "<artifact name>",
  "correlation": {
    "header": "<header name in effect, e.g. X-Request-Id>",
    "mdc_key": "<MDC key in effect, e.g. requestId>",
    "source": "sat-filter" | "existing-filter",
    "logging_config": "application-properties" | "logback-custom-ok" | "logback-custom-manual-action-pending"
  },
  "last_run": null
}
```

**Refresh run** (5b) — leave `scaffolded`, `scaffolded_at`, `artifact_name`, `correlation`,
and `last_run` exactly as they are; just add/update a `last_refreshed_at` field with the
current ISO timestamp, so it's visible when the plugin-owned files were last synced.

## 7. Summarize

Tell the user plainly what was created vs. skipped vs. reused vs. refreshed at each step. If
step 4 landed in the manual-action branch (4b), call that out clearly and separately from
the rest — the filter and Playwright harness are in place and `/sat-run` will work, but app
log lines won't correlate to specific test calls until the user adds the shown snippet to
their own Logback config. Otherwise, confirm `/sat-run` is the next command — it needs the
app actually running (reachable over HTTP) to do anything useful.

On a refresh run (5b) where nothing else changed, keep this short: a one-line file-count
summary plus, if relevant, the `package.json` scripts note -- don't re-walk steps 1-4 in
detail when they all just confirmed "already present, skipped."
