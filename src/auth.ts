import * as vscode from 'vscode';

const API_KEY_SECRET = 'opencodeGo.apiKey';
const API_KEY_BACKUP = 'opencodeGo.apiKeyBackup';
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getApiKey(): Promise<string | undefined> {
    // Primary: try the encrypted SecretStorage.
    const secret = await this.context.secrets.get(API_KEY_SECRET);
    if (secret?.trim()) {
      return secret.trim();
    }

    const backup = this.context.globalState.get<string>(API_KEY_BACKUP);
    if (backup?.trim()) {
      try {
        await this.context.secrets.store(API_KEY_SECRET, backup.trim());
      } catch {
      }
      return backup.trim();
    }

    const configured = vscode.workspace.getConfiguration('opencodeGo').get<string>('apiKey');
    if (configured?.trim()) {
      return configured.trim();
    }

    return undefined;
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET, apiKey);
    await this.context.globalState.update(API_KEY_BACKUP, apiKey);
  }

  async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(API_KEY_SECRET);
    await this.context.globalState.update(API_KEY_BACKUP, undefined);
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
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
