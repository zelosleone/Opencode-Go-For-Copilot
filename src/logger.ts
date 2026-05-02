import * as vscode from 'vscode';

const OUTPUT_CHANNEL_NAME = 'Opencode Go';

class Logger {
  private readonly channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

  info(message: string, ...details: unknown[]): void {
    this.channel.appendLine(this.format('INFO', message, details));
  }

  warn(message: string, ...details: unknown[]): void {
    this.channel.appendLine(this.format('WARN', message, details));
  }

  error(message: string, ...details: unknown[]): void {
    this.channel.appendLine(this.format('ERROR', message, details));
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private format(level: string, message: string, details: unknown[]): string {
    const suffix = details
      .map((detail) => {
        if (detail instanceof Error) {
          return detail.stack || detail.message;
        }
        if (typeof detail === 'string') {
          return detail;
        }
        try {
          return JSON.stringify(detail);
        } catch {
          return String(detail);
        }
      })
      .filter(Boolean)
      .join(' ');

    return `[${new Date().toISOString()}] [${level}] ${message}${suffix ? ` ${suffix}` : ''}`;
  }
}

export const logger = new Logger();
