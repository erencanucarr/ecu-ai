# ecu-claude

Open Claude Code next to your notes with one click, the way the VS Code extension does, and
point it at the note or lines you're looking at.

## What it does

- **Open Claude Code**: the ✦ button in the left ribbon (or the command "Open Claude Code")
  opens a "Claude Code" pane on the right and starts `claude` in your vault folder. Clicking it
  again brings the same pane back instead of starting a second one.
- **Ask about this note**: from the command palette, the editor's right-click menu or the file
  explorer's right-click menu, ecu-claude types a reference to the note (or the selected lines,
  or a folder) into Claude's prompt. You add your question and press Enter.
- **Picks up where you left off**: after Obsidian restarts, the pane reopens with
  `claude --continue`, so the last conversation is still there.
- **Start fresh**: "Start a new Claude Code session" closes the pane and starts a new one.

Claude Code works on the files in its folder, so it can read, search and edit your notes. Its own
permission prompts still apply.

## Requirements

- Desktop Obsidian (macOS, Windows, Linux).
- [ecu-terminal](https://github.com/erencanucarr/ecu-terminal) 2.4 or newer. ecu-claude uses its
  terminal, so there's no second terminal engine to download.
- Claude Code installed and signed in. If the `claude` command isn't found, ecu-claude shows the
  install command for your system:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

  See the [installation guide](https://code.claude.com/docs/en/setup) for Windows and other
  options. Run `claude` once in a terminal to sign in.

## Settings

- **Claude command** and **extra arguments** (for example `--model sonnet`).
- **Open in**: a split on the right, a split below, or a new tab.
- **Working folder**: the vault, or the current note's folder.
- **Continue the last conversation** after a restart.
- **Ribbon icon** on or off, and a **Check installation** button.
- Interface in English and Turkish; it follows Obsidian's language by default.

Give "Open Claude Code" or "Ask Claude about this note" a hotkey under **Settings > Hotkeys**.

ecu-claude makes no network requests itself. It only starts the command you configure.
Claude Code is a product of Anthropic; this plugin is not affiliated with Anthropic.

## Install

1. Install and enable [ecu-terminal](https://github.com/erencanucarr/ecu-terminal).
2. From the [latest release](https://github.com/erencanucarr/ecu-claude/releases/latest),
   download `main.js`, `manifest.json` and `styles.css` into
   `<your vault>/.obsidian/plugins/ecu-claude/`.
3. Enable **ecu-claude** under **Settings > Community plugins**.

## License

MIT, see [LICENSE](LICENSE).
