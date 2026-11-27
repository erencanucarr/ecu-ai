import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { agentList, findAgent, commandLine, mention, wslPath, MISSING_RE, AGENTS } = require("../src/agents.js");

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const claude = findAgent({}, "claude");
check("claude plain", commandLine(claude, {}), "claude");
check("claude yolo + resume", commandLine(claude, { yolo: true, resume: true }), "claude --dangerously-skip-permissions --continue");
const codex = findAgent({}, "codex");
check("codex resume is a subcommand after flags", commandLine(Object.assign({}, codex, { args: "-m gpt-5" }), { yolo: true, resume: true }), "codex --dangerously-bypass-approvals-and-sandbox -m gpt-5 resume --last");
check("gemini resume", commandLine(findAgent({}, "gemini"), { resume: true }), "gemini --resume latest");
check("opencode has no yolo", commandLine(findAgent({}, "opencode"), { yolo: true }), "opencode");

const s = { agents: { claude: { command: "/opt/bin/claude", args: "--model sonnet" } }, customAgents: [{ id: "custom-x", name: "X", command: "npx x-cli" }, { name: "empty", command: "  " }] };
const list = agentList(s);
check("override command and args", commandLine(findAgent(s, "claude"), {}), "/opt/bin/claude --model sonnet");
check("custom agents appended, empty ones skipped", list.map((a) => a.id), [...AGENTS.map((a) => a.id), "custom-x"]);
check("custom command kept as typed", commandLine(findAgent(s, "custom-x"), { yolo: true, resume: true }), "npx x-cli");
check("windows quoting", commandLine({ command: "claude", yolo: ["--a b"], resume: null }, { yolo: true }, true), 'claude "--a b"');

check("mention plain", mention("Notes/Deploy.md"), "@Notes/Deploy.md");
check("mention with spaces", mention("My notes/a b.md"), '"My notes/a b.md"');
check("wsl path", wslPath("C:\\Users\\me\\vault"), "/mnt/c/Users/me/vault");
check("wsl drive root", wslPath("D:\\"), "/mnt/d");

check("missing zsh", MISSING_RE.test("zsh: command not found: codex"), true);
check("missing cmd", MISSING_RE.test("'codex' is not recognized as an internal or external command,"), true);
check("missing fish", MISSING_RE.test("fish: Unknown command: codex"), true);
check("normal output", MISSING_RE.test("Welcome to Claude Code"), false);

if (failed) {
  console.log(`${failed} agent test(s) failed`);
  process.exit(1);
}
console.log("all agent tests ok");
