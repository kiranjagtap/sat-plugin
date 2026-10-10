---
name: sat-approve
description: Records a human sign-off against the most recent /sat-run result — appends a durable approval record and annotates the SAT Test Certificate itself. This is the step that turns a test report into an approved-for-deployment record.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash(git *)
argument-hint: "[--role qa|release] [--reject]"
---

Record a sign-off against the most recent `/sat-run` result. This is an interactive command —
ask the user for what's needed rather than guessing it.

## 1. Load the last run

Read `.claude/sat/state.json`. If there's no `last_run`, tell the user to run `/sat-run`
first and stop.

Compare `last_run.git_commit` to the current `git rev-parse --short HEAD`. If they differ, warn
the user plainly that the certificate was generated against a different commit than what's
checked out now, and ask whether they still want to approve against that older result or
would rather rerun `/sat-run` first. Don't proceed silently either way.

If `last_run.verdict` is `"FAIL"` and `--reject` wasn't passed, tell the user the last run
failed and ask them to either rerun `/sat-run` after fixing it, or explicitly confirm they
want to record a rejection (not an approval) for this result — never let a FAIL turn into a
recorded approval without the user clearly choosing that.

## 2. Collect the sign-off

Ask the user (don't assume):
- Approver's name.
- Role: QA Engineer or Release Approver (or something else they specify).
- Decision: approve or reject.
- Optional notes (e.g. why, if rejecting, or any caveat on an approval).

## 3. Append the durable record

Append one line to `sat-approvals.jsonl` at the project root (create it if it doesn't exist —
this file should be committed to the repo, not gitignored, since it's the audit trail):
```json
{"timestamp":"<ISO timestamp>","git_commit":"<sha>","git_dirty":<bool>,"certificate_path":"<path>","test_verdict":"PASS|FAIL","approver":"<name>","role":"<role>","decision":"approve|reject","notes":"<notes or null>"}
```

## 4. Annotate the certificate

Open the certificate at `last_run.certificate_path`. Find the sign-off block — it has two
lines like:
```html
<div class="block">QA Engineer &nbsp;&nbsp;&nbsp;&nbsp; Signature / Date</div>
<div class="block">Release Approver &nbsp;&nbsp;&nbsp;&nbsp; Signature / Date</div>
```
Replace the "Signature / Date" placeholder in the line matching the approver's role with
their actual name and the timestamp, e.g.:
```html
<div class="block">QA Engineer &nbsp;&nbsp;&nbsp;&nbsp; Jane Doe — 2026-10-10T09:15:00Z (approved)</div>
```
If rejected, write `(rejected)` instead, so the certificate itself visibly carries the
outcome rather than only the separate log file.

## 5. Report

Confirm to the user what was recorded (approver, role, decision) and where
(`sat-approvals.jsonl` and the annotated certificate path). If this was a rejection, remind
them this commit should not be deployed until a fix lands and `/sat-run` + `/sat-approve` run
again clean.
