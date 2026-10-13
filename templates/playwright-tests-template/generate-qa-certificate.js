#!/usr/bin/env node
/**
 * Generates a QA Test Certificate (self-contained HTML, printable) from a Playwright
 * `json` reporter output file (test-results/results.json by default).
 *
 * Reusable: rerun this after every test run (not just POST /api/tasks — any suite you
 * add later) to produce a fresh, dated certificate reflecting that run's actual results.
 *
 * Besides Playwright's own request/response data, each test's attachments may carry an
 * `appLogs` array — the application's own SLF4J log lines for that exact call, correlated via
 * a per-request `X-Request-Id` (see utils/logger.ts + RequestIdFilter.java). When present,
 * those lines are rendered in an "Evidence" section per test, alongside the request/response,
 * similar in spirit to a manual SIT report's per-scenario log excerpts.
 *
 * A test can optionally carry a remark that shows up in the Summary table's Result column,
 * e.g. `testInfo.annotations.push({ type: 'note', description: 'not a real-world path' })`.
 * Any test with one or more annotations is flagged with a warning icon instead of a plain
 * checkmark, and the annotation text(s) are appended in parentheses.
 *
 * Usage:
 *   node generate-qa-certificate.js [path-to-results.json]
 *
 * Env overrides:
 *   PROJECT_NAME   - shown as the certified application/service name
 *   TEST_SCOPE     - one-line description of what this run covered
 *   ENVIRONMENT    - where the tests ran (default: "Local (developer machine)")
 */

const fs = require('fs');
const path = require('path');

const resultsPath = process.argv[2] || path.join(__dirname, 'test-results', 'results.json');
const PROJECT_NAME = process.env.PROJECT_NAME || '__PROJECT_NAME__ — API Test Certificate';
const SERVICE_NAME = PROJECT_NAME.replace(/ — API Test Certificate$/, '');
const ENVIRONMENT = process.env.ENVIRONMENT || 'Local (developer machine)';
const PENDING = 'Pending approval';

if (!fs.existsSync(resultsPath)) {
  console.error(`Results file not found: ${resultsPath}`);
  console.error('Run the tests first (npm test), which writes test-results/results.json.');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

// --- Flatten the suite tree into a simple list of test results ---
function collectTests(suite, suitePath, out) {
  const title = suite.title || '';
  const nextPath = suitePath ? `${suitePath} › ${title}` : title;

  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const lastResult = (test.results || [])[test.results.length - 1] || {};
      const apiCalls = (lastResult.attachments || [])
        .filter((a) => a.contentType === 'application/json' && a.body)
        .map((a) => {
          try {
            return { name: a.name, data: JSON.parse(Buffer.from(a.body, 'base64').toString('utf-8')) };
          } catch {
            return { name: a.name, data: null };
          }
        });

      out.push({
        suite: nextPath,
        title: spec.title,
        status: test.status, // 'expected' | 'unexpected' | 'flaky' | 'skipped'
        durationMs: lastResult.duration ?? 0,
        retries: (test.results || []).length - 1,
        error: lastResult.error ? lastResult.error.message : null,
        annotations: Array.isArray(test.annotations) ? test.annotations : [],
        apiCalls,
      });
    }
  }
  for (const sub of suite.suites || []) {
    collectTests(sub, nextPath, out);
  }
}

const tests = [];
for (const s of raw.suites || []) {
  collectTests(s, '', tests);
}

const stats = raw.stats || {};
const total = (stats.expected || 0) + (stats.unexpected || 0) + (stats.skipped || 0) + (stats.flaky || 0);
const passed = stats.expected || 0;
const failed = stats.unexpected || 0;
const skipped = stats.skipped || 0;
const flaky = stats.flaky || 0;
const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
const durationSec = stats.duration ? (stats.duration / 1000).toFixed(2) : '0.00';

const verdictPass = failed === 0 && flaky === 0 && total > 0;
const verdict = verdictPass ? 'PASS' : 'FAIL';

const totalAppLogLines = tests.reduce(
  (sum, t) => sum + t.apiCalls.reduce((s, c) => s + (c.data?.appLogs?.length || 0), 0),
  0,
);

const generatedAt = new Date().toISOString();

// --- Render ---
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Summary table: one row per test, a short scenario ID, and a plain result ---
const summaryRows = tests
  .map((t, i) => {
    const id = `T${String(i + 1).padStart(2, '0')}`;
    const remarks = t.annotations.map((a) => a.description).filter(Boolean);
    const remarkText = remarks.length ? ` (${remarks.join('; ')})` : '';

    let icon = '✔';
    let label = 'Success';
    let resultClass = 'ok';
    if (t.status === 'unexpected') {
      icon = '✘';
      label = 'Failed';
      resultClass = 'bad';
    } else if (t.status === 'skipped') {
      icon = '○';
      label = 'Skipped';
      resultClass = 'muted';
    } else if (remarks.length) {
      icon = '⚠';
      resultClass = 'warn';
    }
    const errorText = t.error ? ` — ${t.error}` : '';

    return `
      <tr>
        <td>${id}</td>
        <td>${escapeHtml(t.title)}</td>
        <td class="${resultClass}">${icon} ${escapeHtml(label + remarkText + errorText)}</td>
      </tr>`;
  })
  .join('\n');

// --- Evidence section: one block per test, each call's request/response + correlated app logs ---
function renderCall(c, idx) {
  const d = c.data || {};
  const req = d.request || {};
  const res = d.response || {};
  const reqIdLine = d.requestId ? `<div class="kv"><span>Request ID</span><code>${escapeHtml(d.requestId)}</code>${d.logSource ? ` &nbsp;<span>Log source</span><code>${escapeHtml(d.logSource)}</code>` : ''}</div>` : '';
  const appLogs = Array.isArray(d.appLogs) ? d.appLogs.filter((l) => l && l.trim()) : [];
  const appLogsBlock = appLogs.length
    ? `<div class="loglabel">Application logs (correlated by request id${d.logSource ? `, via ${escapeHtml(d.logSource)}` : ''})</div><pre class="applog">${escapeHtml(appLogs.join('\n'))}</pre>`
    : `<div class="loglabel muted">No correlated application log lines were captured for this call${d.logSource ? ` (source: ${escapeHtml(d.logSource)})` : ''}.</div>`;

  const statusOk = typeof res.status === 'number' && res.status < 400;
  const plainEnglish = `Sent a ${escapeHtml((req.method || '').toUpperCase())} request to ${escapeHtml(req.url || '')}${req.body ? ' with the request body shown below' : ''}, and received ${statusOk ? 'a successful' : 'an error'} response: ${escapeHtml(res.status ?? '')} ${escapeHtml(res.statusText || '')}.`.trim();

  return `
    <div class="call">
      <div class="call-head">Call ${idx + 1}: <code>${escapeHtml(req.method || '')} ${escapeHtml(req.url || '')}</code> &rarr; <strong>${escapeHtml(res.status ?? '')}</strong> (${d.durationMs ?? '—'} ms)</div>
      <div class="plain-english">${plainEnglish}</div>
      ${reqIdLine}
      <div class="grid2">
        <div>
          <div class="loglabel">Request</div>
          <pre>${escapeHtml(JSON.stringify({ headers: req.headers, body: req.body }, null, 2))}</pre>
        </div>
        <div>
          <div class="loglabel">Response</div>
          <pre>${escapeHtml(JSON.stringify({ status: res.status, statusText: res.statusText, body: res.body }, null, 2))}</pre>
        </div>
      </div>
      ${appLogsBlock}
    </div>`;
}

const evidenceSections = tests
  .map((t, i) => {
    const statusLabel = { expected: 'PASSED', unexpected: 'FAILED', flaky: 'FLAKY', skipped: 'SKIPPED' }[t.status] || t.status;
    const statusClass = { expected: 'ok', unexpected: 'bad', flaky: 'warn', skipped: 'muted' }[t.status] || '';
    const calls = t.apiCalls.map((c, idx) => renderCall(c, idx)).join('\n');
    return `
    <div class="evidence-block">
      <h3>${i + 1}. ${escapeHtml(t.title)} <span class="${statusClass}">[${statusLabel}]</span></h3>
      <div class="evidence-suite">${escapeHtml(t.suite)}</div>
      ${t.error ? `<div class="bad err-block">${escapeHtml(t.error)}</div>` : ''}
      ${calls || '<div class="muted">No API calls recorded for this test.</div>'}
    </div>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>QA Test Certificate — ${escapeHtml(PROJECT_NAME)}</title>
<style>
  :root {
    --ok: #1a7f37; --bad: #cf222e; --warn: #9a6700; --muted: #6e7781;
    --border: #d0d7de; --bg-soft: #f6f8fa; --navy: #1e3a5f;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2328; margin: 0; padding: 40px; background: #fff; max-width: 960px; margin-inline: auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .meta-item { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .meta-item .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .meta-item .value { font-size: 14px; font-weight: 600; margin-top: 2px; word-break: break-word; }
  .stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 24px; }
  .stat { text-align: center; border: 1px solid var(--border); border-radius: 6px; padding: 12px 6px; }
  .stat .n { font-size: 22px; font-weight: 700; }
  .stat .l { font-size: 11px; color: var(--muted); text-transform: uppercase; }
  .stat.ok .n { color: var(--ok); } .stat.bad .n { color: var(--bad); }
  .stat.warn .n { color: var(--warn); } .stat.muted .n { color: var(--muted); }
  h2 { font-size: 15px; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-top: 32px; }
  h3 { font-size: 13.5px; margin: 0 0 4px; }
  .scope-line { font-size: 13.5px; margin: 4px 0 4px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { background: var(--bg-soft); font-size: 11px; text-transform: uppercase; color: var(--muted); }
  table.summary-table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  table.summary-table thead th { background: var(--navy); color: #fff; font-size: 12px; text-transform: none; padding: 10px 14px; }
  table.summary-table td { padding: 10px 14px; font-size: 13px; }
  table.summary-table tbody tr:nth-child(even) { background: var(--bg-soft); }
  table.summary-table td:first-child { font-weight: 600; white-space: nowrap; }
  .ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
  .warn { color: var(--warn); font-weight: 600; } .muted { color: var(--muted); }
  .note { font-size: 12px; color: var(--muted); margin: 8px 0 12px; }
  .endorsement-block { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-top: 8px; background: var(--bg-soft); }
  .endorsement-text { font-size: 13px; white-space: pre-wrap; }

  .evidence-block { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-top: 14px; }
  .evidence-suite { font-size: 11px; color: var(--muted); margin-bottom: 8px; }
  .err-block { font-size: 12px; margin-bottom: 8px; white-space: pre-wrap; }
  .call { border-top: 1px dashed var(--border); padding-top: 10px; margin-top: 10px; }
  .call:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
  .call-head { font-size: 12.5px; margin-bottom: 4px; }
  .plain-english { font-size: 12px; margin-bottom: 6px; }
  .kv { font-size: 11.5px; color: var(--muted); margin-bottom: 6px; }
  .kv span { text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; margin-right: 6px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .loglabel { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 6px 0 4px; }
  pre { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-word; margin: 0; }
  pre.applog { background: #0d1117; color: #c9d1d9; border-color: #30363d; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  @media print { body { padding: 10px; } .evidence-block { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>QA Test Certificate</h1>
  <div class="subtitle">${escapeHtml(PROJECT_NAME)} &middot; generated ${generatedAt}</div>

  <div class="meta-grid">
    <div class="meta-item"><div class="label">Service</div><div class="value">${escapeHtml(SERVICE_NAME)}</div></div>
    <div class="meta-item"><div class="label">Environment</div><div class="value">${escapeHtml(ENVIRONMENT)}</div></div>
    <div class="meta-item"><div class="label">Ticket</div><div class="value">${PENDING}</div></div>
    <div class="meta-item"><div class="label">Release Version</div><div class="value">${PENDING}</div></div>
    <div class="meta-item"><div class="label">Description</div><div class="value">${PENDING}</div></div>
    <div class="meta-item"><div class="label">Testers</div><div class="value">${PENDING}</div></div>
    <div class="meta-item"><div class="label">SRE's</div><div class="value">${PENDING}</div></div>
    <div class="meta-item"><div class="label">Deployment Date</div><div class="value">${PENDING}</div></div>
    <div class="meta-item"><div class="label">Certification Date</div><div class="value">${PENDING}</div></div>
  </div>

  <h2>Run details</h2>
  <div class="meta-grid">
    <div class="meta-item"><div class="label">Run started</div><div class="value">${escapeHtml(stats.startTime || '—')}</div></div>
    <div class="meta-item"><div class="label">Duration</div><div class="value">${durationSec}s</div></div>
  </div>

  <div class="stats-grid">
    <div class="stat"><div class="n">${total}</div><div class="l">Total</div></div>
    <div class="stat ok"><div class="n">${passed}</div><div class="l">Passed</div></div>
    <div class="stat bad"><div class="n">${failed}</div><div class="l">Failed</div></div>
    <div class="stat warn"><div class="n">${flaky}</div><div class="l">Flaky</div></div>
    <div class="stat muted"><div class="n">${skipped}</div><div class="l">Skipped</div></div>
    <div class="stat"><div class="n">${passRate}%</div><div class="l">Pass rate</div></div>
  </div>

  <p class="scope-line"><strong>Scope:</strong> ${PENDING}</p>

  <h2>Summary</h2>
  <table class="summary-table">
    <thead>
      <tr><th>ID</th><th>Scenario</th><th>Result</th></tr>
    </thead>
    <tbody>
      ${summaryRows}
    </tbody>
  </table>

  <h2>Evidence (${totalAppLogLines} correlated application log line${totalAppLogLines === 1 ? '' : 's'} captured)</h2>
  <p class="note">Application log lines shown below are captured directly from the running service via a per-request correlation id and are not edited or summarized.</p>
  ${evidenceSections}

  <h2>Endorsement</h2>
  <div class="endorsement-block"><div class="endorsement-text">${PENDING} — run /sat-approve to record a sign-off.</div></div>
</body>
</html>
`;

const outDir = path.join(__dirname, 'qa-certificates');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `qa-certificate-${generatedAt.replace(/[:.]/g, '-')}.html`);
fs.writeFileSync(outFile, html, 'utf-8');

console.log(`\nQA Test Certificate generated: ${outFile}`);
console.log(`Verdict: ${verdict}  (${passed}/${total} passed, ${failed} failed, ${flaky} flaky, ${skipped} skipped)`);
console.log(`Correlated application log lines captured: ${totalAppLogLines}`);
