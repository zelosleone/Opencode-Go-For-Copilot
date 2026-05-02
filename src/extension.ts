import * as vscode from 'vscode';
import { logger } from './logger.js';
import { OpenCodeGoChatProvider } from './provider.js';

export function activate(context: vscode.ExtensionContext): void {
  logger.info('Activating Opencode Go extension.');

  try {
    const provider = new OpenCodeGoChatProvider(context);

    context.subscriptions.push(
      vscode.commands.registerCommand('opencodeGo.setApiKey', () => provider.configureApiKey()),
      vscode.commands.registerCommand('opencodeGo.clearApiKey', () => provider.clearApiKey()),
      vscode.commands.registerCommand('opencodeGo.showRegisteredModels', () => provider.showRegisteredModels()),
      vscode.commands.registerCommand('opencodeGo.showLogs', () => logger.show()),
      vscode.lm.registerLanguageModelChatProvider('opencode-go', provider),
    );

    logger.info('Opencode Go extension activated.');
  } catch (error) {
    logger.error('Failed to activate Opencode Go extension.', error);
    void vscode.window.showErrorMessage(
      'Opencode Go failed to activate. Run "Opencode Go: Show Logs" for details.',
    );
    throw error;
  }
}

export function deactivate(): void {
  try {
    logger.info('Opencode Go extension deactivated.');
  } catch {
    // VS Code may dispose the output channel before deactivate runs.
  }
  logger.dispose();
}
