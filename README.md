# Opencode Go for Copilot

Adds OpenCode Go models to the VS Code Copilot model picker.

## Setup

1. Install the extension.
2. Run `Opencode Go: Set API Key`.
3. Open Copilot Chat and pick a model.

## Models

The model list comes live from OpenCode Go and is read again every 30 minutes. Each model's context window and API (chat completions or Anthropic messages) come from [models.dev](https://models.dev), as in OpenCode itself, so new Go models show up without an update.

GPT, Grok and Muse Spark models on Go use the OpenAI Responses API, which this extension doesn't speak yet, so they are left out.

Thinking options next to the model:

| Models | Thinking |
|---|---|
| DeepSeek | Off / High / Max |
| GLM, Kimi, MiMo | On / Off |
| Qwen (chat completions) | Auto / On / Off, plus a budget |

Each Copilot conversation sends its own session id (`x-opencode-session`), which OpenCode Go uses for routing and prompt caching.

## Commands

| What | Command |
|---|---|
| Set API key | `Opencode Go: Set API Key` |
| Remove API key | `Opencode Go: Clear API Key` |
| List models | `Opencode Go: Show Registered Models` |
| Logs | `Opencode Go: Show Logs` |

MIT
