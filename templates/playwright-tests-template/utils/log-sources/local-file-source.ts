import * as fs from 'fs';
import type { LogSource, LogTimeWindow } from './types';

/**
 * Reads the Spring Boot app's own log file from disk. Only works when the app and the test
 * runner share a filesystem — i.e. a local `./gradlew bootRun` on the same machine, writing to
 * `logging.file.name` from application.yml (default: logs/__ARTIFACT_NAME__.log at the project root).
 */
export class LocalFileLogSource implements LogSource {
  readonly name = 'file';

  constructor(private readonly filePath: string) {}

  async fetchLogsForRequest(requestId: string, _window: LogTimeWindow): Promise<string[]> {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf-8');
    return content.split('\n').filter((line) => line.includes(requestId));
  }
}
