import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, TFile, setIcon } from "obsidian";
import { t } from "./i18n";
import { VaultTools, ToolError, checkInput } from "./vault-tools";

export const VIEW_CHAT = "ecu-claude-chat";
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];
const NO_FALLBACK = new Set(["claude-haiku-5-5"]);

const SYSTEM = [
  "You are Claude, helping the user with the notes in their Obsidian vault through the ecu-claude plugin.",
  "You can list, search and read files in the vault, and create and edit notes. Every change you make is shown to the user, who may allow or decline it.",
  "",
  "How to work:",
  "- Find notes with search_notes or list_notes, and read a note with read_note before you change it.",
  "- Prefer small, targeted changes with edit_note, quoting old_text exactly as it appears in the note. Use append_to_note to add to the end of a note and create_note only for new notes.",
  "- If the user declines a change, don't retry it unasked; ask what they would like instead.",
  "- Notes are Markdown. Link notes with [[wikilinks]] and keep existing links working. Keep YAML frontmatter intact. Put code in fenced blocks with a language tag, such as ```bash or ```yaml.",
  "- Paths are relative to the vault root, for example Projects/Plan.md. Never touch .obsidian/.",
  "- When the user attaches a note, its content is in their message inside <note> tags.",
  "- Reply in the language the user writes in. Be concise; the panel is narrow.",
].join("\n");

class TruncatedToolInput extends Error {}

class ApproveModal extends Modal {
  constructor(app, req, done) {
    super(app);
    this.req = req;
    this.done = done;
    this.answered = false;
  }
  onOpen() {
    const { req } = this;
    this.titleEl.setText(t("approve.title"));
    const el = this.contentEl;
    el.addClass("ecl-approve");
    el.createDiv({ cls: "ecl-approve-what", text: t("approve." + req.kind, { path: req.path }) });
    if (req.before != null) el.createEl("pre", { cls: "ecl-diff ecl-diff-old", text: req.before });
    if (req.after != null) el.createEl("pre", { cls: "ecl-diff ecl-diff-new", text: req.after });
    const row = el.createDiv({ cls: "modal-button-container" });
    const answer = (ok, all) => {
      this.answered = true;
      this.done(ok, all);
      this.close();
    };
    row.createEl("button", { text: t("approve.allowAll") }).addEventListener("click", () => answer(true, true));
    row.createEl("button", { text: t("approve.deny") }).addEventListener("click", () => answer(false, false));
    const allow = row.createEl("button", { cls: "mod-cta", text: t("approve.allow") });
    allow.addEventListener("click", () => answer(true, false));
    window.setTimeout(() => allow.focus(), 0);
  }
  onClose() {
    if (!this.answered) this.done(false, false);
    this.contentEl.empty();
  }
}

function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
}

export class ChatView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.history = [];
    this.attachment = null;
    this.busy = false;
    this.controller = null;
    this.allowAll = false;
    this.approveChain = Promise.resolve();
  }
  getViewType() {
    return VIEW_CHAT;
  }
  getDisplayText() {
    return t("chat.title");
  }
  getIcon() {
    return "sparkles";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("ecl-chat");
    const head = root.createDiv({ cls: "ecl-chat-head" });
    this.modelEl = head.createDiv({ cls: "ecl-chat-model" });
    const newBtn = head.createDiv({ cls: "clickable-icon", attr: { "aria-label": t("chat.new") } });
    setIcon(newBtn, "square-pen");
    newBtn.addEventListener("click", () => this.reset());
    this.listEl = root.createDiv({ cls: "ecl-chat-list" });
    const compose = root.createDiv({ cls: "ecl-chat-compose" });
    this.chipEl = compose.createDiv({ cls: "ecl-chat-chips" });
    this.input = compose.createEl("textarea", { cls: "ecl-chat-input", attr: { rows: "3", placeholder: t("chat.placeholder") } });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });
    const row = compose.createDiv({ cls: "ecl-chat-row" });
    this.usageEl = row.createDiv({ cls: "ecl-chat-usage" });
    this.sendBtn = row.createEl("button", { cls: "mod-cta ecl-chat-send", text: t("chat.send") });
    this.sendBtn.addEventListener("click", () => (this.busy ? this.stop() : this.send()));
    this.refreshHead();
    this.renderEmpty();
  }

  async onClose() {
    this.stop();
  }

  refreshHead() {
    const m = MODELS.find((x) => x.id === this.plugin.settings.model);
    if (this.modelEl) this.modelEl.setText(m ? m.label : this.plugin.settings.model);
  }

  renderEmpty() {
    if (this.history.length) return;
    this.listEl.empty();
    const box = this.listEl.createDiv({ cls: "ecl-chat-empty" });
    if (!this.plugin.apiKey()) {
      box.createDiv({ text: t("chat.noKey") });
      box.createEl("button", { text: t("chat.openSettings") }).addEventListener("click", () => this.plugin.openSettings());
    } else box.createDiv({ text: t("chat.empty") });
  }

  reset() {
    this.stop();
    this.history = [];
    this.allowAll = false;
    this.usageEl.setText("");
    this.renderEmpty();
  }

  stop() {
    if (this.controller) this.controller.abort();
  }

  attach(file, range) {
    this.attachment = { path: file.path, folder: !(file instanceof TFile), range: range || null };
    this.renderChips();
    this.input.focus();
  }

  renderChips() {
    this.chipEl.empty();
    const a = this.attachment;
    if (!a) return;
    const chip = this.chipEl.createDiv({ cls: "ecl-chip" });
    const icon = chip.createSpan({ cls: "ecl-chip-icon" });
    setIcon(icon, a.folder ? "folder" : "file-text");
    let label = a.path;
    if (a.range) label += a.range.to > a.range.from ? ` · ${a.range.from}-${a.range.to}` : ` · ${a.range.from}`;
    chip.createSpan({ text: label });
    const x = chip.createSpan({ cls: "ecl-chip-x clickable-icon", attr: { "aria-label": t("chat.remove") } });
    setIcon(x, "x");
    x.addEventListener("click", () => {
      this.attachment = null;
      this.renderChips();
    });
  }

  async attachmentBlock() {
    const a = this.attachment;
    if (!a) return null;
    const f = this.app.vault.getAbstractFileByPath(a.path);
    if (a.folder || !(f instanceof TFile)) return `<folder path="${a.path}" />\nThe user is asking about this folder; use list_notes and read_note to look inside.`;
    const text = await this.app.vault.read(f);
    const lines = a.range ? ` selected-lines="${a.range.from}-${a.range.to}"` : "";
    return `<note path="${a.path}"${lines}>\n${text}\n</note>`;
  }

  setBusy(on) {
    this.busy = on;
    this.sendBtn.setText(on ? t("chat.stop") : t("chat.send"));
    this.sendBtn.toggleClass("mod-cta", !on);
    this.sendBtn.toggleClass("mod-warning", on);
  }

  bubble(role) {
    const el = this.listEl.createDiv({ cls: "ecl-msg ecl-msg-" + role });
    return el;
  }

  scrollDown() {
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  approve(req) {
    if (!this.plugin.settings.confirm || this.allowAll) return Promise.resolve(true);
    const next = this.approveChain.then(
      () =>
        new Promise((resolve) => {
          if (this.allowAll) return resolve(true);
          new ApproveModal(this.app, req, (ok, all) => {
            if (all) this.allowAll = true;
            resolve(ok);
          }).open();
        })
    );
    this.approveChain = next.catch(() => {});
    return next;
  }

  tools(turn) {
    const vt = new VaultTools(this.app, (req) => this.approve(req));
    const wrap = (label, fn) => async (input) => {
      const line = turn.activity(label(input));
      try {
        const r = await fn(input);
        if (r && r.declined) {
          line.addClass("is-declined");
          line.setText(t("tool.declined", { what: label(input) }));
          return "The user did not allow this change. Nothing was written.";
        }
        line.addClass("is-done");
        return typeof r === "string" ? r : r.text;
      } catch (e) {
        line.addClass("is-failed");
        line.setText(t("tool.failed", { what: label(input), msg: e && e.message ? e.message : e }));
        if (e instanceof ToolError) throw e;
        throw new Error(e && e.message ? e.message : String(e));
      }
    };
    const pathDesc = "Path relative to the vault root, for example Projects/Plan.md";
    const str = (description) => ({ type: "string", description });
    const int = (description, max) => ({ type: "integer", minimum: 1, maximum: max, description });
    const def = (name, description, properties, required, label, fn) => {
      const inputSchema = { type: "object", properties, required, additionalProperties: false };
      return betaTool({
        name,
        description,
        inputSchema,
        eager_input_streaming: true,
        run: wrap(label, (input) => fn(checkInput(input, inputSchema))),
      });
    };
    return [
      def(
        "list_notes",
        "List the files in the vault, or in one folder. Use it to see what exists before reading, or to find where a note lives.",
        { folder: str("Folder relative to the vault root; leave out for the whole vault"), limit: int("Maximum number of paths, default 200", 500) },
        [],
        (i) => t("tool.list", { where: i && i.folder ? ` (${i.folder})` : "" }),
        (i) => vt.listNotes(i)
      ),
      def(
        "search_notes",
        "Search note names and contents for a word or phrase (case-insensitive). Call it whenever the user refers to a note or topic without giving its exact path. Returns matching paths with line numbers.",
        { query: str("Text to look for"), limit: int("Maximum number of notes, default 20", 50) },
        ["query"],
        (i) => t("tool.search", { q: i && i.query }),
        (i) => vt.searchNotes(i)
      ),
      def(
        "read_note",
        "Read the full text of a note or text file. Read a note before editing it.",
        { path: str(pathDesc) },
        ["path"],
        (i) => t("tool.read", { path: i && i.path }),
        (i) => vt.readNote(i)
      ),
      def(
        "create_note",
        "Create a new note with the given content. Fails if the file already exists. The user must allow the change.",
        { path: str(pathDesc + "; include the .md extension"), content: str("Full Markdown content of the new note") },
        ["path", "content"],
        (i) => t("tool.create", { path: i && i.path }),
        (i) => vt.createNote(i)
      ),
      def(
        "edit_note",
        "Replace one exact passage in an existing note. old_text must appear exactly once in the note; copy it from read_note output, including whitespace. The user must allow the change.",
        { path: str(pathDesc), old_text: str("Exact text to replace; must occur once"), new_text: str("Replacement text; may be empty to delete the passage") },
        ["path", "old_text", "new_text"],
        (i) => t("tool.edit", { path: i && i.path }),
        (i) => vt.editNote(i)
      ),
      def(
        "append_to_note",
        "Add text to the end of an existing note. The user must allow the change.",
        { path: str(pathDesc), text: str("Markdown to add at the end") },
        ["path", "text"],
        (i) => t("tool.append", { path: i && i.path }),
        (i) => vt.appendToNote(i)
      ),
    ];
  }

  async send() {
    if (this.busy) return;
    const text = this.input.value.trim();
    if (!text) return;
    const key = this.plugin.apiKey();
    if (!key) {
      this.history = [];
      return this.renderEmpty();
    }
    if (!this.history.length) this.listEl.empty();
    await this.plugin.saveOpenNotes();
    const blocks = [];
    const att = await this.attachmentBlock().catch(() => null);
    if (att) blocks.push({ type: "text", text: att });
    blocks.push({ type: "text", text });
    const userEl = this.bubble("user");
    if (this.attachment) userEl.createDiv({ cls: "ecl-msg-att", text: this.attachment.path });
    userEl.createDiv({ cls: "ecl-msg-text", text });
    const before = this.history.slice();
    this.history.push({ role: "user", content: blocks });
    const savedInput = this.input.value;
    this.input.value = "";
    this.attachment = null;
    this.renderChips();
    this.setBusy(true);
    try {
      await this.run(key, before, savedInput);
    } finally {
      this.controller = null;
      this.setBusy(false);
      this.scrollDown();
    }
  }

  newTurn() {
    const el = this.bubble("assistant");
    const turn = {
      el,
      segments: [],
      text: "",
      current: null,
      timer: null,
      activity: (label) => {
        turn.current = null;
        const line = el.createDiv({ cls: "ecl-tool", text: label });
        this.scrollDown();
        return line;
      },
    };
    return turn;
  }

  segment(turn) {
    const seg = { el: turn.el.createDiv({ cls: "ecl-msg-md markdown-rendered" }), text: "" };
    turn.segments.push(seg);
    turn.current = seg;
    return seg;
  }

  async renderSeg(seg) {
    seg.el.empty();
    await MarkdownRenderer.render(this.app, seg.text, seg.el, "", this);
  }

  schedule(turn, seg) {
    if (seg.pending) return;
    seg.pending = true;
    window.setTimeout(async () => {
      seg.pending = false;
      await this.renderSeg(seg);
      this.scrollDown();
    }, 120);
  }

  finishTurn(turn, note) {
    const full = turn.segments.map((s) => s.text).join("\n\n").trim();
    if (note) turn.el.createDiv({ cls: "ecl-note", text: note });
    if (!full) return;
    const bar = turn.el.createDiv({ cls: "ecl-msg-actions" });
    const copy = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("chat.copy") } });
    setIcon(copy, "copy");
    copy.addEventListener("click", async () => {
      try {
        await copy.win.navigator.clipboard.writeText(full);
        new Notice(t("chat.copied"));
      } catch (e) {
      }
    });
    const ins = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("chat.insert") } });
    setIcon(ins, "file-input");
    ins.addEventListener("click", () => this.insertIntoNote(full));
  }

  insertIntoNote(text) {
    const leaf = this.app.workspace.getMostRecentLeaf();
    const v = leaf && leaf.view;
    if (!(v instanceof MarkdownView) || v.getMode() !== "source") return new Notice(t("chat.noEditor"));
    v.editor.replaceSelection(text);
    new Notice(t("chat.inserted", { file: v.file ? v.file.basename : "" }));
  }

  params() {
    const s = this.plugin.settings;
    const p = {
      model: s.model,
      max_tokens: 64000,
      system: [{ type: "text", text: SYSTEM }],
      messages: this.history,
      output_config: { effort: s.effort },
      cache_control: { type: "ephemeral" },
      stream: true,
    };
    if (!NO_FALLBACK.has(s.model)) {
      p.betas = ["server-side-fallback-2026-07-01"];
      p.fallbacks = "default";
    }
    return p;
  }

  explain(err) {
    const s = this.plugin.settings;
    if (err instanceof Anthropic.APIUserAbortError) return t("chat.stopped");
    if (err instanceof Anthropic.AuthenticationError) return t("err.auth");
    if (err instanceof Anthropic.PermissionDeniedError) return t("err.permission", { model: s.model });
    if (err instanceof Anthropic.RateLimitError) return t("err.rate");
    if (err instanceof Anthropic.APIConnectionError) return t("err.network", { msg: err.message });
    if (err instanceof Anthropic.APIError) {
      if (err.status === 529) return t("err.overloaded");
      return t("err.api", { status: err.status, msg: err.message });
    }
    return err && err.message ? err.message : String(err);
  }

  async run(key, before, savedInput) {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    this.controller = new AbortController();
    const turn = this.newTurn();
    const tools = this.tools(turn);
    let runner = client.beta.messages.toolRunner({ ...this.params(), tools }, { signal: this.controller.signal });
    const usage = { in: 0, out: 0, cache: 0 };
    let last = null;
    let note = "";
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const stream of runner) {
          for await (const ev of stream) {
            if (ev.type === "content_block_start" && ev.content_block.type === "text") this.segment(turn);
            else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              const seg = turn.current || this.segment(turn);
              seg.text += ev.delta.text;
              this.schedule(turn, seg);
            }
          }
          const msg = await stream.finalMessage();
          attempt = 0;
          last = msg;
          const u = msg.usage || {};
          usage.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          usage.cache += u.cache_read_input_tokens || 0;
          usage.out += u.output_tokens || 0;
          const hasTool = msg.content.some((b) => b.type === "tool_use");
          if (msg.stop_reason === "max_tokens" && hasTool) throw new TruncatedToolInput("truncated");
          if (msg.stop_reason === "refusal") {
            note = t("chat.refusal");
            break;
          }
          if (msg.stop_reason === "max_tokens") note = t("chat.truncated");
        }
        break;
      } catch (err) {
        const recoverable = !(err instanceof Anthropic.APIError) && !(err instanceof TruncatedToolInput) && !this.controller.signal.aborted;
        if (recoverable && attempt < 2) {
          runner = client.beta.messages.toolRunner({ ...runner.params }, { signal: this.controller.signal });
          continue;
        }
        if (err instanceof TruncatedToolInput) note = t("chat.truncated");
        else note = this.explain(err);
        const progressed = runner.params.messages.length > before.length + 1;
        if (!progressed && !(err instanceof Anthropic.APIUserAbortError) && !last) {
          this.history = before;
          if (!this.input.value) this.input.value = savedInput;
        } else this.history = runner.params.messages.slice();
        for (const seg of turn.segments) await this.renderSeg(seg);
        this.finishTurn(turn, note);
        this.showUsage(usage);
        return;
      }
    }
    this.history = runner.params.messages.slice();
    for (const seg of turn.segments) await this.renderSeg(seg);
    this.finishTurn(turn, note);
    this.showUsage(usage);
  }

  showUsage(u) {
    if (!u.in && !u.out) return;
    this.usageEl.setText(t("chat.usage", { in: fmt(u.in), out: fmt(u.out), cache: fmt(u.cache) }));
  }
}
