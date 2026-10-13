---
name: sat-clean
description: Clears generated SAT Test Certificates and Playwright run artifacts (qa-certificates/, test-results/) so the next /sat-run starts from a clean slate. Never touches sat-approvals.jsonl, the committed audit trail -- that's out of scope by design.
disable-model-invocation: true
allowed-tools: Read, Bash(rm *), Bash(git *), Bash(find *)
argument-hint: "[--yes]"
---

Clear previously generated SAT output for this project -- useful when iterating on the plugin
itself across different Spring Boot projects, or just wanting a clean run without old
certificates lying around.

## 1. Preconditions

Read `.claude/sat/state.json`. If it doesn't exist or `scaffolded` isn't `true`, tell the
user there's nothing to clean (this project hasn't been scaffolded) and stop.

## 2. Find what's there

List:
- `playwright-tests/qa-certificates/*.html`
- `playwright-tests/test-results/` (results.json, results.xml, .last-run.json, and the
  per-test output directories Playwright creates)
- the `last_run` block in `.claude/sat/state.json`, if present

If all of these are already empty/absent, say so and stop -- nothing to do.

## 3. Confirm

Show the user a short summary of what was found (certificate count, whether test-results has
content, whether `state.json` has a `last_run`) and ask for confirmation before deleting,
unless `--yes` was passed in `$ARGUMENTS`.

Be explicit in this confirmation that **`sat-approvals.jsonl` is not part of this and will not
be touched** -- it's the committed audit trail of real sign-offs, not generated output, and
this command never deletes or edits it under any flag. If the user actually wants to reset
that too (e.g. a throwaway test project with no real approvals worth keeping), tell them
that's a deliberate git operation, not something this command does: `git log --oneline --
sat-approvals.jsonl` to see what's there, then `git checkout <commit>~1 -- sat-approvals.jsonl`
or hand-edit it, and commit the result themselves. Don't offer to do that for them here.

## 4. Clear

- Remove the contents of `playwright-tests/qa-certificates/` and
  `playwright-tests/test-results/` (the directories themselves can stay).
- Remove the `last_run` key from `.claude/sat/state.json` if present, keeping `scaffolded`,
  `scaffolded_at`, and `artifact_name` as they are. (`state.json` is gitignored local state,
  so this is always safe -- nothing committed depends on it.)

## 5. Report

Confirm what was removed (counts, not a huge file listing), and remind the user:
- `sat-approvals.jsonl` -- untouched.
- Next `/sat-run` will produce a fresh certificate with no prior run to compare against.
