const { Plugin, PluginSettingTab, Setting, SecretComponent, Notice, Modal, MarkdownView, TFile, TFolder, Platform, setIcon } = require("obsidian");

const { t, resolveUiLang, setUiLang } = require("./i18n");
const { ChatView, VIEW_CHAT, MODELS } = require("./chat");

const TOOL_ID = "ecu-claude";
const DOCS_URL = "https://code.claude.com/docs/en/setup";
const INSTALL = {
  mac: "curl -fsSL https://claude.ai/install.sh | bash",
  win: "irm https://claude.ai/install.ps1 | iex",
  npm: "npm install -g @anthropic-ai/claude-code",
};
const CLAUDE_MD = [
  "# Obsidian vault",
  "",
  "This folder is an Obsidian vault. Notes are Markdown files and Obsidian may have them open while you work.",
  "",
  "- Link notes with wikilinks: [[Note name]], [[Note name#Heading]] or [[Note name|label]]. When you rename or move a note, update the links that point to it.",
  "- Keep the YAML frontmatter at the top of a note intact unless you're asked to change it.",
  "- Put code in fenced blocks with a language tag, for example ```bash, ```yaml or ```python.",
  "- Edit notes in place. Don't create copies or new notes unless asked.",
  "- Write in the language the note is written in.",
  "- Don't change anything in .obsidian/; that is Obsidian's own configuration and plugins.",
  "- Leave attachments (images, PDFs) where they are unless asked to move them.",
  "",
].join("\n");
const CLAUDE_SETTINGS = JSON.stringify({ permissions: { deny: ["Edit(/.obsidian/**)"] } }, null, 2) + "\n";
const MISSING_RE = /(command not found|Unknown command: |is not recognized as (an internal|the name)|CommandNotFoundException|No such file or directory)/i;
const DIALOG_RE = /(Choose the text style|Do you trust|trust the files|Select login method|login method|Press Enter to continue|Do you want to (proceed|make this edit|create|allow|run)|Yes, proceed|Esc to cancel|❯\s*(\d+\.|✔))/i;

const DEFAULTS = {
  uiLang: "auto",
  mode: "cli",
  command: "claude",
  args: "",
  place: "right",
  folder: "vault",
  resume: true,
  ribbon: true,
  apiKeySecret: "",
  model: "claude-opus-5-5",
  effort: "medium",
  confirm: true,
};
const KEYS_URL = "https://platform.claude.com/settings/keys";

function shQuote(s) {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  if (Platform.isWin) return '"' + s.replace(/"/g, '\\"') + '"';
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function lastLines(text, n) {
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .join("\n");
}

function mention(rel) {
  return /\s/.test(rel) ? '"' + rel.replace(/"/g, '\\"') + '"' : "@" + rel;
}

class InstallModal extends Modal {
  constructor(app, cmd, onAnyway) {
    super(app);
    this.cmd = cmd;
    this.onAnyway = onAnyway;
  }
  onOpen() {
    const el = this.contentEl;
    this.titleEl.setText(t("install.title"));
    el.addClass("ecl-install");
    el.createEl("p", { text: t("install.text", { cmd: this.cmd }) });
    const row = (label, cmd) => {
      el.createDiv({ cls: "ecl-install-label", text: label });
      const box = el.createDiv({ cls: "ecl-install-cmd" });
      box.createEl("code", { text: cmd });
      const b = box.createEl("button", { text: t("install.copy") });
      b.addEventListener("click", async () => {
        try {
          await box.win.navigator.clipboard.writeText(cmd);
          b.setText(t("install.copied"));
        } catch (e) {
        }
      });
    };
    if (Platform.isWin) row(t("install.win"), INSTALL.win);
    else row(t("install.mac"), INSTALL.mac);
    row(t("install.npm"), INSTALL.npm);
    const foot = el.createDiv({ cls: "modal-button-container" });
    foot.createEl("a", { text: t("install.docs"), href: DOCS_URL });
    if (this.onAnyway)
      foot.createEl("button", { text: t("install.anyway") }).addEventListener("click", () => {
        this.close();
        this.onAnyway();
      });
  }
  onClose() {
    this.contentEl.empty();
  }
}

class ClaudeSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const el = this.containerEl;
    const p = this.plugin;
    el.empty();
    const save = async (key, v, redraw) => {
      p.settings[key] = v;
      await p.saveSettings();
      if (redraw) this.display();
    };
    new Setting(el)
      .setName(t("set.lang"))
      .setDesc(t("set.langDesc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("set.langAuto"))
          .addOption("en", "English")
          .addOption("tr", "Türkçe")
          .setValue(p.settings.uiLang)
          .onChange(async (v) => {
            setUiLang(v);
            await save("uiLang", v, true);
          })
      );
    new Setting(el)
      .setName(t("set.ribbon"))
      .setDesc(t("set.ribbonDesc"))
      .addToggle((x) =>
        x.setValue(p.settings.ribbon).onChange(async (v) => {
          await save("ribbon", v);
          p.syncRibbon();
        })
      );
    if (Platform.isDesktopApp)
      new Setting(el)
        .setName(t("set.mode"))
        .setDesc(t("set.modeDesc"))
        .addDropdown((d) =>
          d
            .addOption("cli", t("set.modeCli"))
            .addOption("api", t("set.modeApi"))
            .setValue(p.settings.mode)
            .onChange((v) => save("mode", v, true))
        );
    if (p.mode() === "api") this.apiSection(el, save);
    else this.cliSection(el, save);
  }

  apiSection(el, save) {
    const p = this.plugin;
    new Setting(el).setName(t("set.apiHeading")).setHeading();
    const key = new Setting(el).setName(t("set.apiKey")).setDesc(t("set.apiKeyDesc"));
    new SecretComponent(this.app, key.controlEl).setValue(p.settings.apiKeySecret || "").onChange(async (v) => {
      await save("apiKeySecret", v || "");
      p.refreshChats();
    });
    key.descEl.createEl("br");
    key.descEl.createEl("a", { text: t("set.getKey"), href: KEYS_URL });
    new Setting(el)
      .setName(t("set.model"))
      .setDesc(t("set.modelDesc"))
      .addDropdown((d) => {
        for (const m of MODELS) d.addOption(m.id, m.label);
        d.setValue(p.settings.model).onChange(async (v) => {
          await save("model", v);
          p.refreshChats();
        });
      });
    new Setting(el)
      .setName(t("set.effort"))
      .setDesc(t("set.effortDesc"))
      .addDropdown((d) =>
        d
          .addOption("low", t("effort.low"))
          .addOption("medium", t("effort.medium"))
          .addOption("high", t("effort.high"))
          .setValue(p.settings.effort)
          .onChange((v) => save("effort", v))
      );
    new Setting(el)
      .setName(t("set.confirm"))
      .setDesc(t("set.confirmDesc"))
      .addToggle((x) => x.setValue(p.settings.confirm).onChange((v) => save("confirm", v)));
  }

  cliSection(el, save) {
    const p = this.plugin;
    new Setting(el).setName(t("set.cliHeading")).setHeading();
    new Setting(el)
      .setName(t("set.command"))
      .setDesc(t("set.commandDesc"))
      .addText((x) =>
        x
          .setPlaceholder("claude")
          .setValue(p.settings.command)
          .onChange((v) => save("command", v.trim() || "claude"))
      );
    new Setting(el)
      .setName(t("set.args"))
      .setDesc(t("set.argsDesc"))
      .addText((x) => x.setValue(p.settings.args).onChange((v) => save("args", v.trim())));
    new Setting(el)
      .setName(t("set.place"))
      .setDesc(t("set.placeDesc"))
      .addDropdown((d) =>
        d
          .addOption("right", t("set.placeRight"))
          .addOption("bottom", t("set.placeBottom"))
          .addOption("tab", t("set.placeTab"))
          .setValue(p.settings.place)
          .onChange((v) => save("place", v))
      );
    new Setting(el)
      .setName(t("set.folder"))
      .setDesc(t("set.folderDesc"))
      .addDropdown((d) =>
        d
          .addOption("vault", t("set.folderVault"))
          .addOption("note", t("set.folderNote"))
          .setValue(p.settings.folder)
          .onChange((v) => save("folder", v))
      );
    new Setting(el)
      .setName(t("set.resume"))
      .setDesc(t("set.resumeDesc"))
      .addToggle((x) => x.setValue(p.settings.resume).onChange((v) => save("resume", v)));
    new Setting(el)
      .setName(t("set.prepare"))
      .setDesc(t("set.prepareDesc"))
      .addButton((b) => b.setButtonText(t("set.prepareBtn")).onClick(() => p.prepareVault()));
    new Setting(el)
      .setName(t("set.install"))
      .setDesc(t("set.installDesc"))
      .addButton((b) => b.setButtonText(t("set.installBtn")).onClick(() => new InstallModal(p.app, p.settings.command || "claude").open()));
  }
}

module.exports = class EcuClaude extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    setUiLang(this.settings.uiLang);
    this.ribbonEl = null;
    this.registerView(VIEW_CHAT, (leaf) => new ChatView(leaf, this));
    this.syncRibbon();

    this.addCommand({ id: "open", name: t("cmd.open"), callback: () => this.open() });
    this.addCommand({
      id: "new-session",
      name: t("cmd.new"),
      callback: async () => {
        if (this.mode() !== "api") return this.open({ fresh: true });
        const view = await this.openChat();
        if (view) view.reset();
      },
    });
    this.addCommand({
      id: "ask-note",
      name: t("cmd.askNote"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.ask(file);
        return true;
      },
    });
    this.addCommand({
      id: "ask-selection",
      name: t("cmd.askSelection"),
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !editor.somethingSelected()) return false;
        if (!checking) this.ask(view.file, this.selRange(editor));
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const file = info && info.file;
        if (!file) return;
        const sel = editor.somethingSelected();
        menu.addItem((i) =>
          i
            .setTitle(sel ? t("menu.askSelection") : t("menu.askNote"))
            .setIcon("sparkles")
            .setSection("ecu-claude")
            .onClick(() => this.ask(file, sel ? this.selRange(editor) : null))
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!file || !(file instanceof TFile || file instanceof TFolder)) return;
        menu.addItem((i) =>
          i
            .setTitle(file instanceof TFolder ? t("menu.askFolder") : t("menu.askFile"))
            .setIcon("sparkles")
            .setSection("open")
            .onClick(() => this.ask(file))
        );
      })
    );

    this.addCommand({ id: "prepare-vault", name: t("cmd.prepare"), callback: () => this.prepareVault() });

    this.addSettingTab(new ClaudeSettings(this.app, this));
  }

  async prepareVault() {
    const a = this.app.vault.adapter;
    const made = [];
    const kept = [];
    const put = async (path, body) => {
      try {
        if (await a.exists(path)) return kept.push(path);
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (dir && !(await a.exists(dir))) await a.mkdir(dir);
        await a.write(path, body);
        made.push(path);
      } catch (e) {
        new Notice(t("prepare.failed", { file: path, error: e && e.message ? e.message : e }));
      }
    };
    await put("CLAUDE.md", CLAUDE_MD);
    await put(".claude/settings.json", CLAUDE_SETTINGS);
    if (made.length) new Notice(t("prepare.done", { files: made.join(", ") }));
    if (kept.length) new Notice(t("prepare.skipped", { files: kept.join(", ") }), 8000);
  }

  async saveOpenNotes() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const v = leaf.view;
      try {
        if (v && v.file && typeof v.save === "function") await v.save();
      } catch (e) {
      }
    }
  }

  async waitReady(term, ms) {
    const until = Date.now() + ms;
    const sleep = (n) => new Promise((r) => window.setTimeout(r, n));
    while (Date.now() < until) {
      const st = term.api.toolText ? term.api.toolText(TOOL_ID, 30) : null;
      if (st && st.commandSentMs >= 0 && !st.running) return false;
      if (st && st.commandSentMs >= 0 && this.missing(st)) return "missing";
      if (st && st.running && st.commandSentMs > 1500 && st.idleMs > 600) {
        const tail = lastLines(st.text, 25);
        if (!DIALOG_RE.test(tail)) return true;
      }
      await sleep(200);
    }
    return false;
  }

  onunload() {
    if (this.ribbonEl) this.ribbonEl.detach();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  syncRibbon() {
    if (this.settings.ribbon && !this.ribbonEl) this.ribbonEl = this.addRibbonIcon("sparkles", t("cmd.open"), () => this.open());
    else if (!this.settings.ribbon && this.ribbonEl) {
      this.ribbonEl.detach();
      this.ribbonEl = null;
    }
  }

  terminal() {
    const plugins = this.app.plugins && this.app.plugins.plugins;
    const term = plugins && plugins["ecu-terminal"];
    if (!term) {
      new Notice(t("notice.needsTerminal"), 8000);
      return null;
    }
    if (!term.api || !(term.api.version >= 1) || !term.api.openTool) {
      new Notice(t("notice.oldTerminal"), 8000);
      return null;
    }
    return term;
  }

  vaultPath() {
    const a = this.app.vault.adapter;
    return a && a.getBasePath ? a.getBasePath() : "";
  }

  workDir() {
    const base = this.vaultPath();
    if (this.settings.folder !== "note") return base;
    const file = this.app.workspace.getActiveFile();
    const dir = file && file.parent && file.parent.path !== "/" ? file.parent.path : "";
    return dir ? require("path").join(base, dir) : base;
  }

  commandLine(resume) {
    const parts = [shQuote(this.settings.command || "claude")];
    if (resume) parts.push("--continue");
    if (this.settings.args) parts.push(this.settings.args);
    return parts.join(" ");
  }

  missing(st) {
    if (!st || st.commandSentMs < 0 || st.commandSentMs > 20000) return false;
    return MISSING_RE.test(lastLines(st.text, 6));
  }

  async watchMissing(term) {
    const sleep = (n) => new Promise((r) => window.setTimeout(r, n));
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      await sleep(400);
      if (!term.api.toolLeaf(TOOL_ID)) return;
      const st = term.api.toolText(TOOL_ID, 30);
      if (!st) return;
      if (this.missing(st)) return this.showInstall();
      if (st.commandSentMs > 1500 && st.idleMs > 1500) return;
    }
  }

  showInstall() {
    if (this.installOpen) return;
    this.installOpen = true;
    const m = new InstallModal(this.app, this.settings.command || "claude");
    const close = m.onClose.bind(m);
    m.onClose = () => {
      this.installOpen = false;
      close();
    };
    m.open();
  }

  mode() {
    return Platform.isDesktopApp ? this.settings.mode : "api";
  }

  apiKey() {
    const id = this.settings.apiKeySecret;
    const store = this.app.secretStorage;
    if (!id || !store) return "";
    try {
      return store.getSecret(id) || "";
    } catch (e) {
      return "";
    }
  }

  openSettings() {
    this.app.setting.open();
    this.app.setting.openTabById(this.manifest.id);
  }

  chatViews() {
    return this.app.workspace.getLeavesOfType(VIEW_CHAT).map((l) => l.view).filter((v) => v instanceof ChatView);
  }

  refreshChats() {
    for (const v of this.chatViews()) {
      v.refreshHead();
      v.renderEmpty();
    }
  }

  async openChat() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_CHAT)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_CHAT, active: true });
    }
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
    await ws.revealLeaf(leaf);
    return leaf.view instanceof ChatView ? leaf.view : null;
  }

  async open(opts) {
    opts = opts || {};
    if (this.mode() === "api") return this.openChat();
    const term = this.terminal();
    if (!term) return null;
    const existing = term.api.toolLeaf(TOOL_ID);
    if (existing && !opts.fresh) {
      const r = await term.api.openTool({ id: TOOL_ID });
      return r && r.leaf;
    }
    return this.launch(term, opts);
  }

  async launch(term, opts) {
    const old = term.api.toolLeaf(TOOL_ID);
    if (old && opts.fresh) old.detach();
    else if (old) {
      const r = await term.api.openTool({ id: TOOL_ID });
      return r && r.leaf;
    }
    const r = await term.api.openTool({
      id: TOOL_ID,
      title: t("title"),
      icon: "sparkles",
      cwd: this.workDir(),
      command: this.commandLine(false),
      resumeCommand: this.settings.resume ? this.commandLine(true) : "",
      place: this.settings.place,
    });
    if (r && r.leaf) this.watchMissing(term);
    return r && r.leaf;
  }

  selRange(editor) {
    const a = editor.getCursor("from");
    const b = editor.getCursor("to");
    const to = b.ch === 0 && b.line > a.line ? b.line : b.line + 1;
    return { from: a.line + 1, to };
  }

  reference(file, range) {
    const base = this.vaultPath();
    const cwd = this.workDir();
    const path = require("path");
    let rel = path.relative(cwd, path.join(base, file.path)).split(path.sep).join("/");
    if (!rel) rel = ".";
    let text = mention(file instanceof TFolder ? rel.replace(/\/?$/, "/") : rel);
    if (range) text += " (" + (range.to > range.from ? t("ref.lines", range) : t("ref.line", range)) + ")";
    return text + " ";
  }

  async ask(file, range) {
    if (!file) return new Notice(t("notice.noFile"));
    if (this.mode() === "api") {
      const view = await this.openChat();
      if (view) view.attach(file, range);
      return;
    }
    const term = this.terminal();
    if (!term) return;
    await this.saveOpenNotes();
    const ref = this.reference(file, range);
    const fresh = !term.api.toolLeaf(TOOL_ID);
    const leaf = await this.open();
    if (!leaf) return;
    const ready = await this.waitReady(term, fresh ? 15000 : 2500);
    if (ready === "missing") return this.showInstall();
    if (!ready) {
      try {
        await leaf.view.containerEl.win.navigator.clipboard.writeText(ref.trim());
      } catch (e) {
      }
      await term.api.openTool({ id: TOOL_ID });
      return new Notice(t("notice.busy"), 10000);
    }
    const ok = await term.api.sendToTool(TOOL_ID, ref, { enter: false, focus: true });
    if (!ok) new Notice(t("notice.sendFailed"));
  }
};
