# ecu-claude

Claude next to your notes, two ways:

- **Claude Code** (terminal): one click opens Claude Code in a pane beside your notes, the way the
  VS Code extension does. Needs Claude Code installed.
- **API key** (chat panel): a chat panel that talks to the Claude API with your own Anthropic API
  key. Nothing to install, and it works on mobile too.

In both, "Ask Claude about this note" points Claude at the note, the selected lines or a folder.

## Claude Code mode

- The ✦ button in the left ribbon (or "Open Claude") opens a "Claude Code" pane and starts `claude`
  in your vault folder. Clicking it again brings the same pane back.
- "Ask Claude about this note" (command palette, editor and file explorer right-click menus) types a
  reference to the note, the selected lines or a folder into Claude's prompt. You add your question.
- After Obsidian restarts, the pane reopens with `claude --continue`, so the conversation is still
  there. "Start a new Claude session" starts fresh.
- **Your latest text is what Claude sees**: open notes are saved before a reference is sent.
- **Nothing is typed into a question**: if Claude shows a dialog (first-run setup, "trust this
  folder", a permission prompt), ecu-claude doesn't type into it; the reference goes to the clipboard.
- **Prepare the vault** adds a `CLAUDE.md` with the vault's conventions (wikilinks, frontmatter, code
  blocks with a language, edit in place, the note's language) and a `.claude/settings.json` rule that
  stops Claude from editing `.obsidian/`. Existing files are never overwritten.

Requires [ecu-terminal](https://github.com/erencanucarr/ecu-terminal) 2.4 or newer, and Claude Code
installed and signed in (a Claude Pro/Max plan or an Anthropic Console account):

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

See the [installation guide](https://code.claude.com/docs/en/setup) for Windows and other options.

## API key mode

- Choose **API key** under **Connect with**, then add your key from
  [platform.claude.com](https://platform.claude.com/settings/keys). The key is kept in Obsidian's
  keychain, not in the vault, so it doesn't travel with sync. Usage is billed to your Anthropic
  account; the panel shows the tokens each reply used.
- The chat panel opens on the right. Claude can **list, search and read** notes, and **create,
  edit and append to** notes. Every change is shown first (what's removed, what's added) and only
  happens when you click Allow, unless you turn "Ask before changes" off or choose "Allow all in this
  chat".
- Edits replace one exact passage that must appear once in the note, so Claude can't accidentally
  rewrite the wrong part. Paths are checked to stay inside the vault, and `.obsidian/` is off limits.
- "Ask Claude about this note" attaches the note (and the selected lines) to your next message.
- Every reply has **Copy** and **Insert into note** buttons, so code Claude writes can go straight
  into the note you're editing.
- Models: Claude Opus 5.5 (default), Claude Sonnet 5.5 or Claude Haiku 5.5, with a low / medium /
  high effort setting. Requests use prompt caching, and on Opus and Sonnet a declined request is
  retried on a fallback model automatically.

## Settings

- **Connect with**: Claude Code or API key (mobile always uses the API key).
- **Claude command** and **extra arguments** (for example `--model sonnet`).
- **Open in**: a split on the right, a split below, or a new tab.
- **Working folder**: the vault, or the current note's folder.
- **Continue the last conversation** after a restart.
- **Ribbon icon** on or off, and a button that shows the install commands. If the command isn't found when you open Claude, the install guide opens on its own.
- Interface in English and Turkish; it follows Obsidian's language by default.

Give "Open Claude" or "Ask Claude about this note" a hotkey under **Settings > Hotkeys**.

In Claude Code mode ecu-claude makes no network requests itself; it only starts the command you
configure. In API key mode it sends your messages, and the notes you attach or Claude reads, to the
Claude API at api.anthropic.com.
Claude Code is a product of Anthropic; this plugin is not affiliated with Anthropic.

## Install

1. For Claude Code mode, install and enable [ecu-terminal](https://github.com/erencanucarr/ecu-terminal).
2. From the [latest release](https://github.com/erencanucarr/ecu-claude/releases/latest),
   download `main.js`, `manifest.json` and `styles.css` into
   `<your vault>/.obsidian/plugins/ecu-claude/`.
3. Enable **ecu-claude** under **Settings > Community plugins**.

## License

MIT, see [LICENSE](LICENSE).
