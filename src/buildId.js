import crypto from "crypto";
import fs from "fs";
import path from "path";

function walkFingerprint(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "vendor" || entry.name === "maps") continue;
      walkFingerprint(full, acc);
      continue;
    }
    if (!/\.(js|css|html)$/i.test(entry.name)) continue;
    const st = fs.statSync(full);
    acc.push(`${entry.name}:${st.size}:${Math.floor(st.mtimeMs)}`);
  }
  return acc;
}

export function resolveBuildId(publicDir) {
  const fromEnv = (process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || "").trim();
  if (fromEnv) return fromEnv.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "build";
  const parts = walkFingerprint(publicDir);
  if (parts.length === 0) return "dev";
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

export function isDiscordRequest(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  const q = req.query || {};
  return (
    host.includes("discordsays.com") ||
    origin.includes("discordsays.com") ||
    referer.includes("discordsays.com") ||
    referer.includes("discord.com") ||
    Object.prototype.hasOwnProperty.call(q, "frame_id") ||
    Object.prototype.hasOwnProperty.call(q, "instance_id")
  );
}

export function applyNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Cloudflare-CDN-Cache-Control", "no-store");
}
