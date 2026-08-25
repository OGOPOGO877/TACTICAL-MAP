import * as esbuild from "esbuild";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "client-vendor", "discord-sdk-entry.js");
const outfile = path.join(root, "public", "js", "vendor", "discord-sdk.js");

fs.mkdirSync(path.dirname(outfile), { recursive: true });

try {
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    logLevel: "info",
  });
  console.log("[bundle] Discord Embedded App SDK -> public/js/vendor/discord-sdk.js");
} catch (err) {
  console.warn("[bundle] Discord SDK bundle failed. Local fallback will still work.");
  console.warn(err.message || err);
  if (!fs.existsSync(outfile)) {
    fs.writeFileSync(
      outfile,
      "export class DiscordSDK { constructor() { throw new Error('Discord SDK not bundled'); } }\nexport function patchUrlMappings() {}\n",
    );
  }
}
