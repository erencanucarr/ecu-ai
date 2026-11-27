import esbuild from "esbuild";
import { copyFileSync } from "node:fs";
import { builtinModules } from "node:module";

// The SDK's browser build swaps its Node helpers (used only to read local
// credential files when no API key is given) for stubs that throw. ecu-claude
// always passes an API key, so drop the stubs and keep the bundle free of any
// reference to Node modules.
const noNodeShims = {
  name: "no-node-shims",
  setup(build) {
    build.onLoad({ filter: /@anthropic-ai[\\/]sdk[\\/].*node\.browser\.mjs$/ }, () => ({ contents: "export {};", loader: "js" }));
  },
};

await esbuild.build({
  entryPoints: ["src/main.js"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => "node:" + m)],
  logLevel: "info",
  legalComments: "eof",
  plugins: [noNodeShims],
});
copyFileSync("src/styles.css", "styles.css");
