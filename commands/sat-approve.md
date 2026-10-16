---
name: sat-approve
description: Records a human sign-off against the most recent /sat-run result — appends a durable approval record and stamps the SAT Test Certificate with release metadata, findings, and an endorsement. This is the step that turns a test report into an approved-for-deployment record.
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

The certificate's Release Version and Certification Date still show "Pending approval" —
this is where they get filled in, once, for the official certified run (not on every
`/sat-run`). The Report title and Description were already collected by `/sat-run` and are
in `last_run.report_title` / `last_run.description` — don't ask for those again, just read
them for the audit record in step 3.

Ask the user for each of the following (pre-filling what's already known so they only have
to confirm or correct it, not retype it). Only **Release Version** and **Scope** are shown on
the certificate itself; the rest (Service, Ticket, Testers, SRE's, Deployment date) are kept
in `sat-approvals.jsonl` as the durable audit record even though the certificate was
simplified to not display them:

- **Service** — pre-fill from `state.json`'s `artifact_name`.
- **Ticket** — the JIRA/tracking reference for this change. No sensible default; ask.
- **Release version** — ask. (Shown on the certificate.)
- **Scope** — one or two lines on what this run actually covers (which endpoints/scenarios
  were exercised, and anything notable it does *not* cover). Ask. Shown on the certificate as
  a plain line just above the Summary table (see step 4), not a meta-grid card.
- **Testers** — who ran/verified these tests. Ask (comma-separated names if more than one).
- **SRE's** — any Site Reliability Engineers who reviewed this. Ask; allow "none".
- **Deployment date** — the planned or actual deployment date (distinct from today's
  certification date). Ask.

- **Findings** — any bugs identified during this SIT run, beyond what the automated suite
  itself shows as failed. Ask whether there are any; if so, collect each as a pair of
  (Test Case No., description) — the Test Case No. should be one of the `TC-NN` ids visible
  in the certificate's Summary/Evidence sections where applicable, or left blank for a finding
  that isn't tied to a specific test case. If none, that's fine — record nothing and the
  certificate will say so.

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
{"timestamp":"<ISO timestamp>","git_commit":"<sha>","git_dirty":<bool>,"certificate_path":"<path>","test_verdict":"PASS|FAIL","report_title":"<from state.json last_run>","description":"<from state.json last_run>","service":"<service>","ticket":"<ticket>","release_version":"<version>","scope":"<scope>","testers":"<testers>","sres":"<sres>","deployment_date":"<date>","certification_date":"<today>","findings":[{"test_case_no":"<TC-NN or null>","description":"<finding>"}],"approver":"<name>","role":"<role>","decision":"approve|reject","notes":"<notes or null>"}
```
`findings` is `[]` if none were reported.

## 4. Stamp the certificate

Open the certificate at `last_run.certificate_path`.

**Release Version and Certification Date** are the only two meta-item cards left on the
certificate. Match on label *and* value together (so the edit is unambiguous even though
both start with the same placeholder text) and replace just the value:
```html
<div class="meta-item"><div class="label">Release Version</div><div class="value">Pending approval</div></div>
```
becomes:
```html
<div class="meta-item"><div class="label">Release Version</div><div class="value">0.4.0</div></div>
```
Do the same for Certification Date. Nothing else is a meta-item any more — do not look for
Service, Ticket, Testers, SRE's, or Deployment Date cards; they were deliberately removed
from the certificate and only live in `sat-approvals.jsonl` now.

**Scope** is a plain paragraph just above the Summary table:
```html
<p class="scope-line"><strong>Scope:</strong> Pending approval</p>
```
becomes:
```html
<p class="scope-line"><strong>Scope:</strong> Widget API: create (incl. blank/over-length validation), get by id, list, delete (incl. repeat delete and unknown id -> 404). Not covered: update/PATCH, auth, persistence (in-memory store).</p>
```

**Findings** is a table near the bottom with a single placeholder row:
```html
<tr><td colspan="2" class="muted">Pending approval — findings recorded during /sat-approve, if any.</td></tr>
```
If the user reported findings, replace that single row with one `<tr>` per finding:
```html
<tr><td>TC-07</td><td>Returns 500 instead of 400 when the MIN is 9 digits.</td></tr>
```
If they reported none, replace it with a clear "no findings" row instead of leaving the
"Pending approval" wording (which would look unfinished once the certificate is signed):
```html
<tr><td colspan="2" class="muted">No findings identified during this SIT run.</td></tr>
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

Confirm to the user what was recorded (service, ticket, release version, findings count,
approver, role, decision) and where (`sat-approvals.jsonl` and the stamped certificate path).
If this was a rejection, remind them this commit should not be deployed until a fix lands and
`/sat-run` + `/sat-approve` run again clean.
