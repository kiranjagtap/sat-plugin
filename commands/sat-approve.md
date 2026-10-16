---
name: sat-approve
description: Finalizes the most recent /sat-run result -- appends a durable record and stamps the SAT/SIT certificate's remaining release metadata and findings table. There is no human sign-off/decision step any more; this just completes the report.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash(git *)
argument-hint: ""
---

Finalize the most recent `/sat-run` result. This is an interactive command — ask the user
for what's needed rather than guessing it.

Note for context: this command used to also record a human QA/Release sign-off (approver
name, role, approve/reject decision, notes) and an Endorsement section on the certificate.
That's been removed entirely -- the certificate is a test report, not an approval record, so
don't ask for any of that, and there's no Endorsement block left to stamp.

## 1. Load the last run

Read `.claude/sat/state.json`. If there's no `last_run`, tell the user to run `/sat-run`
first and stop.

Compare `last_run.git_commit` to the current `git rev-parse --short HEAD`. If they differ, warn
the user plainly that the certificate was generated against a different commit than what's
checked out now, and ask whether they still want to finalize against that older result or
would rather rerun `/sat-run` first. Don't proceed silently either way.

If `last_run.verdict` is `"FAIL"`, tell the user plainly that the last run failed and ask
them to confirm whether they still want to finalize this report as-is (e.g. to hand off a
report that documents known failures) or would rather fix the issue and rerun `/sat-run`
first. Don't finalize a failing run silently.

## 2. Collect the remaining metadata

Report title and Description were already collected by `/sat-run` and are in
`last_run.report_title` / `last_run.description` -- don't ask again, just read them for the
audit record in step 3.

Ask the user for each of the following (pre-filling what's already known so they only have
to confirm or correct it, not retype it):

- **Service** — pre-fill from `state.json`'s `artifact_name`.
- **Ticket** — the JIRA/tracking reference for this change. No sensible default; ask.
- **Release version** — ask. (Shown on the certificate.)
- **Scope** — one or two lines on what this run actually covers (which endpoints/scenarios
  were exercised, and anything notable it does *not* cover). Ask. Shown on the certificate as
  a plain line just above the Summary table (see step 4).
- **Deployment date** — the planned or actual deployment date (distinct from today's
  certification date). Ask.
- **Findings** — any bugs identified during this SIT run, beyond what the automated suite
  itself shows as failed. Ask whether there are any; if so, collect each as a pair of
  (Test Case No., description) — the Test Case No. should be one of the `TC-NN` ids visible
  in the certificate's Summary/Evidence sections where applicable, or left blank for a finding
  that isn't tied to a specific test case. If none, that's fine — record nothing and the
  certificate will say so.

Certification date is today's date — don't ask, just use it.

## 3. Append the durable record

Append one line to `sat-approvals.jsonl` at the project root (create it if it doesn't exist —
this file should be committed to the repo, not gitignored, since it's the audit trail):
```json
{"timestamp":"<ISO timestamp>","git_commit":"<sha>","git_dirty":<bool>,"certificate_path":"<path>","test_verdict":"PASS|FAIL","report_title":"<from state.json last_run>","description":"<from state.json last_run>","service":"<service>","ticket":"<ticket>","release_version":"<version>","scope":"<scope>","deployment_date":"<date>","certification_date":"<today>","findings":[{"test_case_no":"<TC-NN or null>","description":"<finding>"}]}
```
`findings` is `[]` if none were reported. (The file keeps its old name for continuity, even
though it's now a finalization record rather than an approval log.)

## 4. Stamp the certificate

Open the certificate at `last_run.certificate_path`.

**Release Version and Certification Date** are the only two meta-item cards on the
certificate. Match on label *and* value together (so the edit is unambiguous even though
both start with the same placeholder text) and replace just the value:
```html
<div class="meta-item"><div class="label">Release Version</div><div class="value">Pending approval</div></div>
```
becomes:
```html
<div class="meta-item"><div class="label">Release Version</div><div class="value">0.4.0</div></div>
```
Do the same for Certification Date. Nothing else is a meta-item -- do not look for Service,
Ticket, Deployment Date, Testers, or SRE's cards; they aren't on the certificate.

**Scope** is a plain paragraph just above the Summary table:
```html
<p class="scope-line"><strong>Scope:</strong> Pending approval</p>
```
becomes:
```html
<p class="scope-line"><strong>Scope:</strong> Widget API: create (incl. blank/over-length validation), get by id, list, delete (incl. repeat delete and unknown id -> 404). Not covered: update/PATCH, auth, persistence (in-memory store).</p>
```

**Findings** is a table near the bottom with three columns -- No. (a plain running count,
1, 2, 3, ... across the findings rows -- not a test id), Test Case (the `TC-NN` id, or blank
if the finding isn't tied to one), and Findings (the description) -- with a single placeholder
row spanning all three:
```html
<tr><td colspan="3" class="muted">Pending approval — findings recorded during /sat-approve, if any.</td></tr>
```
If the user reported findings, replace that single row with one `<tr>` per finding, numbering
the first column sequentially starting at 1:
```html
<tr><td>1</td><td>TC-07</td><td>Returns 500 instead of 400 when the MIN is 9 digits.</td></tr>
```
If they reported none, replace it with a clear "no findings" row instead of leaving the
"Pending approval" wording:
```html
<tr><td colspan="3" class="muted">No findings identified during this SIT run.</td></tr>
```

There is no Endorsement block any more -- the certificate ends after the Findings table.
Don't look for one.

## 5. Report

Confirm to the user what was recorded (service, ticket, release version, deployment date,
findings count) and where (`sat-approvals.jsonl` and the stamped certificate path).
