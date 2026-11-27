const { TFile, TFolder, normalizePath } = require("obsidian");

const TEXT_EXT = new Set(["md", "txt", "canvas", "sh", "bash", "zsh", "py", "go", "js", "ts", "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "sql", "html", "css", "xml", "csv", "env", "log", "tf", "rb", "php", "java", "kt", "rs", "c", "h", "cpp", "lua", "ps1"]);
const MAX_READ = 200000;
const SCAN_LIMIT = 4000;

class ToolError extends Error {}

function checkInput(input, schema) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolError("INVALID_JSON: the tool input must be an object. Send the call again with valid JSON.");
  const props = schema.properties || {};
  for (const key of Object.keys(input)) if (!props[key]) throw new ToolError(`Unknown field "${key}". Allowed fields: ${Object.keys(props).join(", ")}.`);
  for (const key of schema.required || []) if (input[key] === undefined || input[key] === null) throw new ToolError(`Missing field "${key}". The input may have been cut off; send the call again.`);
  for (const [key, spec] of Object.entries(props)) {
    const v = input[key];
    if (v === undefined) continue;
    if (spec.type === "string" && typeof v !== "string") throw new ToolError(`"${key}" must be a string.`);
    if (spec.type === "integer") {
      if (!Number.isInteger(v)) throw new ToolError(`"${key}" must be a whole number.`);
      if (spec.minimum != null && v < spec.minimum) throw new ToolError(`"${key}" must be at least ${spec.minimum}.`);
      if (spec.maximum != null && v > spec.maximum) throw new ToolError(`"${key}" must be at most ${spec.maximum}.`);
    }
  }
  return input;
}

function cleanPath(raw) {
  const s = String(raw == null ? "" : raw).trim().replace(/\\/g, "/");
  if (!s) throw new ToolError("The path is empty.");
  if (/^\//.test(s) || /^[A-Za-z]:/.test(s) || /^~/.test(s)) throw new ToolError(`Use a path relative to the vault root, not ${s}.`);
  const parts = s.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new ToolError("Paths can't contain '..'.");
  const path = normalizePath(parts.join("/"));
  if (path === ".obsidian" || path.startsWith(".obsidian/")) throw new ToolError(".obsidian holds Obsidian's settings and can't be read or changed.");
  return path;
}

function extOf(path) {
  const name = path.split("/").pop();
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function needText(path) {
  if (!TEXT_EXT.has(extOf(path))) throw new ToolError(`${path} isn't a text file this tool can work with.`);
}

function count(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

function recentFiles(app, limit) {
  return app.vault
    .getFiles()
    .filter((f) => TEXT_EXT.has(f.extension.toLowerCase()) && !f.path.startsWith(".obsidian/"))
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, limit);
}

class VaultTools {
  constructor(app, approve) {
    this.app = app;
    this.approve = approve;
  }

  file(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) throw new ToolError(`There is no file at ${path}. Use list_notes or search_notes to find the right path.`);
    if (!(f instanceof TFile)) throw new ToolError(`${path} is a folder, not a file.`);
    return f;
  }

  async listNotes({ folder, limit }) {
    const max = Math.min(Math.max(limit || 200, 1), 500);
    let base = "";
    if (folder && folder.trim() && folder.trim() !== "/") {
      base = cleanPath(folder);
      const f = this.app.vault.getAbstractFileByPath(base);
      if (!(f instanceof TFolder)) throw new ToolError(`There is no folder at ${base}.`);
    }
    const files = this.app.vault
      .getFiles()
      .filter((f) => !f.path.startsWith(".obsidian/") && (!base || f.path.startsWith(base + "/")))
      .sort((a, b) => a.path.localeCompare(b.path));
    const shown = files.slice(0, max).map((f) => f.path);
    const more = files.length > max ? `\n… and ${files.length - max} more. Narrow it down with a folder.` : "";
    return (shown.length ? shown.join("\n") : "(no files)") + more;
  }

  async searchNotes({ query, limit }) {
    const q = String(query || "").trim();
    if (!q) throw new ToolError("The search query is empty.");
    const max = Math.min(Math.max(limit || 20, 1), 50);
    const lq = q.toLowerCase();
    const out = [];
    for (const f of recentFiles(this.app, SCAN_LIMIT)) {
      if (out.length >= max) break;
      const nameHit = f.path.toLowerCase().includes(lq);
      let text = "";
      try {
        text = await this.app.vault.cachedRead(f);
      } catch (e) {
        continue;
      }
      const lines = text.split("\n");
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < 3; i++) if (lines[i].toLowerCase().includes(lq)) hits.push(`  ${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      if (nameHit || hits.length) out.push(f.path + (hits.length ? "\n" + hits.join("\n") : ""));
    }
    return out.length ? out.join("\n") : `No notes match "${q}".`;
  }

  async readNote({ path }) {
    const p = cleanPath(path);
    needText(p);
    const text = await this.app.vault.read(this.file(p));
    if (text.length > MAX_READ) return text.slice(0, MAX_READ) + `\n\n[Truncated: the file is ${text.length} characters long.]`;
    return text;
  }

  async createNote({ path, content }) {
    const p = cleanPath(path);
    needText(p);
    if (this.app.vault.getAbstractFileByPath(p)) throw new ToolError(`${p} already exists. Read it and use edit_note or append_to_note instead.`);
    const ok = await this.approve({ kind: "create", path: p, after: content });
    if (!ok) return { declined: true };
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    await this.app.vault.create(p, content);
    return { text: `Created ${p}.` };
  }

  async editNote({ path, old_text, new_text }) {
    const p = cleanPath(path);
    needText(p);
    const f = this.file(p);
    if (!old_text) throw new ToolError("old_text is empty. Quote the exact text to replace.");
    const current = await this.app.vault.read(f);
    const n = count(current, old_text);
    if (n === 0) throw new ToolError(`old_text wasn't found in ${p}. Read the note again and quote the text exactly, including whitespace.`);
    if (n > 1) throw new ToolError(`old_text appears ${n} times in ${p}. Include more surrounding text so it matches once.`);
    const ok = await this.approve({ kind: "edit", path: p, before: old_text, after: new_text });
    if (!ok) return { declined: true };
    let applied = false;
    await this.app.vault.process(f, (data) => {
      if (count(data, old_text) !== 1) return data;
      applied = true;
      return data.replace(old_text, () => new_text);
    });
    if (!applied) throw new ToolError(`${p} changed while waiting for approval. Read it again.`);
    return { text: `Edited ${p}.` };
  }

  async appendToNote({ path, text }) {
    const p = cleanPath(path);
    needText(p);
    const f = this.file(p);
    const ok = await this.approve({ kind: "append", path: p, after: text });
    if (!ok) return { declined: true };
    await this.app.vault.process(f, (data) => {
      const sep = data.length && !data.endsWith("\n") ? "\n" : "";
      return data + sep + text + (text.endsWith("\n") ? "" : "\n");
    });
    return { text: `Added to ${p}.` };
  }
}

module.exports = { VaultTools, ToolError, checkInput, cleanPath, TEXT_EXT };
