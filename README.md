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

## Made for editing notes safely

- **Your latest text is what Claude sees.** Before a note is sent to Claude, open notes are saved, so
  line numbers and content match what's on your screen. When Claude edits a note, Obsidian shows the
  change right away.
- **Nothing is typed into a question.** If Claude is showing a dialog (first-run setup, "trust this
  folder", or a permission prompt like "Do you want to make this edit?"), ecu-claude doesn't type
  into it. The reference goes to the clipboard instead, so you can paste it when Claude is ready.
- **Prepare the vault** (command or button in settings) adds two files, and never overwrites
  existing ones:
  - `CLAUDE.md`, which tells Claude this is an Obsidian vault: use `[[wikilinks]]` and keep them
    working, keep frontmatter, put code in fenced blocks with a language, edit in place, write in the
    note's language.
  - `.claude/settings.json` with the rule `Edit(/.obsidian/**)` denied, so Claude can't change
    Obsidian's settings or plugins. This applies when Claude runs in the vault folder (the default).

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
