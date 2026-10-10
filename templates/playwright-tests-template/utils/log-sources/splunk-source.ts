import type { LogSource, LogTimeWindow } from './types';

/**
 * Reads correlated log lines from Splunk instead of a local file — for when the app under
 * test is deployed somewhere the test runner has no filesystem access to (a non-prod
 * environment), and the only shared place its logs end up is the log aggregator.
 *
 * NOT YET WIRED UP TO A REAL INSTANCE — this was written against Splunk's documented REST
 * Search API (job dispatch -> poll -> fetch results), but hasn't been exercised against an
 * actual deployment. Once real connection details exist, set the env vars below and re-verify
 * the search query, index/sourcetype names, and auth against that instance; this is meant to
 * be the one piece that needs adjusting, not a rewrite of logger.ts/the certificate generator.
 *
 * Required env vars:
 *   SPLUNK_BASE_URL   - e.g. https://splunk.example.internal:8089 (the management port, not
 *                       the web UI port — Splunk's REST API lives there by default)
 *   SPLUNK_INDEX      - the index the non-prod app's logs land in
 * Auth (one of):
 *   SPLUNK_TOKEN                        - a Splunk auth token, sent as "Authorization: Bearer <token>"
 *   SPLUNK_USERNAME + SPLUNK_PASSWORD   - sent as HTTP Basic auth on every request instead
 * Optional:
 *   SPLUNK_SOURCETYPE          - narrows the search to a specific sourcetype
 *   SPLUNK_TIME_PADDING_SECONDS - widens the search window around the request's actual
 *                                 start/finish, to absorb clock skew and forwarder lag (default: 10)
 *   SPLUNK_INSECURE_TLS        - set to "true" to skip TLS verification (self-signed certs on
 *                                 an internal non-prod Splunk) — never set this against anything
 *                                 reachable from outside your network
 */
export class SplunkLogSource implements LogSource {
  readonly name = 'splunk';

  private readonly baseUrl: string;
  private readonly index: string;
  private readonly sourcetype?: string;
  private readonly paddingSeconds: number;
  private readonly authHeader: string;

  constructor() {
    const baseUrl = process.env.SPLUNK_BASE_URL;
    const index = process.env.SPLUNK_INDEX;
    const token = process.env.SPLUNK_TOKEN;
    const username = process.env.SPLUNK_USERNAME;
    const password = process.env.SPLUNK_PASSWORD;

    const missing: string[] = [];
    if (!baseUrl) missing.push('SPLUNK_BASE_URL');
    if (!index) missing.push('SPLUNK_INDEX');
    if (!token && !(username && password)) missing.push('SPLUNK_TOKEN (or SPLUNK_USERNAME + SPLUNK_PASSWORD)');
    if (missing.length) {
      throw new Error(
        `LOG_SOURCE=splunk but required config is missing: ${missing.join(', ')}. ` +
          `See utils/log-sources/splunk-source.ts for the full list of env vars.`,
      );
    }

    if (process.env.SPLUNK_INSECURE_TLS === 'true') {
      console.warn(
        '[splunk-log-source] SPLUNK_INSECURE_TLS=true — skipping TLS verification for Splunk requests. ' +
          'Only use this against an internal, trusted non-prod Splunk instance.',
      );
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    this.baseUrl = baseUrl!.replace(/\/+$/, '');
    this.index = index!;
    this.sourcetype = process.env.SPLUNK_SOURCETYPE;
    this.paddingSeconds = Number(process.env.SPLUNK_TIME_PADDING_SECONDS || 10);
    this.authHeader = token
      ? `Bearer ${token}`
      : `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  async fetchLogsForRequest(requestId: string, window: LogTimeWindow): Promise<string[]> {
    const earliest = Math.floor(window.startedAt / 1000) - this.paddingSeconds;
    const latest = Math.ceil(window.finishedAt / 1000) + this.paddingSeconds;
    const sourcetypeClause = this.sourcetype ? ` sourcetype="${this.sourcetype}"` : '';
    const search = `search index=${this.index}${sourcetypeClause} "${requestId}"`;

    const sid = await this.createSearchJob(search, earliest, latest);
    await this.waitForJobDone(sid);
    return this.fetchJobResults(sid);
  }

  private async splunkFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: this.authHeader, ...(init.headers || {}) },
    });
    if (!response.ok) {
      throw new Error(`Splunk request to ${path} failed: ${response.status} ${response.statusText}`);
    }
    return response;
  }

  private async createSearchJob(search: string, earliest: number, latest: number): Promise<string> {
    const body = new URLSearchParams({
      search,
      earliest_time: String(earliest),
      latest_time: String(latest),
      output_mode: 'json',
    });
    const response = await this.splunkFetch('/services/search/jobs', { method: 'POST', body });
    const data = (await response.json()) as { sid?: string };
    if (!data.sid) throw new Error('Splunk did not return a search job id (sid).');
    return data.sid;
  }

  private async waitForJobDone(sid: string, maxAttempts = 20, intervalMs = 500): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.splunkFetch(`/services/search/jobs/${sid}?output_mode=json`);
      const data = (await response.json()) as { entry?: Array<{ content?: { dispatchState?: string } }> };
      const state = data.entry?.[0]?.content?.dispatchState;
      if (state === 'DONE') return;
      if (state === 'FAILED') throw new Error(`Splunk search job ${sid} failed.`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Splunk search job ${sid} did not finish within ${maxAttempts * intervalMs}ms.`);
  }

  private async fetchJobResults(sid: string): Promise<string[]> {
    const response = await this.splunkFetch(`/services/search/jobs/${sid}/results?output_mode=json&count=0`);
    const data = (await response.json()) as { results?: Array<{ _raw?: string }> };
    return (data.results || []).map((r) => r._raw || '').filter(Boolean);
  }
}
