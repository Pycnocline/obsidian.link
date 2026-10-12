import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  minify: process.argv.includes("--production"),
  logLevel: "info"
});
