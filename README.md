# Opencode Go for Copilot

`Opencode Go for Copilot` adds OpenCode Go models to the VS Code Copilot model picker.

The extension is built for the native language model provider flow in VS Code 1.118+. Models stay visible in the picker before you add a key, most models use the OpenAI-compatible `chat/completions` path, MiniMax uses the Anthropic-style `messages` path, and reasoning output is preserved across tool loops where the upstream model docs require it.

## What You Get

- OpenCode Go models under a single `Opencode Go` provider in Copilot Chat
- Silent model sync on startup and when `opencodeGo.baseUrl` changes
- Plain model names in the picker, without duplicated provider labels
- Vendor-specific thinking controls where the public docs support them
- Tool calling support through the current VS Code LM provider API

## Supported Models

The shipped catalog includes the current OpenCode Go set:

- `GLM-5`
- `GLM-5.1`
- `Kimi K2.5`
- `Kimi K2.6`
- `MiMo-V2-Pro`
- `MiMo-V2-Omni`
- `MiMo-V2.5-Pro`
- `MiMo-V2.5`
- `MiniMax M2.5`
- `MiniMax M2.7`
- `Qwen3.5 Plus`
- `Qwen3.6 Plus`
- `DeepSeek V4 Pro`
- `DeepSeek V4 Flash`

## Thinking Controls

Only models with public, documented request-side controls get picker options:

- `DeepSeek V4 Pro` / `DeepSeek V4 Flash`: `Off`, `High`, `Max`
- `GLM-5` / `GLM-5.1`: `On`, `Off`
- `Kimi K2.5` / `Kimi K2.6`: `On`, `Off`
- `Qwen3.5 Plus` / `Qwen3.6 Plus`: `Auto`, `On`, `Off`, plus optional `Thinking Budget`

MiniMax still preserves thinking history for multi-step tool use, but this extension does not expose a MiniMax on/off or effort picker because the OpenCode Go path does not document one clearly enough.

MiMo models stay on the default path for the same reason: public Xiaomi docs do not currently document stable request-side thinking controls for this integration.

## Setup

1. Install the extension.
2. Run `Opencode Go: Set API Key`.
3. Open Copilot Chat and choose an `Opencode Go` model.

The API key is stored in VS Code secret storage. `opencodeGo.apiKey` still exists as a fallback setting, but the command is the cleaner path.

## Commands

| Command | Purpose |
|---|---|
| `Opencode Go: Set API Key` | Save the Opencode Go API key in secret storage |
| `Opencode Go: Clear API Key` | Remove the stored key |
| `Opencode Go: Show Registered Models` | Dump the currently registered models to the output log |
| `Opencode Go: Show Logs` | Open the extension log |

## Notes

- The manual refresh command is intentionally gone. Startup sync remains silent.
- If you install another provider for the same vendor family, the Opencode Go entries still appear under `Opencode Go`, not under the other extension.
- Reasoning output is streamed when the backend returns it, and cached reasoning is replayed on later tool turns for providers that expect it.
- The extension targets VS Code `1.118+` and the current language model chat provider types.

## Requirements

- VS Code `1.118+`
- GitHub Copilot access for language model providers
- OpenCode Go subscription and API key

## License

MIT
