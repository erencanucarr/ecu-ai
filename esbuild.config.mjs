import esbuild from "esbuild";
import { copyFileSync } from "node:fs";
import { builtinModules } from "node:module";

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
});
copyFileSync("src/styles.css", "styles.css");
