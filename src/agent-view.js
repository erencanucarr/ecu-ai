const { ItemView, Notice, setIcon } = require("obsidian");
const { Terminal } = require("@xterm/xterm");
const { FitAddon } = require("@xterm/addon-fit");
const { WebLinksAddon } = require("@xterm/addon-web-links");
const { Unicode11Addon } = require("@xterm/addon-unicode11");
const engine = require("./engine");
const { findAgent, commandLine, mention, wslPath, MISSING_RE } = require("./agents");
const { t } = require("./i18n");

const VIEW_AGENT = "ecu-ai-agent";
// `process` only exists on desktop; this file is also loaded on mobile, where agents are off.
const PLATFORM = typeof process !== "undefined" ? process.platform : "";
const IS_MAC = PLATFORM === "darwin";
const IS_WIN = PLATFORM === "win32";
const FONT = "Menlo, Monaco, 'SF Mono', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
// Prompts where typing a file reference would answer the question instead of adding to the input.
const DIALOG_RE = /(Choose the text style|Do you trust|trust the files|Select login method|login method|Press Enter to continue|Do you want to (proceed|make this edit|create|allow|run)|Yes, proceed|Esc to cancel|Allow (once|always)|❯\s*(\d+\.|✔))/i;
const FLOW_HIGH = 256 * 1024;
const FLOW_LOW = 64 * 1024;

const node = (m) => window.require(m);

function lastLines(text, n) {
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .join("\n");
}

function cssColor(probe, expr, fallback) {
  probe.setCssStyles({ color: "" });
  probe.setCssStyles({ color: expr });
  const c = getComputedStyle(probe).color;
  return c && c !== "rgba(0, 0, 0, 0)" ? c : fallback;
}

function termTheme(el) {
  const probe = el.createDiv({ cls: "eai-color-probe" });
  const c = (v, fb) => cssColor(probe, v, fb);
  const bg = c("var(--background-primary)", "#1e1e1e");
  const fg = c("var(--text-normal)", "#dcddde");
  const theme = {
    background: bg,
    foreground: fg,
    cursor: c("var(--caret-color, var(--text-normal))", fg),
    cursorAccent: bg,
    selectionBackground: c("var(--text-selection)", "rgba(255,255,255,.2)"),
    black: c("var(--background-modifier-border-hover, #3a3a3a)", "#3a3a3a"),
    red: c("var(--color-red)", "#e5534b"),
    green: c("var(--color-green)", "#57ab5a"),
    yellow: c("var(--color-yellow)", "#c69026"),
    blue: c("var(--color-blue)", "#539bf5"),
    magenta: c("var(--color-purple)", "#b083f0"),
    cyan: c("var(--color-cyan)", "#39c5cf"),
    white: c("var(--text-muted)", "#adbac7"),
    brightBlack: c("var(--text-faint)", "#636e7b"),
    brightRed: c("var(--color-red)", "#ff938a"),
    brightGreen: c("var(--color-green)", "#6bc46d"),
    brightYellow: c("var(--color-yellow)", "#daaa3f"),
    brightBlue: c("var(--color-blue)", "#6cb6ff"),
    brightMagenta: c("var(--color-purple)", "#dcbdfb"),
    brightCyan: c("var(--color-cyan)", "#56d4dd"),
    brightWhite: fg,
  };
  probe.remove();
  return theme;
}

function cleanEnv(env) {
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  if (process.platform === "linux") {
    if (Object.prototype.hasOwnProperty.call(env, "ORIGINAL_XDG_CURRENT_DESKTOP")) {
      if (env.ORIGINAL_XDG_CURRENT_DESKTOP) env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP;
      else delete env.XDG_CURRENT_DESKTOP;
      delete env.ORIGINAL_XDG_CURRENT_DESKTOP;
    }
    delete env.CHROME_DESKTOP;
  }
  return env;
}

// The program and arguments that run `line` the way the user's own terminal would:
// through a login shell on macOS and Linux (so PATH from the shell profile applies),
// cmd.exe on Windows, or bash inside WSL.
function launchSpec(line, cwd, settings) {
  if (IS_WIN) {
    if (settings.winShell === "wsl") return { file: "wsl.exe", args: ["--cd", cwd, "-e", "bash", "-lic", line] };
    return { file: process.env.COMSPEC || "cmd.exe", args: `/d /s /c "${line}"` };
  }
  const shell = (settings.shell || "").trim() || process.env.SHELL || (IS_MAC ? "/bin/zsh" : "/bin/bash");
  const name = shell.split("/").pop();
  const args = name === "zsh" || name === "bash" || name === "fish" ? ["-l", "-i", "-c", line] : ["-c", line];
  return { file: shell, args };
}

class AgentView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.agentId = "";
    this.cwd = "";
    this.yolo = false;
    this.resumeNext = false;
    this.term = null;
    this.proc = null;
    this.subs = [];
    this.lastDataAt = 0;
    this.spawnedAt = 0;
    this.closed = false;
    this.hasState = false;
    this.navigation = false;
  }

  getViewType() {
    return VIEW_AGENT;
  }

  agent() {
    return findAgent(this.plugin.settings, this.agentId) || findAgent(this.plugin.settings, this.plugin.settings.defaultAgent) || findAgent(this.plugin.settings, "claude");
  }

  getDisplayText() {
    const a = this.agent();
    let s = a ? a.name : "Agent";
    const base = this.cwd && this.cwd !== this.plugin.vaultPath() ? node("path").basename(this.cwd) : "";
    if (base) s += " · " + base;
    if (this.yolo) s += " · YOLO";
    return s;
  }

  getIcon() {
    const a = this.agent();
    return (a && a.icon) || "bot";
  }

  getState() {
    return { agent: this.agentId, cwd: this.cwd, yolo: this.yolo, started: true };
  }

  async setState(state, result) {
    state = state || {};
    const first = !this.hasState;
    this.hasState = true;
    this.agentId = state.agent || this.agentId || this.plugin.settings.defaultAgent;
    this.cwd = state.cwd || this.cwd || this.plugin.vaultPath();
    this.yolo = !!state.yolo;
    // A tab restored after a restart continues its conversation; a new one starts fresh unless asked.
    this.resumeNext = state.resume != null ? !!state.resume : !!(state.started && this.plugin.settings.resume);
    await super.setState(state, result);
    if (first) this.boot();
    this.leaf.updateHeader && this.leaf.updateHeader();
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("eai-agent");
    this.hostEl = this.contentEl.createDiv({ cls: "eai-host" });
    this.registerDomEvent(this.hostEl, "dragover", (e) => this.onDragOver(e));
    this.registerDomEvent(this.hostEl, "drop", (e) => this.onDrop(e));
    this.registerDomEvent(this.contentEl, "mousedown", () => this.plugin.noteAgentFocus(this));
  }

  async onClose() {
    this.closed = true;
    this.killPty();
    if (this.ro) this.ro.disconnect();
    if (this.term) this.term.dispose();
    this.term = null;
    this.plugin.forgetAgent(this);
  }

  onResize() {
    this.fitNow();
  }

  // ---- start up ----

  boot() {
    if (this.closed || !this.hostEl) return;
    if (!engine.supported()) return this.panel("engine", t("engine.unsupported", { platform: engine.platformKey() }));
    const dir = this.plugin.pluginDir();
    // Reuse ecu-terminal's node-pty when it has one; only otherwise ask before downloading.
    if (!engine.ready(dir) && !engine.borrow(dir)) return this.enginePanel();
    this.start();
  }

  enginePanel() {
    const box = this.panel("engine");
    box.createDiv({ cls: "eai-panel-title", text: t("engine.title") });
    box.createDiv({ text: t("engine.text", { version: engine.PTY_VERSION }) });
    const row = box.createDiv({ cls: "eai-panel-row" });
    const btn = row.createEl("button", { cls: "mod-cta", text: t("engine.download") });
    const status = row.createSpan({ cls: "eai-panel-status" });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      status.setText(t("engine.downloading"));
      try {
        await engine.install(this.plugin.pluginDir());
        this.plugin.engineInstalled();
      } catch (e) {
        btn.disabled = false;
        status.setText(t("engine.failed", { error: e && e.message ? e.message : e }));
      }
    });
  }

  engineInstalled() {
    if (this.term || this.closed) return;
    this.clearPanel();
    this.start();
  }

  start() {
    this.clearPanel();
    const s = this.plugin.settings;
    const term = new Terminal({
      fontFamily: (s.fontFamily || "").trim() || FONT,
      fontSize: Number(s.fontSize) || 13,
      lineHeight: 1,
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: false,
      allowProposedApi: true,
      theme: termTheme(this.contentEl),
    });
    this.term = term;
    this.fit = new FitAddon();
    term.loadAddon(this.fit);
    term.loadAddon(new WebLinksAddon((ev, uri) => window.open(uri, "_blank")));
    try {
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
    } catch (e) {
    }
    term.open(this.hostEl);
    this.keys();
    term.onData((d) => this.input(d));
    term.onBinary((d) => this.input(d, true));
    const win = this.hostEl.win;
    this.ro = new win.ResizeObserver(() => {
      win.cancelAnimationFrame(this.raf);
      this.raf = win.requestAnimationFrame(() => this.fitNow());
    });
    this.ro.observe(this.hostEl);
    this.fitNow();
    this.spawn(this.resumeNext);
    this.resumeNext = false;
  }

  spawn(resume) {
    const term = this.term;
    const agent = this.agent();
    if (!term || !agent) return;
    this.agentId = agent.id;
    let pty;
    try {
      pty = engine.load(this.plugin.pluginDir());
    } catch (e) {
      return this.enginePanel();
    }
    const fs = node("fs");
    if (!this.cwd || !fs.existsSync(this.cwd)) this.cwd = this.plugin.vaultPath() || node("os").homedir();
    const s = this.plugin.settings;
    const wsl = IS_WIN && s.winShell === "wsl";
    const line = commandLine(agent, { yolo: this.yolo, resume: resume && !!agent.resume }, IS_WIN && !wsl);
    const spec = launchSpec(line, this.cwd, s);
    const env = cleanEnv(
      Object.assign({}, process.env, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "ecu-ai",
        LANG: process.env.LANG || "en_US.UTF-8",
      })
    );
    let p;
    try {
      p = pty.spawn(spec.file, spec.args, { name: "xterm-256color", cols: term.cols, rows: term.rows, cwd: this.cwd, env });
    } catch (e) {
      term.write(`\r\n\x1b[31m${t("agent.spawnFailed", { error: e && e.message ? e.message : e })}\x1b[0m\r\n`);
      return this.showExited(null);
    }
    this.proc = p;
    this.exited = false;
    this.spawnedAt = Date.now();
    this.lastDataAt = 0;
    this.leaf.updateHeader && this.leaf.updateHeader();
    let pending = 0;
    let paused = false;
    this.subs = [
      p.onData((d) => {
        this.lastDataAt = Date.now();
        pending += d.length;
        if (!paused && pending > FLOW_HIGH) {
          paused = true;
          p.pause();
        }
        term.write(d, () => {
          pending -= d.length;
          if (paused && pending < FLOW_LOW) {
            paused = false;
            p.resume();
          }
        });
      }),
      p.onExit((ev) => this.onExit(p, ev)),
    ];
  }

  killPty() {
    for (const d of this.subs) {
      try {
        d.dispose();
      } catch (e) {
      }
    }
    this.subs = [];
    if (this.proc) {
      try {
        this.proc.kill();
      } catch (e) {
      }
    }
    this.proc = null;
  }

  onExit(p, ev) {
    if (this.proc !== p) return;
    this.proc = null;
    for (const d of this.subs) {
      try {
        d.dispose();
      } catch (e) {
      }
    }
    this.subs = [];
    if (this.closed) return;
    const code = ev && ev.exitCode;
    const quick = Date.now() - this.spawnedAt < 10000;
    if (code === 127 || (IS_WIN && code === 9009) || (quick && code !== 0 && MISSING_RE.test(lastLines(this.screenText(), 6)))) {
      return this.installPanel();
    }
    this.showExited(code);
  }

  showExited(code) {
    this.exited = true;
    if (this.term) this.term.write(`\r\n\x1b[2m${code == null ? t("agent.exitedPlain") : t("agent.exited", { code })}\x1b[0m\r\n`);
    if (this.exitEl) return;
    this.exitEl = this.contentEl.createDiv({ cls: "eai-exit" });
    const agent = this.agent();
    if (agent && agent.resume) {
      const b = this.exitEl.createEl("button", { cls: "mod-cta", text: t("agent.continue") });
      b.addEventListener("click", () => this.restart(true));
    }
    const b2 = this.exitEl.createEl("button", { text: t("agent.newSession") });
    b2.addEventListener("click", () => this.restart(false));
  }

  restart(resume) {
    if (this.closed) return;
    if (this.exitEl) {
      this.exitEl.remove();
      this.exitEl = null;
    }
    this.killPty();
    if (!this.term) return this.boot();
    this.term.reset();
    this.fitNow();
    this.spawn(resume);
    this.focus();
  }

  installPanel() {
    const agent = this.agent();
    if (this.term) {
      this.ro && this.ro.disconnect();
      this.term.dispose();
      this.term = null;
    }
    const box = this.panel("install");
    box.createDiv({ cls: "eai-panel-title", text: t("install.title", { name: agent.name }) });
    box.createDiv({ text: t("install.text", { cmd: agent.command, name: agent.name }) });
    const rows = [];
    const ins = agent.install || {};
    if (IS_WIN ? ins.win : ins.unix) rows.push([IS_WIN ? t("install.win") : t("install.unix"), IS_WIN ? ins.win : ins.unix]);
    if (ins.npm) rows.push([t("install.npm"), ins.npm]);
    for (const [label, cmd] of rows) {
      box.createDiv({ cls: "eai-install-label", text: label });
      const line = box.createDiv({ cls: "eai-install-cmd" });
      line.createEl("code", { text: cmd });
      const copy = line.createEl("button", { text: t("install.copy") });
      copy.addEventListener("click", async () => {
        try {
          await line.win.navigator.clipboard.writeText(cmd);
          copy.setText(t("install.copied"));
        } catch (e) {
        }
      });
    }
    if (!agent.builtin) box.createDiv({ cls: "eai-panel-note", text: t("install.custom") });
    const row = box.createDiv({ cls: "eai-panel-row" });
    if (agent.docs) row.createEl("a", { text: t("install.docs"), href: agent.docs });
    const retry = row.createEl("button", { cls: "mod-cta", text: t("install.retry") });
    retry.addEventListener("click", () => {
      this.clearPanel();
      this.start();
    });
  }

  panel(kind, text) {
    this.clearPanel();
    const box = this.contentEl.createDiv({ cls: "eai-panel eai-panel-" + kind });
    if (text) box.createDiv({ text });
    this.panelEl = box;
    return box;
  }

  clearPanel() {
    if (this.panelEl) this.panelEl.remove();
    this.panelEl = null;
    if (this.exitEl) this.exitEl.remove();
    this.exitEl = null;
  }

  // ---- input ----

  input(d, binary) {
    if (this.exited) {
      if (!binary && d.includes("\r")) {
        const agent = this.agent();
        this.restart(!!(agent && agent.resume));
      }
      return;
    }
    if (!this.proc) return;
    this.proc.write(binary ? node("buffer").Buffer.from(d, "binary") : d);
  }

  keys() {
    const term = this.term;
    const copy = () => {
      if (term.hasSelection()) this.hostEl.win.navigator.clipboard.writeText(term.getSelection()).catch(() => {});
    };
    const paste = () => this.hostEl.win.navigator.clipboard.readText().then((x) => x && term.paste(x)).catch(() => {});
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      // Esc interrupts the agent; keep Obsidian from also handling it.
      if (e.key === "Escape") {
        e.stopPropagation();
        return true;
      }
      if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const agent = this.agent();
        this.input((agent && agent.newline) || "\x1b\r");
        e.preventDefault();
        return false;
      }
      if (IS_MAC) {
        if (e.metaKey && !e.ctrlKey && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === "c") {
            copy();
            e.preventDefault();
            return false;
          }
          if (k === "v") return true;
          if (k === "a") {
            term.selectAll();
            e.preventDefault();
            return false;
          }
        }
        // Other Cmd shortcuts go to Obsidian.
        return !e.metaKey;
      }
      const k = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (k === "c") {
          copy();
          e.preventDefault();
          return false;
        }
        if (k === "v") {
          paste();
          e.preventDefault();
          return false;
        }
      }
      if (this.plugin.isOwnHotkey(e)) return false;
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && IS_WIN) {
        if (k === "c" && term.hasSelection()) {
          copy();
          term.clearSelection();
          e.preventDefault();
          return false;
        }
        if (k === "v") {
          paste();
          e.preventDefault();
          return false;
        }
      }
      // Ctrl keys belong to the agent, not to Obsidian's hotkeys.
      if (e.ctrlKey) e.stopPropagation();
      return true;
    });
    if (term.textarea) {
      term.textarea.addEventListener("focus", () => this.plugin.noteAgentFocus(this));
    }
  }

  fitNow() {
    if (!this.term || !this.hostEl || !this.hostEl.offsetWidth || !this.hostEl.offsetHeight) return;
    try {
      this.fit.fit();
      if (this.proc) this.proc.resize(this.term.cols, this.term.rows);
    } catch (e) {
    }
  }

  focus() {
    if (this.term) this.term.focus();
  }

  applyTheme() {
    if (!this.term) return;
    this.term.options.theme = termTheme(this.contentEl);
    this.term.options.fontSize = Number(this.plugin.settings.fontSize) || 13;
    this.term.options.fontFamily = (this.plugin.settings.fontFamily || "").trim() || FONT;
    this.fitNow();
  }

  screenText() {
    if (!this.term) return "";
    const b = this.term.buffer.active;
    const out = [];
    for (let i = Math.max(0, b.length - 60); i < b.length; i++) {
      const l = b.getLine(i);
      if (l) out.push(l.translateToString(true));
    }
    return out.join("\n");
  }

  // ---- sending references ----

  // How a vault file or folder is named to this agent: relative to its working folder when inside it.
  refFor(file) {
    const path = node("path");
    const abs = path.join(this.plugin.vaultPath(), file.path);
    let rel = path.relative(this.cwd, abs);
    if (!rel) rel = ".";
    let shown = rel.startsWith("..") || path.isAbsolute(rel) ? abs : rel;
    if (IS_WIN && this.plugin.settings.winShell === "wsl" && shown === abs) shown = wslPath(abs);
    shown = shown.split(path.sep).join("/");
    if (file.children && !shown.endsWith("/")) shown += "/";
    return mention(shown);
  }

  pathRef(abs) {
    let p = abs;
    if (IS_WIN && this.plugin.settings.winShell === "wsl") p = wslPath(abs);
    return mention(p.split(node("path").sep).join("/"));
  }

  async waitReady(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (this.closed) return false;
      if (this.proc && Date.now() - this.spawnedAt > 1200 && this.lastDataAt && Date.now() - this.lastDataAt > 500) return true;
      await new Promise((r) => window.setTimeout(r, 150));
    }
    return !!this.proc;
  }

  // Types text into the agent's input without pressing Enter.
  async send(text) {
    if (this.exited) this.restart(true);
    if (!this.term) {
      new Notice(t("notice.notRunning"));
      return false;
    }
    const fresh = Date.now() - this.spawnedAt < 1500;
    const ok = await this.waitReady(fresh ? 20000 : 3000);
    if (!ok || !this.proc) {
      new Notice(t("notice.notRunning"));
      return false;
    }
    if (DIALOG_RE.test(lastLines(this.screenText(), 20))) {
      try {
        await this.hostEl.win.navigator.clipboard.writeText(text.trim());
      } catch (e) {
      }
      new Notice(t("notice.busy"), 10000);
      return false;
    }
    this.proc.write(text);
    this.focus();
    return true;
  }

  // ---- drag and drop ----

  onDragOver(e) {
    const dm = this.app.dragManager;
    if ((dm && dm.draggable) || (e.dataTransfer && e.dataTransfer.types.includes("Files"))) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
  }

  onDrop(e) {
    const dm = this.app.dragManager;
    const d = dm && dm.draggable;
    const refs = [];
    if (d && (d.file || d.files)) {
      for (const f of d.files || [d.file]) if (f) refs.push(this.refFor(f));
    } else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      let webUtils = null;
      try {
        webUtils = node("electron").webUtils;
      } catch (err) {
      }
      for (const f of Array.from(e.dataTransfer.files)) {
        const p = (webUtils && webUtils.getPathForFile(f)) || f.path;
        if (p) refs.push(this.pathRef(p));
      }
    }
    if (!refs.length) return;
    e.preventDefault();
    e.stopPropagation();
    this.send(refs.join(" ") + " ");
  }
}

module.exports = { AgentView, VIEW_AGENT, lastLines, launchSpec };
