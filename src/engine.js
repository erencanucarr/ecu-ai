// node-pty runs the agent in a real pseudo-terminal. It is a native module, so it
// is not bundled: ecu-ai downloads the build for this platform once, checks its
// SHA-256, and keeps it in the plugin folder. If ecu-terminal already has the same
// node-pty version, that copy is reused and nothing is downloaded.
const { requestUrl } = require("obsidian");

const PTY_VERSION = "1.1.0";
const PTY_RELEASE_URL = "https://github.com/erencanucarr/ecu-ai/releases/download/node-pty-" + PTY_VERSION;
const PTY_SHA256 = {
  "darwin-arm64": "c32d517b10189c762e829bf6d343ef57294fcaefb32761a611d2ccd05678562d",
  "darwin-x64": "9eb69ad5b64c85d187a301062fdfad8b50442306b283ac6940cf8cf66e43fdd3",
  "linux-arm64": "b6c11247e95ab47bc801b1136f271a5c9d63f4502827be77db3a206dbcfb048a",
  "linux-x64": "7e7f7ab98a3c545e596691eb18a4cd5447b223148a7df7337d8e7ae3fce3f75c",
  "win32-arm64": "8bd3700ac6ffe0e70d0fcffca2dd7537b4a2d0f5c66773e0b5b64ac5bdd343b7",
  "win32-x64": "d868c695cb8bd310b9c3fe857f45ef481a920dbe48ac20f5879df0031691078c",
};

const node = (m) => window.require(m);

function platformKey() {
  return process.platform + "-" + process.arch;
}

function supported() {
  return !!PTY_SHA256[platformKey()];
}

function validDir(d) {
  const fs = node("fs");
  const path = node("path");
  try {
    if (!fs.existsSync(path.join(d, "prebuilds", platformKey()))) return false;
    const pkg = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"));
    return pkg.version === PTY_VERSION;
  } catch (e) {
    return false;
  }
}

function ownDir(pluginDir) {
  return node("path").join(pluginDir, "node-pty");
}

function ready(pluginDir) {
  return validDir(ownDir(pluginDir));
}

function untar(buf, dest) {
  const fs = node("fs");
  const path = node("path");
  const root = path.resolve(dest);
  let off = 0;
  const str = (a, b) => buf.toString("utf8", off + a, off + b).replace(/\0.*$/s, "");
  while (off + 512 <= buf.length) {
    if (buf.readUInt32BE(off) === 0 && buf.readUInt32BE(off + 4) === 0) break;
    const name = str(0, 100);
    const mode = parseInt(str(100, 108).trim() || "644", 8);
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = str(345, 500);
    const rel = (prefix ? prefix + "/" : "") + name;
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("unsafe path in archive: " + rel);
    off += 512;
    if (type === "5") fs.mkdirSync(target, { recursive: true });
    else if (type === "0" || type === "\0") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf.subarray(off, off + size));
      if (process.platform !== "win32") fs.chmodSync(target, mode & 0o755);
    }
    off += Math.ceil(size / 512) * 512;
  }
}

function swapIn(pluginDir, fill) {
  const fs = node("fs");
  const path = node("path");
  const tmp = path.join(pluginDir, ".node-pty-new");
  const final = ownDir(pluginDir);
  const old = path.join(pluginDir, ".node-pty-old");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fill(tmp);
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(final)) fs.renameSync(final, old);
    try {
      fs.renameSync(path.join(tmp, "node-pty"), final);
    } catch (e) {
      if (fs.existsSync(old) && !fs.existsSync(final)) fs.renameSync(old, final);
      throw e;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
  }
  if (process.platform === "darwin") {
    try {
      fs.chmodSync(path.join(final, "prebuilds", platformKey(), "spawn-helper"), 0o755);
    } catch (e) {
    }
  }
}

// Copies node-pty from ecu-terminal when it has the same version. Returns true on success.
function borrow(pluginDir) {
  const fs = node("fs");
  const path = node("path");
  const src = path.join(path.dirname(pluginDir), "ecu-terminal", "node-pty");
  if (!validDir(src)) return false;
  try {
    swapIn(pluginDir, (tmp) => fs.cpSync(src, path.join(tmp, "node-pty"), { recursive: true }));
    return validDir(ownDir(pluginDir));
  } catch (e) {
    console.warn("[ecu-ai] couldn't copy node-pty from ecu-terminal", e);
    return false;
  }
}

async function download(pluginDir) {
  const key = platformKey();
  const sha = PTY_SHA256[key];
  if (!sha) throw new Error("unsupported platform " + key);
  const res = await requestUrl({ url: `${PTY_RELEASE_URL}/node-pty-${key}.tar.gz`, method: "GET" });
  const gz = node("buffer").Buffer.from(res.arrayBuffer);
  const got = node("crypto").createHash("sha256").update(gz).digest("hex");
  if (got !== sha) throw new Error("the download didn't match its SHA-256 checksum");
  const tar = node("zlib").gunzipSync(gz);
  swapIn(pluginDir, (tmp) => untar(tar, tmp));
}

let pending = null;
async function install(pluginDir) {
  if (ready(pluginDir)) return;
  if (!pending) {
    pending = (async () => {
      if (borrow(pluginDir)) return;
      await download(pluginDir);
    })().finally(() => (pending = null));
  }
  await pending;
}

let loaded = null;
function load(pluginDir) {
  if (loaded) return loaded;
  const dir = ownDir(pluginDir);
  if (!validDir(dir)) throw new Error("node-pty isn't installed");
  if (process.platform === "darwin") {
    try {
      node("fs").chmodSync(node("path").join(dir, "prebuilds", platformKey(), "spawn-helper"), 0o755);
    } catch (e) {
    }
  }
  loaded = node(dir);
  return loaded;
}

module.exports = { PTY_VERSION, supported, ready, borrow, install, load, platformKey };
