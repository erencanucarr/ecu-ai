const { Plugin, PluginSettingTab, Setting, Notice, Modal, MarkdownView, TFile, TFolder, Platform, setIcon } = require("obsidian");
const obsidian = require("obsidian");

const STRINGS = {
  en: {
    "title": "Claude Code",
    "cmd.open": "Open Claude Code",
    "cmd.new": "Start a new Claude Code session",
    "cmd.askNote": "Ask Claude about this note",
    "cmd.askSelection": "Ask Claude about the selection",
    "menu.askNote": "Ask Claude about this note",
    "menu.askSelection": "Ask Claude about the selection",
    "menu.askFile": "Ask Claude about this file",
    "menu.askFolder": "Ask Claude about this folder",
    "ref.lines": "lines {from}-{to}",
    "ref.line": "line {from}",
    "notice.needsTerminal": "ecu-claude needs the ecu-terminal plugin (2.4 or newer). Install and enable it, then try again.",
    "notice.oldTerminal": "ecu-claude needs ecu-terminal 2.4 or newer. Update ecu-terminal and reload Obsidian.",
    "notice.sendFailed": "Couldn't reach the Claude Code pane.",
    "notice.noFile": "Open a note first.",
    "notice.busy": "Claude is waiting for an answer in its pane, so nothing was typed. The reference is on the clipboard; paste it when Claude is ready.",
    "cmd.prepare": "Prepare this vault for Claude Code",
    "prepare.done": "Created {files}.",
    "prepare.skipped": "Already there, left as is: {files}.",
    "prepare.failed": "Couldn't write {file}: {error}",
    "set.prepare": "Prepare the vault",
    "set.prepareDesc": "Adds a CLAUDE.md with the vault's conventions (wikilinks, frontmatter, code blocks) and a rule that stops Claude from editing .obsidian. Existing files are never overwritten.",
    "set.prepareBtn": "Prepare",
    "install.title": "Claude Code isn't installed",
    "install.text": "ecu-claude starts the `{cmd}` command in a terminal, but it wasn't found on this computer. Install Claude Code, sign in once by running `claude` in a terminal, then click Open again.",
    "install.mac": "macOS, Linux, WSL",
    "install.win": "Windows (PowerShell)",
    "install.npm": "With npm",
    "install.docs": "Installation guide",
    "install.anyway": "Open anyway",
    "install.copy": "Copy",
    "install.copied": "Copied",
    "set.lang": "Language",
    "set.langDesc": "Language of the commands and settings.",
    "set.langAuto": "Same as the app",
    "set.command": "Claude command",
    "set.commandDesc": "The command that starts Claude Code. Use a full path if it isn't on your PATH.",
    "set.args": "Extra arguments",
    "set.argsDesc": "Added after the command, for example --model sonnet.",
    "set.place": "Open in",
    "set.placeDesc": "Where the Claude Code pane opens.",
    "set.placeRight": "A split on the right",
    "set.placeBottom": "A split below",
    "set.placeTab": "A new tab",
    "set.folder": "Working folder",
    "set.folderDesc": "The folder Claude Code starts in. Claude can read and edit files inside it.",
    "set.folderVault": "The vault",
    "set.folderNote": "The current note's folder",
    "set.resume": "Continue the last conversation",
    "set.resumeDesc": "After Obsidian restarts, reopen the pane with claude --continue instead of a fresh session.",
    "set.ribbon": "Ribbon icon",
    "set.ribbonDesc": "Show a button in the left ribbon that opens Claude Code.",
    "set.check": "Check installation",
    "set.checkDesc": "Look for the Claude command on this computer.",
    "set.checkBtn": "Check",
    "set.found": "Found: {path}",
    "set.notFound": "Not found. See the installation guide.",
  },
  tr: {
    "title": "Claude Code",
    "cmd.open": "Claude Code'u aç",
    "cmd.new": "Yeni Claude Code oturumu başlat",
    "cmd.askNote": "Bu notu Claude'a sor",
    "cmd.askSelection": "Seçimi Claude'a sor",
    "menu.askNote": "Bu notu Claude'a sor",
    "menu.askSelection": "Seçimi Claude'a sor",
    "menu.askFile": "Bu dosyayı Claude'a sor",
    "menu.askFolder": "Bu klasörü Claude'a sor",
    "ref.lines": "{from}-{to}. satırlar",
    "ref.line": "{from}. satır",
    "notice.needsTerminal": "ecu-claude için ecu-terminal eklentisi (2.4 ya da üstü) gerekiyor. Kurup etkinleştirdikten sonra tekrar dene.",
    "notice.oldTerminal": "ecu-claude için ecu-terminal 2.4 ya da üstü gerekiyor. ecu-terminal'i güncelleyip Obsidian'ı yeniden yükle.",
    "notice.sendFailed": "Claude Code bölmesine ulaşılamadı.",
    "notice.noFile": "Önce bir not aç.",
    "notice.busy": "Claude bölmesinde bir soruya cevap bekliyor, o yüzden bir şey yazılmadı. Referans panoya kopyalandı; Claude hazır olunca yapıştır.",
    "cmd.prepare": "Bu kasayı Claude Code'a hazırla",
    "prepare.done": "Oluşturuldu: {files}.",
    "prepare.skipped": "Zaten var, dokunulmadı: {files}.",
    "prepare.failed": "{file} yazılamadı: {error}",
    "set.prepare": "Kasayı hazırla",
    "set.prepareDesc": "Kasanın kurallarını (wikilink, frontmatter, kod blokları) anlatan bir CLAUDE.md ve Claude'un .obsidian'ı düzenlemesini engelleyen bir kural ekler. Var olan dosyaların üzerine asla yazmaz.",
    "set.prepareBtn": "Hazırla",
    "install.title": "Claude Code kurulu değil",
    "install.text": "ecu-claude terminalde `{cmd}` komutunu başlatıyor ama bu bilgisayarda bulunamadı. Claude Code'u kur, bir terminalde `claude` çalıştırıp bir kez giriş yap, sonra Aç'a tekrar tıkla.",
    "install.mac": "macOS, Linux, WSL",
    "install.win": "Windows (PowerShell)",
    "install.npm": "npm ile",
    "install.docs": "Kurulum rehberi",
    "install.anyway": "Yine de aç",
    "install.copy": "Kopyala",
    "install.copied": "Kopyalandı",
    "set.lang": "Dil",
    "set.langDesc": "Komutların ve ayarların dili.",
    "set.langAuto": "Uygulamayla aynı",
    "set.command": "Claude komutu",
    "set.commandDesc": "Claude Code'u başlatan komut. PATH'te değilse tam yolunu yaz.",
    "set.args": "Ek argümanlar",
    "set.argsDesc": "Komutun sonuna eklenir, örneğin --model sonnet.",
    "set.place": "Açılacağı yer",
    "set.placeDesc": "Claude Code bölmesinin açılacağı yer.",
    "set.placeRight": "Sağda bölünmüş pencere",
    "set.placeBottom": "Altta bölünmüş pencere",
    "set.placeTab": "Yeni sekme",
    "set.folder": "Çalışma klasörü",
    "set.folderDesc": "Claude Code'un başlayacağı klasör. Claude bu klasördeki dosyaları okuyup düzenleyebilir.",
    "set.folderVault": "Kasa",
    "set.folderNote": "Açık notun klasörü",
    "set.resume": "Son konuşmaya devam et",
    "set.resumeDesc": "Obsidian yeniden açılınca bölmeyi yeni oturum yerine claude --continue ile aç.",
    "set.ribbon": "Şerit simgesi",
    "set.ribbonDesc": "Sol şeritte Claude Code'u açan bir düğme göster.",
    "set.check": "Kurulumu kontrol et",
    "set.checkDesc": "Bu bilgisayarda Claude komutunu ara.",
    "set.checkBtn": "Kontrol et",
    "set.found": "Bulundu: {path}",
    "set.notFound": "Bulunamadı. Kurulum rehberine bak.",
  },
};

let uiLang = "en";
function t(key, vars) {
  const s = (STRINGS[uiLang] && STRINGS[uiLang][key]) || STRINGS.en[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s;
}
function resolveUiLang(pref) {
  if (pref === "en" || pref === "tr") return pref;
  let code = "";
  try {
    code = typeof obsidian.getLanguage === "function" ? obsidian.getLanguage() : obsidian.moment.locale();
  } catch (e) {
    code = "";
  }
  return /^tr/i.test(code) ? "tr" : "en";
}

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
const DIALOG_RE = /(Choose the text style|Do you trust|trust the files|Select login method|login method|Press Enter to continue|Do you want to (proceed|make this edit|create|allow|run)|Yes, proceed|Esc to cancel|❯\s*(\d+\.|✔))/i;

const DEFAULTS = { uiLang: "auto", command: "claude", args: "", place: "right", folder: "vault", resume: true, ribbon: true };

function shQuote(s) {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  if (Platform.isWin) return '"' + s.replace(/"/g, '\\"') + '"';
  return "'" + s.replace(/'/g, "'\\''") + "'";
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
            p.settings.uiLang = v;
            uiLang = resolveUiLang(v);
            await p.saveSettings();
            this.display();
          })
      );
    new Setting(el)
      .setName(t("set.command"))
      .setDesc(t("set.commandDesc"))
      .addText((x) =>
        x
          .setPlaceholder("claude")
          .setValue(p.settings.command)
          .onChange(async (v) => {
            p.settings.command = v.trim() || "claude";
            p.found = null;
            await p.saveSettings();
          })
      );
    new Setting(el)
      .setName(t("set.args"))
      .setDesc(t("set.argsDesc"))
      .addText((x) =>
        x.setValue(p.settings.args).onChange(async (v) => {
          p.settings.args = v.trim();
          await p.saveSettings();
        })
      );
    new Setting(el)
      .setName(t("set.place"))
      .setDesc(t("set.placeDesc"))
      .addDropdown((d) =>
        d
          .addOption("right", t("set.placeRight"))
          .addOption("bottom", t("set.placeBottom"))
          .addOption("tab", t("set.placeTab"))
          .setValue(p.settings.place)
          .onChange(async (v) => {
            p.settings.place = v;
            await p.saveSettings();
          })
      );
    new Setting(el)
      .setName(t("set.folder"))
      .setDesc(t("set.folderDesc"))
      .addDropdown((d) =>
        d
          .addOption("vault", t("set.folderVault"))
          .addOption("note", t("set.folderNote"))
          .setValue(p.settings.folder)
          .onChange(async (v) => {
            p.settings.folder = v;
            await p.saveSettings();
          })
      );
    new Setting(el)
      .setName(t("set.resume"))
      .setDesc(t("set.resumeDesc"))
      .addToggle((x) =>
        x.setValue(p.settings.resume).onChange(async (v) => {
          p.settings.resume = v;
          await p.saveSettings();
        })
      );
    new Setting(el)
      .setName(t("set.ribbon"))
      .setDesc(t("set.ribbonDesc"))
      .addToggle((x) =>
        x.setValue(p.settings.ribbon).onChange(async (v) => {
          p.settings.ribbon = v;
          await p.saveSettings();
          p.syncRibbon();
        })
      );
    new Setting(el)
      .setName(t("set.prepare"))
      .setDesc(t("set.prepareDesc"))
      .addButton((b) => b.setButtonText(t("set.prepareBtn")).onClick(() => p.prepareVault()));
    const check = new Setting(el).setName(t("set.check")).setDesc(t("set.checkDesc"));
    check.addButton((b) =>
      b.setButtonText(t("set.checkBtn")).onClick(async () => {
        b.setDisabled(true);
        p.found = null;
        const where = await p.findClaude();
        check.setDesc(where ? t("set.found", { path: where }) : t("set.notFound"));
        b.setDisabled(false);
      })
    );
  }
}

module.exports = class EcuClaude extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    uiLang = resolveUiLang(this.settings.uiLang);
    this.found = null;
    this.ribbonEl = null;
    this.syncRibbon();

    this.addCommand({ id: "open", name: t("cmd.open"), callback: () => this.open() });
    this.addCommand({ id: "new-session", name: t("cmd.new"), callback: () => this.open({ fresh: true }) });
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
      if (st && st.running && st.commandSentMs > 1500 && st.idleMs > 600) {
        const tail = st.text.split("\n").slice(-25).join("\n");
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

  findClaude() {
    if (this.found !== null) return Promise.resolve(this.found);
    const cmd = this.settings.command || "claude";
    const cp = require("child_process");
    return new Promise((resolve) => {
      const done = (out) => {
        const line = String(out || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop();
        this.found = line && !/not found|no such|could not find/i.test(line) ? line : "";
        resolve(this.found);
      };
      try {
        if (Platform.isWin) {
          cp.execFile("where.exe", [cmd], { timeout: 8000, windowsHide: true }, (err, out) => done(err ? "" : out));
          return;
        }
        if (cmd.includes("/")) {
          require("fs").access(cmd, require("fs").constants.X_OK, (err) => done(err ? "" : cmd));
          return;
        }
        const term = this.app.plugins.plugins["ecu-terminal"];
        const shell = (term && term.settings && term.settings.shellPath) || process.env.SHELL || (Platform.isMacOS ? "/bin/zsh" : "/bin/bash");
        cp.execFile(shell, ["-ilc", "command -v " + shQuote(cmd)], { timeout: 8000, env: process.env }, (err, out) => done(err ? "" : out));
      } catch (e) {
        done("");
      }
    });
  }

  async open(opts) {
    opts = opts || {};
    const term = this.terminal();
    if (!term) return null;
    const existing = term.api.toolLeaf(TOOL_ID);
    if (existing && !opts.fresh) {
      const r = await term.api.openTool({ id: TOOL_ID });
      return r && r.leaf;
    }
    const where = await this.findClaude();
    if (!where) {
      return new Promise((resolve) => new InstallModal(this.app, this.settings.command || "claude", () => resolve(this.launch(term, opts))).open());
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
    const term = this.terminal();
    if (!term) return;
    await this.saveOpenNotes();
    const ref = this.reference(file, range);
    const fresh = !term.api.toolLeaf(TOOL_ID);
    const leaf = await this.open();
    if (!leaf) return;
    const ready = await this.waitReady(term, fresh ? 15000 : 2500);
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
