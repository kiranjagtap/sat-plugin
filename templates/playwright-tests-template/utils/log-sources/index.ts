import * as path from 'path';
import type { LogSource } from './types';
import { LocalFileLogSource } from './local-file-source';
import { SplunkLogSource } from './splunk-source';

export type { LogSource, LogTimeWindow } from './types';

/**
 * Picks the log source for this test run, via LOG_SOURCE:
 *   LOG_SOURCE=file    (default) - read the app's local log file; use for `./gradlew bootRun`
 *                                  on the same machine as the tests.
 *   LOG_SOURCE=splunk          - query Splunk; use once the app is deployed somewhere that
 *                                  doesn't share a filesystem with the test runner (non-prod+).
 *
 * Constructed once per run (not per call) so a Splunk misconfiguration is reported immediately
 * instead of on the first test's first API call.
 */
export function getLogSource(): LogSource {
  const kind = (process.env.LOG_SOURCE || 'file').toLowerCase();

  switch (kind) {
    case 'file': {
      const filePath =
        process.env.APP_LOG_FILE || path.join(__dirname, '..', '..', '..', 'logs', '__ARTIFACT_NAME__.log');
      return new LocalFileLogSource(filePath);
    }
    case 'splunk':
      return new SplunkLogSource();
    default:
      throw new Error(`Unknown LOG_SOURCE "${kind}" — expected "file" or "splunk".`);
  }
}
