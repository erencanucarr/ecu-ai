// The agent CLIs ecu-ai knows how to start. Flags come from each tool's own
// documentation; "resume" continues the most recent conversation in the folder.
const AGENTS = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    icon: "sparkles",
    yolo: ["--dangerously-skip-permissions"],
    resume: ["--continue"],
    install: { unix: "curl -fsSL https://claude.ai/install.sh | bash", win: "irm https://claude.ai/install.ps1 | iex", npm: "npm install -g @anthropic-ai/claude-code" },
    docs: "https://code.claude.com/docs/en/setup",
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    icon: "square-code",
    yolo: ["--dangerously-bypass-approvals-and-sandbox"],
    resume: ["resume", "--last"],
    newline: "\n",
    install: { unix: "brew install --cask codex", npm: "npm install -g @openai/codex" },
    docs: "https://developers.openai.com/codex/cli",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    icon: "gem",
    yolo: ["--approval-mode=yolo"],
    resume: ["--resume", "latest"],
    install: { unix: "brew install gemini-cli", npm: "npm install -g @google/gemini-cli" },
    docs: "https://geminicli.com/docs/get-started/installation",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    icon: "braces",
    yolo: null,
    resume: ["--continue"],
    install: { unix: "curl -fsSL https://opencode.ai/install | bash", npm: "npm install -g opencode-ai" },
    docs: "https://opencode.ai/docs",
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    command: "copilot",
    icon: "github",
    yolo: ["--allow-all"],
    resume: ["--continue"],
    install: { npm: "npm install -g @github/copilot" },
    docs: "https://docs.github.com/copilot/how-tos/copilot-cli",
  },
  {
    id: "cursor",
    name: "Cursor Agent",
    command: "cursor-agent",
    icon: "mouse-pointer-2",
    yolo: ["--force"],
    resume: ["resume"],
    install: { unix: "curl https://cursor.com/install -fsS | bash", win: "irm 'https://cursor.com/install?win32=true' | iex" },
    docs: "https://cursor.com/docs/cli/overview",
  },
];

const BUILTIN_IDS = new Set(AGENTS.map((a) => a.id));

function customId(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return "custom-" + (slug || "cli");
}

// Built-in agents with the user's overrides, followed by their own CLIs.
function agentList(settings) {
  const over = (settings && settings.agents) || {};
  const list = AGENTS.map((a) => {
    const o = over[a.id] || {};
    return Object.assign({}, a, { command: (o.command || "").trim() || a.command, args: (o.args || "").trim(), builtin: true });
  });
  for (const c of (settings && settings.customAgents) || []) {
    if (!c || !String(c.command || "").trim()) continue;
    list.push({
      id: c.id || customId(c.name),
      name: String(c.name || c.command).trim(),
      command: String(c.command).trim(),
      args: String(c.args || "").trim(),
      icon: "terminal",
      yolo: null,
      resume: null,
      install: null,
      docs: "",
      builtin: false,
    });
  }
  return list;
}

function findAgent(settings, id) {
  const list = agentList(settings);
  return list.find((a) => a.id === id) || null;
}

function posixQuote(s) {
  s = String(s);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function cmdQuote(s) {
  s = String(s);
  if (/^[\w@%+=:,./\\-]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// The command line that starts the agent, quoted for a POSIX shell or for cmd.exe.
// The command itself is left as typed so that a wrapper such as "npx foo" still works.
function commandLine(agent, opts, win) {
  opts = opts || {};
  const q = win ? cmdQuote : posixQuote;
  const parts = [String(agent.command).trim()];
  if (opts.yolo && agent.yolo) parts.push(...agent.yolo.map(q));
  if (agent.args) parts.push(agent.args);
  if (opts.resume && agent.resume) parts.push(...agent.resume.map(q));
  return parts.join(" ");
}

// How a file is mentioned to an agent: @path, quoted when it has spaces.
function mention(rel) {
  return /\s/.test(rel) ? '"' + rel.replace(/"/g, '\\"') + '"' : "@" + rel;
}

// C:\Users\me\vault -> /mnt/c/Users/me/vault, for agents running inside WSL.
function wslPath(p) {
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(String(p));
  if (!m) return String(p).replace(/\\/g, "/");
  return "/mnt/" + m[1].toLowerCase() + (m[2] ? "/" + m[2].replace(/\\/g, "/") : "");
}

const MISSING_RE = /(command not found|Unknown command: |is not recognized as (an internal|the name)|CommandNotFoundException|No such file or directory)/i;

module.exports = { AGENTS, BUILTIN_IDS, agentList, findAgent, customId, posixQuote, cmdQuote, commandLine, mention, wslPath, MISSING_RE };
