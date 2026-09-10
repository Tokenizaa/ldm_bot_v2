import { LogEntry } from '../types.js';

class LoggerService {
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  private sanitize(message: string): string {
    // Redact sensitive patterns like keys, tokens, cookies, passwords
    return message
      .replace(/(?:api[-_]?key|authorization|bearer|token|password|secret|cookie)[=:\s]+["']?([a-zA-Z0-9_\-\.]{8,})["']?/gi, '$1=[REDACTED]')
      .replace(/nvapi-[a-zA-Z0-9_\-]{10,}/gi, '[REDACTED_NVIDIA_KEY]')
      .replace(/eyJh[a-zA-Z0-9_\-\.]{20,}/gi, '[REDACTED_JWT]');
  }

  log(source: LogEntry['source'], message: string, level: LogEntry['level'] = 'info') {
    const cleanMessage = this.sanitize(message);
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      source,
      message: cleanMessage,
      level,
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    const prefix = `[${source}]`;
    console.log(`${prefix} ${cleanMessage}`);
  }

  crawler(message: string, level: LogEntry['level'] = 'info') {
    this.log('Crawler', message, level);
  }

  ai(message: string, level: LogEntry['level'] = 'info') {
    this.log('AI', message, level);
  }

  scheduler(message: string, level: LogEntry['level'] = 'info') {
    this.log('Scheduler', message, level);
  }

  facebook(message: string, level: LogEntry['level'] = 'info') {
    this.log('Facebook', message, level);
  }

  system(message: string, level: LogEntry['level'] = 'info') {
    this.log('System', message, level);
  }

  getLogs(limit = 100): LogEntry[] {
    return this.logs.slice(0, limit);
  }

  clear() {
    this.logs = [];
  }
}

export const logger = new LoggerService();
