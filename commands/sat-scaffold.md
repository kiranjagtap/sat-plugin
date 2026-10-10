---
name: sat-scaffold
description: One-time setup for a Spring Boot project — adds request-correlated SLF4J logging and a Playwright API test harness that can produce a SAT Test Certificate. Run once per project; safe to re-run (skips what already exists).
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm *), Bash(git *), Bash(find *), Bash(grep *), Bash(cat *), Bash(mkdir *)
argument-hint: "[--artifact-id <name>]"
---

Set up this Spring Boot project for the `sat` workflow (`/sat-scaffold` → `/sat-run` →
`/sat-approve`): request-correlated SLF4J logging in the app, and a Playwright API test
harness that can turn a test run into a structured SAT Test Certificate. This command is
idempotent — re-running it should skip anything already present and report what it skipped,
never silently clobber hand-written test specs or an existing filter.

## 1. Confirm this is a Spring Boot project

Look for `build.gradle`/`build.gradle.kts` (Gradle) or `pom.xml` (Maven) containing a
`spring-boot` plugin/dependency. If this isn't a Spring Boot project, tell the user this
plugin is Spring Boot-specific (per its design) and stop — don't improvise a different
stack's equivalent.

Determine the artifact name (Gradle: `rootProject.name` in `settings.gradle`; Maven:
`<artifactId>` in `pom.xml`). Use `--artifact-id` from `$ARGUMENTS` instead if given. This
becomes `__ARTIFACT_NAME__` below (used for the log file name and default project name).

## 2. Add the request-correlation filter

Find the main `@SpringBootApplication` class to get the base package. Decide where the
filter belongs:
- If a package named `<base>.web` or `<base>.config` already exists (look for existing
  `@RestControllerAdvice`, filters, or config classes), use it.
- Otherwise create `<base>.web`.

Skip this step entirely if a class extending `OncePerRequestFilter` that already reads/sets
an `X-Request-Id`-style header exists anywhere in the project — report where it is and move
on, rather than adding a second one.

Otherwise, read `${CLAUDE_PLUGIN_ROOT}/templates/RequestIdFilter.java.template`, replace
`__TARGET_PACKAGE__` with the chosen package, and write it to that package's directory as
`RequestIdFilter.java`.

## 3. Add correlation logging config

Find the app's config file: `src/main/resources/application.yml` (or `.yaml`), or
`application.properties`.

Check whether it already has a `logging.pattern.console` (properties) or `logging: pattern:
console:` (YAML) entry. If so, skip this step and report that logging config already exists
— don't duplicate or overwrite it.

Otherwise:
- YAML: append the contents of `${CLAUDE_PLUGIN_ROOT}/templates/logging-block.yml`, with
  `__ARTIFACT_NAME__` replaced by the real artifact name, merged under the file's existing
  top-level keys (don't create a second `logging:` key if one exists for other settings —
  merge into it).
- Properties: append the contents of `${CLAUDE_PLUGIN_ROOT}/templates/logging-block.properties`
  with the same substitution.

Add `logs/` to the project's `.gitignore` if it isn't already ignored.

## 4. Scaffold the Playwright test harness

If a `playwright-tests/` directory already exists at the project root, stop here — report
what's already there and don't touch it. (If the user wants it refreshed, that's a manual,
explicit decision, not something this command does automatically.)

Otherwise, copy `${CLAUDE_PLUGIN_ROOT}/templates/playwright-tests-template/` to
`playwright-tests/` at the project root, preserving its structure. In the copy, replace every
occurrence of `__PROJECT_NAME__` with a human-readable project name (derive one from the
artifact name, e.g. `widget-service` → `widget-service`) and `__ARTIFACT_NAME__` with the
real artifact name, across `package.json`, `generate-qa-certificate.js`, `playwright.config.ts`,
`README.md`, and `utils/log-sources/*.ts`.

Then run `npm install` inside `playwright-tests/`.

## 5. Record state

Create or update `.claude/sat/state.json` at the project root:
```json
{
  "scaffolded": true,
  "scaffolded_at": "<ISO timestamp>",
  "artifact_name": "<artifact name>",
  "last_run": null
}
```

## 6. Summarize

Tell the user plainly what was created vs. skipped at each step, and that `/sat-run` is the
next command — it needs the app actually running (reachable over HTTP) to do anything useful.
