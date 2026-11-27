import esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "ecl-test-")), "t.cjs");
await esbuild.build({
  stdin: { contents: 'const vt = require("./src/vault-tools.js"); const o = require("obsidian"); module.exports = { ...vt, TFile: o.TFile, TFolder: o.TFolder };', resolveDir: process.cwd() },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  alias: { obsidian: "./test/obsidian-mock.js" },
  logLevel: "error",
});
const { VaultTools, checkInput, cleanPath, TFile, TFolder } = (await import(pathToFileURL(out))).default;

function vault(files) {
  const map = new Map(Object.entries(files));
  const obj = (p) => (map.has(p) ? new TFile(p) : [...map.keys()].some((k) => k.startsWith(p + "/")) ? new TFolder(p) : null);
  return {
    files: map,
    getAbstractFileByPath: obj,
    getFiles: () => [...map.keys()].map((k) => new TFile(k)),
    read: async (f) => map.get(f.path),
    cachedRead: async (f) => map.get(f.path),
    create: async (p, c) => map.set(p, c),
    createFolder: async () => {},
    process: async (f, fn) => map.set(f.path, fn(map.get(f.path))),
  };
}
let fail = 0;
const ok = (name, cond) => {
  if (!cond) fail++;
  console.log((cond ? "ok   " : "FAIL ") + name);
};
const throws = async (name, fn, re) => {
  try {
    await fn();
    ok(name, false);
  } catch (e) {
    ok(name + " -> " + e.message.slice(0, 70), re ? re.test(e.message) : true);
  }
};

await throws("absolute path rejected", () => cleanPath("/etc/passwd"), /relative/);
await throws("drive path rejected", () => cleanPath("C:\\x.md"), /relative/);
await throws("dotdot rejected", () => cleanPath("a/../../b.md"), /\.\./);
await throws(".obsidian rejected", () => cleanPath(".obsidian/plugins/x/data.json"), /obsidian/);
ok("normal path kept", cleanPath("./Notes//Plan.md") === "Notes/Plan.md");

const v = vault({ "Notes/A.md": "alpha\nbeta\nbeta\n", "Notes/B.md": "gamma", ".obsidian/app.json": "{}", "img.png": "x" });
let approvals = [];
const tools = new VaultTools({ vault: v }, async (req) => (approvals.push(req), req.path !== "Notes/deny.md"));
ok("list skips .obsidian", !(await tools.listNotes({})).includes(".obsidian"));
ok("search finds content", (await tools.searchNotes({ query: "gam" })).includes("Notes/B.md"));
await throws("read binary refused", () => tools.readNote({ path: "img.png" }), /text file/);
await throws("read missing explains", () => tools.readNote({ path: "Nope.md" }), /search_notes/);
await throws("edit ambiguous refused", () => tools.editNote({ path: "Notes/A.md", old_text: "beta", new_text: "x" }), /2 times/);
await throws("edit missing text refused", () => tools.editNote({ path: "Notes/A.md", old_text: "zeta", new_text: "x" }), /wasn't found/);
const r = await tools.editNote({ path: "Notes/A.md", old_text: "alpha", new_text: "ALPHA $& $1" });
ok("edit applied literally", v.files.get("Notes/A.md").startsWith("ALPHA $& $1\n") && r.text.includes("Edited"));
await throws("create existing refused", () => tools.createNote({ path: "Notes/B.md", content: "x" }), /already exists/);
const d = await tools.createNote({ path: "Notes/deny.md", content: "x" });
ok("declined create writes nothing", d.declined && !v.files.has("Notes/deny.md"));
await tools.createNote({ path: "New/C.md", content: "hello" });
ok("create works", v.files.get("New/C.md") === "hello");
await tools.appendToNote({ path: "Notes/B.md", text: "delta" });
ok("append adds newline", v.files.get("Notes/B.md") === "gamma\ndelta\n");
ok("approvals carry before/after", approvals.some((a) => a.kind === "edit" && a.before === "alpha"));
const schema = { type: "object", properties: { path: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5 } }, required: ["path"] };
await throws("checkInput missing field", () => checkInput({}, schema), /Missing/);
await throws("checkInput wrong type", () => checkInput({ path: 3 }, schema), /string/);
await throws("checkInput extra field", () => checkInput({ path: "a", x: 1 }, schema), /Unknown/);
await throws("checkInput range", () => checkInput({ path: "a", limit: 9 }, schema), /at most/);
ok("checkInput passes good input", checkInput({ path: "a", limit: 2 }, schema).path === "a");
console.log(fail ? `${fail} failed` : "all tool tests ok");
process.exit(fail ? 1 : 0);
