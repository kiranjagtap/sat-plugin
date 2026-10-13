---
name: sat-approve
description: Records a human sign-off against the most recent /sat-run result — appends a durable approval record and stamps the SAT Test Certificate with release metadata and an endorsement. This is the step that turns a test report into an approved-for-deployment record.
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

## 2. Collect the release metadata

The certificate was generated with these fields still showing "Pending approval" — this is
where they get filled in, once, for the official certified run (not on every `/sat-run`).
Ask the user for each (pre-filling what's already known so they only have to confirm or
correct it, not retype it):

- **Service** — pre-fill from `state.json`'s `artifact_name`.
- **Ticket** — the JIRA/tracking reference for this change. No sensible default; ask.
- **Release version** — ask.
- **Description** — one line on what this release/change covers. Ask.
- **Scope** — one or two lines on what this run actually covers (which endpoints/scenarios
  were exercised, and anything notable it does *not* cover). Ask; this is the project-specific
  detail that belongs on the certificate, not a generic boilerplate sentence. Unlike the other
  fields, Scope is *not* rendered as a meta-grid card on the certificate -- it's a plain line
  of text just above the Summary table (see step 4).
- **Testers** — who ran/verified these tests. Ask (comma-separated names if more than one).
- **SRE's** — any Site Reliability Engineers who reviewed this. Ask; allow "none".
- **Deployment date** — the planned or actual deployment date (distinct from today's
  certification date). Ask.

Then collect the sign-off itself:
- Approver's name.
- Role: QA Engineer or Release Approver (or something else they specify).
- Decision: approve or reject.
- Optional notes (e.g. why, if rejecting, or any caveat on an approval).

Certification date is today's date — don't ask, just use it.

## 3. Append the durable record

Append one line to `sat-approvals.jsonl` at the project root (create it if it doesn't exist —
this file should be committed to the repo, not gitignored, since it's the audit trail):
```json
{"timestamp":"<ISO timestamp>","git_commit":"<sha>","git_dirty":<bool>,"certificate_path":"<path>","test_verdict":"PASS|FAIL","service":"<service>","ticket":"<ticket>","release_version":"<version>","description":"<description>","scope":"<scope>","testers":"<testers>","sres":"<sres>","deployment_date":"<date>","certification_date":"<today>","approver":"<name>","role":"<role>","decision":"approve|reject","notes":"<notes or null>"}
```

## 4. Stamp the certificate

Open the certificate at `last_run.certificate_path`. Each of the fields below appears once,
as a `meta-item` with a distinct label next to its "Pending approval" value — match on the
label *and* value together (so the edit is unambiguous even though every field starts with
the same placeholder text) and replace just the value:

```html
<div class="meta-item"><div class="label">Ticket</div><div class="value">Pending approval</div></div>
```
becomes, e.g.:
```html
<div class="meta-item"><div class="label">Ticket</div><div class="value">JIRA-1234</div></div>
```

Do this for Service, Ticket, Release Version, Description, Testers, SRE's, Deployment
Date, and Certification Date, using the values collected in step 2.

Scope is different -- it's not a meta-item, it's a plain paragraph just above the Summary
table:
```html
<p class="scope-line"><strong>Scope:</strong> Pending approval</p>
```
becomes:
```html
<p class="scope-line"><strong>Scope:</strong> Widget API: create (incl. blank/over-length validation), get by id, list, delete (incl. repeat delete and unknown id -> 404). Not covered: update/PATCH, auth, persistence (in-memory store).</p>
```

Then find the Endorsement block:
```html
<div class="endorsement-block"><div class="endorsement-text">Pending approval — run /sat-approve to record a sign-off.</div></div>
```
Replace the text with a short, plain statement naming the approver, role, decision, and
date, plus any notes — e.g.:
```html
<div class="endorsement-block"><div class="endorsement-text">Approved for production deployment by Jane Doe (Release Approver) on 2026-10-13. Verified by Testers: Kiran. No caveats noted.</div></div>
```
If rejected, write the rejection plainly instead (who rejected it, when, and why from the
notes), so the certificate itself visibly carries the outcome rather than only the separate
log file.

## 5. Report

Confirm to the user what was recorded (service, ticket, release version, approver, role,
decision) and where (`sat-approvals.jsonl` and the stamped certificate path). If this was a
rejection, remind them this commit should not be deployed until a fix lands and `/sat-run` +
`/sat-approve` run again clean.
