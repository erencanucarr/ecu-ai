const { Plugin, PluginSettingTab, Setting, SecretComponent, Notice, Modal, SuggestModal, Menu, MarkdownView, TFile, TFolder, Platform, setIcon } = require("obsidian");

const { t, setUiLang } = require("./i18n");
const { ChatView, VIEW_CHAT, MODELS } = require("./chat");
const { AgentView, VIEW_AGENT } = require("./agent-view");
const engine = require("./engine");
const { AGENTS, agentList, findAgent, customId } = require("./agents");

const AGENTS_MD = [
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
const IMPORT_MD = "@AGENTS.md\n";
const CLAUDE_SETTINGS = JSON.stringify({ permissions: { deny: ["Edit(/.obsidian/**)"] } }, null, 2) + "\n";
const KEYS_URL = "https://platform.claude.com/settings/keys";
const MAX_PROJECTS = 20;

const DEFAULTS = {
  uiLang: "auto",
  ribbon: true,
  ribbonAction: "agent",
  defaultAgent: "claude",
  agents: {},
  customAgents: [],
  place: "sidebar",
  folder: "vault",
  resume: true,
  fontSize: 13,
  fontFamily: "",
  shell: "",
  winShell: "cmd",
  projects: [],
  yoloOk: false,
  apiKeySecret: "",
  model: "claude-opus-5-5",
  effort: "medium",
  confirm: true,
};

const node = (m) => window.require(m);

function hotkeyMatches(h, e) {
  const key = h && (h.key || "");
  if (!key || !e || !e.key) return false;
  const want = new Set((h.modifiers || []).map((m) => (m === "Mod" ? (Platform.isMacOS ? "Meta" : "Ctrl") : m)));
  const have = new Set();
  if (e.ctrlKey) have.add("Ctrl");
  if (e.metaKey) have.add("Meta");
  if (e.altKey) have.add("Alt");
  if (e.shiftKey) have.add("Shift");
  if (want.size !== have.size || [...want].some((m) => !have.has(m))) return false;
  return key.toLowerCase() === e.key.toLowerCase();
}

class ConfirmModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    this.answer = false;
    this.dontAsk = false;
  }
  onOpen() {
    const o = this.opts;
    this.titleEl.setText(o.title);
    this.contentEl.createEl("p", { text: o.text });
    if (o.dontAsk) {
      new Setting(this.contentEl).setName(t("yolo.dontAsk")).addToggle((x) => x.onChange((v) => (this.dontAsk = v)));
    }
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("common.cancel") }).addEventListener("click", () => this.close());
    row.createEl("button", { cls: "mod-warning", text: o.ok }).addEventListener("click", () => {
      this.answer = true;
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
    if (this.resolve) this.resolve({ ok: this.answer, dontAsk: this.dontAsk });
  }
  ask() {
    return new Promise((r) => {
      this.resolve = r;
      this.open();
    });
  }
}

class AgentPicker extends SuggestModal {
  constructor(app, plugin, agents, onPick) {
    super(app);
    this.plugin = plugin;
    this.agents = agents;
    this.onPick = onPick;
    this.setPlaceholder(t("pick.agent"));
  }
  getSuggestions(q) {
    const s = q.toLowerCase();
    return this.agents.filter((a) => !s || a.name.toLowerCase().includes(s) || a.command.toLowerCase().includes(s));
  }
  renderSuggestion(a, el) {
    el.addClass("eai-suggest");
    const icon = el.createSpan({ cls: "eai-suggest-icon" });
    setIcon(icon, a.icon || "bot");
    const body = el.createDiv();
    body.createDiv({ text: a.name + (a.id === this.plugin.settings.defaultAgent ? "  ·  " + t("pick.default") : "") });
    body.createDiv({ cls: "eai-suggest-note", text: a.command + (a.args ? " " + a.args : "") + (a.installed === false ? "  ·  " + t("pick.notFound") : "") });
  }
  onChooseSuggestion(a) {
    this.onPick(a);
  }
}

const BROWSE = { browse: true };

class ProjectPicker extends SuggestModal {
  constructor(app, plugin, onPick) {
    super(app);
    this.plugin = plugin;
    this.onPick = onPick;
    this.setPlaceholder(t("pick.project"));
  }
  getSuggestions(q) {
    const s = q.toLowerCase();
    const list = this.plugin.settings.projects.filter((p) => !s || p.toLowerCase().includes(s));
    return [...list, BROWSE];
  }
  renderSuggestion(p, el) {
    el.addClass("eai-suggest");
    const icon = el.createSpan({ cls: "eai-suggest-icon" });
    if (p.browse) {
      setIcon(icon, "folder-search");
      el.createDiv({ text: t("pick.browse") });
      return;
    }
    setIcon(icon, "folder");
    const body = el.createDiv();
    body.createDiv({ text: node("path").basename(p) || p });
    body.createDiv({ cls: "eai-suggest-note", text: p });
  }
  async onChooseSuggestion(p) {
    if (!p.browse) return this.onPick(p);
    let dir = "";
    try {
      const { remote } = node("electron");
      const r = await remote.dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: t("pick.browseTitle") });
      dir = r && !r.canceled && r.filePaths && r.filePaths[0];
    } catch (e) {
      new Notice(t("notice.noDialog"));
      return;
    }
    if (!dir) return;
    await this.plugin.rememberProject(dir);
    this.onPick(dir);
  }
}

class AiSettings extends PluginSettingTab {
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
    if (Platform.isDesktopApp) {
      new Setting(el)
        .setName(t("set.ribbonAction"))
        .setDesc(t("set.ribbonActionDesc"))
        .addDropdown((d) =>
          d
            .addOption("agent", t("set.ribbonAgent"))
            .addOption("chat", t("set.ribbonChat"))
            .setValue(p.settings.ribbonAction)
            .onChange((v) => save("ribbonAction", v))
        );
      this.agentSection(el, save);
      this.terminalSection(el, save);
      this.projectSection(el);
    }
    this.chatSection(el, save);
    if (Platform.isDesktopApp) this.vaultSection(el);
  }

  agentSection(el, save) {
    const p = this.plugin;
    new Setting(el).setName(t("set.agentsHeading")).setHeading();
    new Setting(el)
      .setName(t("set.defaultAgent"))
      .setDesc(t("set.defaultAgentDesc"))
      .addDropdown((d) => {
        for (const a of agentList(p.settings)) d.addOption(a.id, a.name);
        d.setValue(p.settings.defaultAgent).onChange(async (v) => {
          await save("defaultAgent", v);
          p.refreshAgents();
        });
      });
    const found = p.installed;
    for (const a of AGENTS) {
      const o = p.settings.agents[a.id] || {};
      const st = found ? (found.has(a.id) ? t("set.agentFound") : t("set.agentMissing")) : "";
      const row = new Setting(el).setName(a.name).setDesc(st);
      row.settingEl.addClass("eai-agent-row");
      row.addText((x) =>
        x
          .setPlaceholder(a.command)
          .setValue(o.command || "")
          .onChange(async (v) => {
            p.settings.agents[a.id] = Object.assign({}, p.settings.agents[a.id], { command: v.trim() });
            await p.saveSettings();
            p.installed = null;
          })
      );
      row.addText((x) =>
        x
          .setPlaceholder(t("set.argsPlaceholder"))
          .setValue(o.args || "")
          .onChange(async (v) => {
            p.settings.agents[a.id] = Object.assign({}, p.settings.agents[a.id], { args: v.trim() });
            await p.saveSettings();
          })
      );
    }
    new Setting(el)
      .setName(t("set.detect"))
      .setDesc(t("set.detectDesc"))
      .addButton((b) =>
        b.setButtonText(t("set.detectBtn")).onClick(async () => {
          b.setDisabled(true);
          p.installed = null;
          await p.detectInstalled();
          this.display();
        })
      );

    new Setting(el).setName(t("set.customHeading")).setDesc(t("set.customDesc")).setHeading();
    p.settings.customAgents.forEach((c, i) => {
      const row = new Setting(el);
      row.settingEl.addClass("eai-agent-row");
      row.addText((x) =>
        x
          .setPlaceholder(t("set.customName"))
          .setValue(c.name || "")
          .onChange(async (v) => {
            c.name = v.trim();
            await p.saveSettings();
          })
      );
      row.addText((x) =>
        x
          .setPlaceholder(t("set.customCommand"))
          .setValue(c.command || "")
          .onChange(async (v) => {
            c.command = v.trim();
            await p.saveSettings();
          })
      );
      row.addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("common.remove"))
          .onClick(async () => {
            p.settings.customAgents.splice(i, 1);
            if (p.settings.defaultAgent === c.id) p.settings.defaultAgent = "claude";
            await p.saveSettings();
            this.display();
          })
      );
    });
    new Setting(el).addButton((b) =>
      b.setButtonText(t("set.customAdd")).onClick(async () => {
        let n = p.settings.customAgents.length + 1;
        while (p.settings.customAgents.some((c) => c.id === customId("cli-" + n))) n++;
        p.settings.customAgents.push({ id: customId("cli-" + n), name: "", command: "" });
        await p.saveSettings();
        this.display();
      })
    );
  }

  terminalSection(el, save) {
    const p = this.plugin;
    new Setting(el).setName(t("set.terminalHeading")).setHeading();
    new Setting(el)
      .setName(t("set.place"))
      .setDesc(t("set.placeDesc"))
      .addDropdown((d) =>
        d
          .addOption("sidebar", t("set.placeSidebar"))
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
    new Setting(el).setName(t("set.fontSize")).addSlider((x) =>
      x
        .setLimits(9, 22, 1)
        .setValue(Number(p.settings.fontSize) || 13)
        .setDynamicTooltip()
        .onChange(async (v) => {
          await save("fontSize", v);
          p.applyTheme();
        })
    );
    new Setting(el)
      .setName(t("set.fontFamily"))
      .setDesc(t("set.fontFamilyDesc"))
      .addText((x) =>
        x.setValue(p.settings.fontFamily).onChange(async (v) => {
          await save("fontFamily", v.trim());
          p.applyTheme();
        })
      );
    if (Platform.isWin) {
      new Setting(el)
        .setName(t("set.winShell"))
        .setDesc(t("set.winShellDesc"))
        .addDropdown((d) =>
          d
            .addOption("cmd", "cmd.exe")
            .addOption("wsl", "WSL (wsl.exe)")
            .setValue(p.settings.winShell)
            .onChange(async (v) => {
              await save("winShell", v);
              p.installed = null;
            })
        );
    } else {
      new Setting(el)
        .setName(t("set.shell"))
        .setDesc(t("set.shellDesc", { shell: process.env.SHELL || "/bin/zsh" }))
        .addText((x) =>
          x
            .setPlaceholder(process.env.SHELL || "")
            .setValue(p.settings.shell)
            .onChange(async (v) => {
              await save("shell", v.trim());
              p.installed = null;
            })
        );
    }
    new Setting(el)
      .setName(t("set.yoloAsk"))
      .setDesc(t("set.yoloAskDesc"))
      .addToggle((x) => x.setValue(!p.settings.yoloOk).onChange((v) => save("yoloOk", !v)));
    new Setting(el)
      .setName(t("set.engine"))
      .setDesc(engine.ready(p.pluginDir()) ? t("set.engineReady", { version: engine.PTY_VERSION }) : t("set.engineMissing"))
      .addButton((b) =>
        b.setButtonText(t("set.engineBtn")).onClick(async () => {
          b.setDisabled(true);
          try {
            await engine.install(p.pluginDir());
            p.engineInstalled();
          } catch (e) {
            new Notice(t("engine.failed", { error: e && e.message ? e.message : e }));
          }
          this.display();
        })
      );
  }

  projectSection(el) {
    const p = this.plugin;
    new Setting(el).setName(t("set.projectsHeading")).setDesc(t("set.projectsDesc")).setHeading();
    for (const dir of p.settings.projects) {
      new Setting(el)
        .setName(node("path").basename(dir) || dir)
        .setDesc(dir)
        .addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip(t("common.remove"))
            .onClick(async () => {
              p.settings.projects = p.settings.projects.filter((x) => x !== dir);
              await p.saveSettings();
              this.display();
            })
        );
    }
    new Setting(el).addButton((b) => b.setButtonText(t("set.projectOpen")).onClick(() => p.openProject()));
  }

  chatSection(el, save) {
    const p = this.plugin;
    new Setting(el).setName(t("set.chatHeading")).setDesc(t("set.chatDesc")).setHeading();
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

  vaultSection(el) {
    const p = this.plugin;
    new Setting(el).setName(t("set.vaultHeading")).setHeading();
    new Setting(el)
      .setName(t("set.prepare"))
      .setDesc(t("set.prepareDesc"))
      .addButton((b) => b.setButtonText(t("set.prepareBtn")).onClick(() => p.prepareVault()));
  }
}

module.exports = class EcuAi extends Plugin {
  async onload() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULTS, data);
    this.settings.agents = Object.assign({}, data.agents);
    this.settings.customAgents = Array.isArray(data.customAgents) ? data.customAgents : [];
    this.settings.projects = Array.isArray(data.projects) ? data.projects : [];
    setUiLang(this.settings.uiLang);
    this.ribbonEl = null;
    this.installed = null;
    this.lastAgent = null;
    this.lastNoteLeaf = null;

    this.registerView(VIEW_CHAT, (leaf) => new ChatView(leaf, this));
    if (Platform.isDesktopApp) this.registerView(VIEW_AGENT, (leaf) => new AgentView(leaf, this));
    this.syncRibbon();
    this.addSettingTab(new AiSettings(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) return;
        if (leaf.view instanceof MarkdownView) this.lastNoteLeaf = leaf;
        else if (Platform.isDesktopApp && leaf.view instanceof AgentView) this.lastAgent = leaf.view;
      })
    );
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyTheme()));

    this.chatCommands();
    if (Platform.isDesktopApp) {
      this.agentCommands();
      this.menus();
      this.app.workspace.onLayoutReady(() => window.setTimeout(() => this.detectInstalled(), 3000));
    }
  }

  onunload() {
    if (this.ribbonEl) this.ribbonEl.detach();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---- paths ----

  vaultPath() {
    const a = this.app.vault.adapter;
    return a && a.getBasePath ? a.getBasePath() : "";
  }

  pluginDir() {
    return node("path").join(this.vaultPath(), this.manifest.dir || ".obsidian/plugins/ecu-ai");
  }

  workDir() {
    const base = this.vaultPath();
    if (this.settings.folder !== "note") return base;
    const file = this.app.workspace.getActiveFile();
    const dir = file && file.parent && file.parent.path !== "/" ? file.parent.path : "";
    return dir ? node("path").join(base, dir) : base;
  }

  folderPath(folder) {
    return !folder || folder.path === "/" ? this.vaultPath() : node("path").join(this.vaultPath(), folder.path);
  }

  // ---- ribbon ----

  syncRibbon() {
    if (this.settings.ribbon && !this.ribbonEl) {
      this.ribbonEl = this.addRibbonIcon("bot", t("ribbon.tip"), () => this.ribbonClick());
      this.registerDomEvent(this.ribbonEl, "contextmenu", (e) => {
        e.preventDefault();
        this.ribbonMenu(e);
      });
    } else if (!this.settings.ribbon && this.ribbonEl) {
      this.ribbonEl.detach();
      this.ribbonEl = null;
    }
  }

  ribbonClick() {
    if (!Platform.isDesktopApp || this.settings.ribbonAction === "chat") return this.openChat();
    return this.openAgent();
  }

  ribbonMenu(e) {
    const m = new Menu();
    if (Platform.isDesktopApp) {
      const def = this.defaultAgent();
      m.addItem((i) => i.setTitle(t("cmd.newTab")).setIcon("plus").onClick(() => this.newTab({})));
      if (def && def.yolo) m.addItem((i) => i.setTitle(t("cmd.newYolo")).setIcon("zap").onClick(() => this.newTab({ yolo: true })));
      if (def && def.resume) m.addItem((i) => i.setTitle(t("cmd.resume")).setIcon("history").onClick(() => this.newTab({ resume: true })));
      m.addItem((i) => i.setTitle(t("cmd.otherAgent")).setIcon("list").onClick(() => this.pickAgent((a) => this.newTab({ agent: a.id }))));
      m.addItem((i) => i.setTitle(t("cmd.project")).setIcon("folder-open").onClick(() => this.openProject()));
      m.addSeparator();
    }
    m.addItem((i) => i.setTitle(t("cmd.chat")).setIcon("message-square").onClick(() => this.openChat()));
    m.showAtMouseEvent(e);
  }

  // ---- commands and menus ----

  chatCommands() {
    this.addCommand({ id: "open-chat", name: t("cmd.chat"), callback: () => this.openChat() });
    this.addCommand({
      id: "new-chat",
      name: t("cmd.newChat"),
      callback: async () => {
        const v = await this.openChat();
        if (v) v.reset();
      },
    });
    this.addCommand({
      id: "chat-note",
      name: t("cmd.chatNote"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.askChat(file);
        return true;
      },
    });
    this.addCommand({
      id: "chat-selection",
      name: t("cmd.chatSelection"),
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !editor.somethingSelected()) return false;
        if (!checking) this.askChat(view.file, this.selRange(editor));
        return true;
      },
    });
  }

  agentCommands() {
    const cmd = (id, name, callback) => this.addCommand({ id, name, callback });
    cmd("open", t("cmd.open"), () => this.openAgent());
    cmd("new-tab", t("cmd.newTab"), () => this.newTab({}));
    cmd("new-tab-other", t("cmd.otherAgent"), () => this.pickAgent((a) => this.newTab({ agent: a.id })));
    cmd("new-tab-yolo", t("cmd.newYolo"), () => this.newTab({ yolo: true }));
    cmd("resume", t("cmd.resume"), () => this.newTab({ resume: true }));
    cmd("open-project", t("cmd.project"), () => this.openProject());
    cmd("switch-default", t("cmd.switch"), () =>
      this.pickAgent(async (a) => {
        this.settings.defaultAgent = a.id;
        await this.saveSettings();
        new Notice(t("notice.defaultSet", { name: a.name }));
      })
    );
    cmd("toggle-focus", t("cmd.toggleFocus"), () => this.toggleFocus());
    this.addCommand({
      id: "close-tab",
      name: t("cmd.closeTab"),
      checkCallback: (checking) => {
        const v = this.currentAgent();
        if (!v) return false;
        if (!checking) v.leaf.detach();
        return true;
      },
    });
    this.addCommand({
      id: "run-here",
      name: t("cmd.runHere"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.newTab({ cwd: this.folderPath(file.parent) });
        return true;
      },
    });
    this.addCommand({
      id: "send-file",
      name: t("cmd.sendFile"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.sendRef(file);
        return true;
      },
    });
    this.addCommand({
      id: "send-selection",
      name: t("cmd.sendSelection"),
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !editor.somethingSelected()) return false;
        if (!checking) this.sendRef(view.file, this.selRange(editor));
        return true;
      },
    });
    cmd("prepare-vault", t("cmd.prepare"), () => this.prepareVault());
  }

  menus() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          const cwd = this.folderPath(file);
          menu.addItem((i) => i.setTitle(t("menu.openHere")).setIcon("bot").setSection("open").onClick(() => this.newTab({ cwd })));
          const def = this.defaultAgent();
          if (def && def.yolo) menu.addItem((i) => i.setTitle(t("menu.openHereYolo")).setIcon("zap").setSection("open").onClick(() => this.newTab({ cwd, yolo: true })));
          menu.addItem((i) => i.setTitle(t("menu.sendFolder")).setIcon("at-sign").setSection("open").onClick(() => this.sendRef(file)));
        } else if (file instanceof TFile) {
          menu.addItem((i) => i.setTitle(t("menu.sendFile")).setIcon("at-sign").setSection("open").onClick(() => this.sendRef(file)));
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const file = info && info.file;
        if (!file) return;
        const sel = editor.somethingSelected();
        const range = sel ? this.selRange(editor) : null;
        menu.addItem((i) =>
          i
            .setTitle(sel ? t("menu.sendSelection") : t("menu.sendNote"))
            .setIcon("bot")
            .setSection("ecu-ai")
            .onClick(() => this.sendRef(file, range))
        );
        menu.addItem((i) =>
          i
            .setTitle(sel ? t("menu.chatSelection") : t("menu.chatNote"))
            .setIcon("message-square")
            .setSection("ecu-ai")
            .onClick(() => this.askChat(file, range))
        );
      })
    );
  }

  // ---- agents ----

  agents() {
    const list = agentList(this.settings);
    const def = this.settings.defaultAgent;
    list.sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : 0));
    if (this.installed) for (const a of list) if (a.builtin) a.installed = this.installed.has(a.id);
    return list;
  }

  defaultAgent() {
    return findAgent(this.settings, this.settings.defaultAgent) || findAgent(this.settings, "claude");
  }

  // Finds which agent commands exist, through the same login shell the agents run in.
  async detectInstalled() {
    if (this.installed) return this.installed;
    if (this.detecting) return this.detecting;
    this.detecting = (async () => {
      const list = agentList(this.settings).filter((a) => a.builtin);
      const cp = node("child_process");
      const found = new Set();
      const first = (c) => String(c).trim().split(/\s+/)[0];
      try {
        if (Platform.isWin && this.settings.winShell !== "wsl") {
          await Promise.all(
            list.map(
              (a) =>
                new Promise((r) =>
                  cp.execFile("where.exe", [first(a.command)], { timeout: 8000, windowsHide: true }, (err) => {
                    if (!err) found.add(a.id);
                    r();
                  })
                )
            )
          );
        } else {
          const script = list.map((a, i) => `command -v ${JSON.stringify(first(a.command))} >/dev/null 2>&1 && echo ${i}`).join("; ");
          const out = await new Promise((r) => {
            const done = (err, stdout) => r(String(stdout || ""));
            if (Platform.isWin) cp.execFile("wsl.exe", ["-e", "bash", "-lic", script], { timeout: 15000, windowsHide: true }, done);
            else {
              const shell = (this.settings.shell || "").trim() || process.env.SHELL || (Platform.isMacOS ? "/bin/zsh" : "/bin/bash");
              const name = shell.split("/").pop();
              const args = name === "zsh" || name === "bash" || name === "fish" ? ["-l", "-i", "-c", script] : ["-c", script];
              const env = Object.assign({}, process.env);
              delete env.ELECTRON_RUN_AS_NODE;
              cp.execFile(shell, args, { timeout: 15000, env }, done);
            }
          });
          for (const m of out.match(/^\d+$/gm) || []) if (list[Number(m)]) found.add(list[Number(m)].id);
        }
        this.installed = found;
      } catch (e) {
        this.installed = null;
      }
      this.detecting = null;
      return this.installed;
    })();
    return this.detecting;
  }

  async pickAgent(onPick) {
    await this.detectInstalled();
    new AgentPicker(this.app, this, this.agents(), onPick).open();
  }

  agentViews() {
    if (!Platform.isDesktopApp) return [];
    return this.app.workspace
      .getLeavesOfType(VIEW_AGENT)
      .map((l) => l.view)
      .filter((v) => v instanceof AgentView);
  }

  currentAgent() {
    const active = this.app.workspace.getActiveViewOfType(AgentView);
    if (active) return active;
    const views = this.agentViews();
    if (this.lastAgent && views.includes(this.lastAgent)) return this.lastAgent;
    return views[0] || null;
  }

  noteAgentFocus(view) {
    this.lastAgent = view;
  }

  forgetAgent(view) {
    if (this.lastAgent === view) this.lastAgent = null;
  }

  newLeaf() {
    const ws = this.app.workspace;
    const place = this.settings.place;
    const views = this.agentViews();
    const near = (this.lastAgent && views.includes(this.lastAgent) ? this.lastAgent : views[0]) || null;
    // Keep agent tabs together: a new one opens next to the last one.
    if (near && near.leaf.parent && typeof ws.createLeafInParent === "function") {
      const parent = near.leaf.parent;
      const idx = parent.children ? parent.children.indexOf(near.leaf) + 1 : 0;
      try {
        return ws.createLeafInParent(parent, idx);
      } catch (e) {
      }
    }
    if (place === "tab") return ws.getLeaf("tab");
    if (place === "right") return ws.getLeaf("split", "vertical");
    if (place === "bottom") return ws.getLeaf("split", "horizontal");
    return ws.getRightLeaf(false) || ws.getLeaf("tab");
  }

  async confirmYolo(agent) {
    if (this.settings.yoloOk) return true;
    const r = await new ConfirmModal(this.app, { title: t("yolo.title"), text: t("yolo.text", { name: agent.name }), ok: t("yolo.ok"), dontAsk: true }).ask();
    if (r.ok && r.dontAsk) {
      this.settings.yoloOk = true;
      await this.saveSettings();
    }
    return r.ok;
  }

  // Opens a new agent tab. opts: agent id, cwd, yolo, resume.
  async newTab(opts) {
    if (!Platform.isDesktopApp) return this.openChat();
    opts = opts || {};
    const agent = (opts.agent && findAgent(this.settings, opts.agent)) || this.defaultAgent();
    const yolo = !!(opts.yolo && agent.yolo);
    if (yolo && !(await this.confirmYolo(agent))) return null;
    const leaf = this.newLeaf();
    await leaf.setViewState({ type: VIEW_AGENT, active: true, state: { agent: agent.id, cwd: opts.cwd || this.workDir(), yolo, resume: !!opts.resume } });
    await this.app.workspace.revealLeaf(leaf);
    const v = leaf.view instanceof AgentView ? leaf.view : null;
    if (v) {
      this.lastAgent = v;
      window.setTimeout(() => v.focus(), 50);
    }
    return v;
  }

  async openAgent() {
    const v = this.currentAgent();
    if (!v) return this.newTab({});
    await this.app.workspace.revealLeaf(v.leaf);
    this.app.workspace.setActiveLeaf(v.leaf, { focus: true });
    v.focus();
    return v;
  }

  async toggleFocus() {
    const ws = this.app.workspace;
    if (ws.getActiveViewOfType(AgentView)) {
      let leaf = this.lastNoteLeaf;
      if (!leaf || !leaf.view || !leaf.parent) leaf = ws.getLeavesOfType("markdown")[0];
      if (!leaf) return;
      ws.setActiveLeaf(leaf, { focus: true });
      const v = leaf.view;
      if (v instanceof MarkdownView && v.editor) v.editor.focus();
      return;
    }
    await this.openAgent();
  }

  openProject() {
    new ProjectPicker(this.app, this, async (dir) => {
      await this.rememberProject(dir);
      await this.detectInstalled();
      const all = this.agents();
      const list = all.filter((a) => a.installed !== false);
      if (list.length === 1) return this.newTab({ agent: list[0].id, cwd: dir });
      new AgentPicker(this.app, this, list.length ? list : all, (a) => this.newTab({ agent: a.id, cwd: dir })).open();
    }).open();
  }

  async rememberProject(dir) {
    const list = this.settings.projects.filter((x) => x !== dir);
    list.unshift(dir);
    this.settings.projects = list.slice(0, MAX_PROJECTS);
    await this.saveSettings();
  }

  selRange(editor) {
    const a = editor.getCursor("from");
    const b = editor.getCursor("to");
    const to = b.ch === 0 && b.line > a.line ? b.line : b.line + 1;
    return { from: a.line + 1, to };
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

  // Types a reference to a note, folder or selection into the current agent tab.
  async sendRef(file, range) {
    if (!file) return new Notice(t("notice.noFile"));
    await this.saveOpenNotes();
    let v = this.currentAgent();
    if (!v) v = await this.newTab({});
    if (!v) return;
    await this.app.workspace.revealLeaf(v.leaf);
    let text = v.refFor(file);
    if (range) text += " (" + (range.to > range.from ? t("ref.lines", range) : t("ref.line", range)) + ")";
    await v.send(text + " ");
  }

  isOwnHotkey(e) {
    const hm = this.app.hotkeyManager;
    if (!hm) return false;
    for (const id of ["toggle-focus", "open", "new-tab", "close-tab", "send-selection", "send-file"]) {
      const full = this.manifest.id + ":" + id;
      const keys = (hm.getHotkeys && hm.getHotkeys(full)) || (hm.getDefaultHotkeys && hm.getDefaultHotkeys(full)) || [];
      if (keys.some((h) => hotkeyMatches(h, e))) return true;
    }
    return false;
  }

  engineInstalled() {
    for (const v of this.agentViews()) v.engineInstalled();
  }

  applyTheme() {
    for (const v of this.agentViews()) v.applyTheme();
  }

  refreshAgents() {
    for (const v of this.agentViews()) if (v.leaf.updateHeader) v.leaf.updateHeader();
  }

  // ---- chat ----

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
    return this.app.workspace
      .getLeavesOfType(VIEW_CHAT)
      .map((l) => l.view)
      .filter((v) => v instanceof ChatView);
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

  async askChat(file, range) {
    if (!file) return new Notice(t("notice.noFile"));
    const view = await this.openChat();
    if (view) view.attach(file, range);
  }

  // ---- vault ----

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
    await put("AGENTS.md", AGENTS_MD);
    await put("CLAUDE.md", IMPORT_MD);
    await put("GEMINI.md", IMPORT_MD);
    await put(".claude/settings.json", CLAUDE_SETTINGS);
    if (made.length) new Notice(t("prepare.done", { files: made.join(", ") }));
    if (kept.length) new Notice(t("prepare.skipped", { files: kept.join(", ") }), 8000);
  }
};
