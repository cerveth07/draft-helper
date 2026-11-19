#!/usr/bin/env node
/**
 * 准备包自检：按 SyncPress 扩展 verifyBundle 的规则逐条核对。
 * 用法: node verify.mjs <准备包目录>
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const bundle = path.resolve(process.argv[2] || ".");
const read = (name) => fs.readFileSync(path.join(bundle, name));
const manifestBytes = read("manifest.json");
const htmlBytes = read("raw-content.txt");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const report = JSON.parse(read("preparation-report.json").toString("utf8"));
const html = htmlBytes.toString("utf8");

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);
add("bundleContractVersion == 1", manifest.bundleContractVersion === 1);
add("report.bundle_contract_version == 1", report.bundle_contract_version === 1);
add("目标配置（可选）：profile 与报告一致", !manifest.profile
  || (manifest.profile.version === 1 && /^wechat-(head|sub)$/.test(manifest.profile.id || "")
      && manifest.profileSpec?.id === manifest.profile.id
      && report.profile_id === manifest.profile.id));
add("report.state == PREPARED", report.state === "PREPARED");
add("正文 SHA == payload_sha256", sha(htmlBytes) === report.payload_sha256);
add("清单 SHA == manifest_sha256", sha(manifestBytes) === report.manifest_sha256);
add("remote_image_count == 0", report.remote_image_count === 0);
add("正文无远程 <img src>", !/<img\b[^>]*\ssrc\s*=\s*["'](?:https?:)?\/\//i.test(html));
add("摘要 1..120 字", typeof manifest.summary === "string" && [...manifest.summary.trim()].length > 0 && [...manifest.summary.trim()].length <= 120);
const images = Array.isArray(manifest.contentImages) ? manifest.contentImages : [];
add("contentImages 为数组（允许纯文字）", Array.isArray(manifest.contentImages));
add("占位符齐全", images.every((item) => html.includes(item.placeholder)));
for (const item of images) {
  const file = path.join(bundle, "assets", item.bundleFile);
  const ok = fs.existsSync(file) && sha(fs.readFileSync(file)) === item.sha256
    && fs.statSync(file).size === item.bytes;
  add("图片 " + item.bundleFile + " 哈希/字节数", ok);
}
const cover = manifest.coverImage;
if (cover) {
  const file = path.join(bundle, "assets", cover.bundleFile);
  add("封面 " + cover.bundleFile + " 哈希/字节数", fs.existsSync(file) && sha(fs.readFileSync(file)) === cover.sha256);
} else {
  add("封面（可选，缺失仅提醒）", true);
}
add("平台（缺省按微信）", !manifest.targetPlatform || manifest.targetPlatform === "wechat");

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad += 1;
  console.log((ok ? "PASS " : "FAIL ") + name);
}
console.log("\n摘要:", manifest.summary);
console.log("配置档:", manifest.profile?.id || "(未声明，按旧版微信包处理)");
console.log("图片:", images.map((x) => x.bundleFile).join(", ") || "(无)");
console.log("结果:", bad ? `FAILED (${bad})` : "全部通过，可在扩展「手动选择准备包」中选用");
process.exitCode = bad ? 1 : 0;
