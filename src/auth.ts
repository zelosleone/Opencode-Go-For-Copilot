import * as vscode from 'vscode';

const API_KEY_SECRET = 'opencodeGo.apiKey';
const LEGACY_BACKUP_KEY = 'opencodeGo.apiKeyBackup';
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getApiKey(): Promise<string | undefined> {
    const secret = await this.context.secrets.get(API_KEY_SECRET);
    if (secret?.trim()) {
      return secret.trim();
    }

    const migrated = await this.migrateLegacyKey();
    if (migrated) {
      return migrated;
    }

    return undefined;
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET, apiKey);
    await this.cleanupLegacyStorage();
  }

  async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(API_KEY_SECRET);
    await this.cleanupLegacyStorage();
  }

  async hasApiKey(): Promise<boolean> {
    const apiKey = await this.getApiKey();
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  async promptForApiKey(): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      prompt: 'Enter your Opencode Go API key',
      password: true,
      ignoreFocusOut: true,
      validateInput: (input) => {
        if (!input.trim()) {
          return 'API key cannot be empty.';
        }
        return undefined;
      },
    });

    if (!value) {
      return false;
    }

    await this.setApiKey(value.trim());
    vscode.window.showInformationMessage('Opencode Go API key saved.');
    return true;
  }

  getBaseUrl(): string {
    const configured = vscode.workspace.getConfiguration('opencodeGo').get<string>('baseUrl');
    return normalizeBaseUrl(configured || DEFAULT_BASE_URL);
  }

  getDefaultMaxOutputTokens(): number {
    return vscode.workspace
      .getConfiguration('opencodeGo')
      .get<number>('defaultMaxOutputTokens', DEFAULT_MAX_OUTPUT_TOKENS);
  }

  /**
   * One-shot migration from legacy plain-text storage locations
   * (globalState, settings.json) used by older extension versions.
   */
  private async migrateLegacyKey(): Promise<string | undefined> {
    const legacyBackup = this.context.globalState.get<string>(LEGACY_BACKUP_KEY);
    if (legacyBackup?.trim()) {
      try {
        await this.context.secrets.store(API_KEY_SECRET, legacyBackup.trim());
        await this.context.globalState.update(LEGACY_BACKUP_KEY, undefined);
        return legacyBackup.trim();
      } catch {}
    }

    const configured = vscode.workspace.getConfiguration('opencodeGo').get<string>('apiKey');
    if (configured?.trim()) {
      try {
        await this.context.secrets.store(API_KEY_SECRET, configured.trim());
      } catch {}
      return configured.trim();
    }

    return undefined;
  }

  /** Remove legacy plain-text copies left by older extension versions. */
  private async cleanupLegacyStorage(): Promise<void> {
    try {
      await this.context.globalState.update(LEGACY_BACKUP_KEY, undefined);
    } catch {}
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
