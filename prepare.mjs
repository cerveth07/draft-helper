#!/usr/bin/env node
/**
 * 独立微信草稿准备包生成器（不依赖 draft-helper 仓库）
 *
 * 用法：
 *   node prepare.mjs --html article.html --title "标题" [--summary "摘要"] [--author "作者"]
 *                    [--issue-date 2026-10-22] [--out-dir ./out/my-draft] [--cover cover.jpg]
 *                    [--profile wechat-head|wechat-sub]
 *
 * 产出（SyncPress 扩展「手动选择准备包」认可的结构）：
 *   manifest.json / raw-content.txt / preparation-report.json / assets/
 *
 * 目标配置档决定默认格式：头条（大图封面，缺省自动取正文首张静图）与
 * 次条（方形小图，不自动取图）字段与封面策略不同，规则集中在
 * extension/distribution-core.js 的 PROFILES。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const D = require("./extension/distribution-core.js");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error("未知参数: " + key);
    if (key === '--no-cover') { args['no-cover'] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(key + " 缺少取值");
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

const MIME_EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/bmp": "bmp",
};

async function download(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      referer: "https://mp.weixin.qq.com/",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  return { bytes: Buffer.from(await res.arrayBuffer()), type };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.html || !args.title) throw new Error("需要 --html 和 --title");
  const profileId = args.profile || "wechat-head";
  if (profileId !== "wechat-head" && profileId !== "wechat-sub")
    throw new Error("--profile 仅支持 wechat-head 或 wechat-sub");
  const profile = D.profileFor("wechat", profileId === "wechat-sub" ? "sub" : "head");
  const title = args.title.trim();
  const titleLength = [...title].length;
  if (titleLength < profile.title.min || titleLength > profile.title.max)
    throw new Error(profile.label + "标题必须为 " + profile.title.min + "–" + profile.title.max
      + " 字（当前 " + titleLength + " 字）");
  const htmlPath = path.resolve(args.html);
  const htmlDir = path.dirname(htmlPath);
  const issueDate = args["issue-date"] || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Error("--issue-date 需要 YYYY-MM-DD");
  const outDir = path.resolve(args["out-dir"] || path.join("out", issueDate + "-" + profile.id));
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  let html = fs.readFileSync(htmlPath, "utf8");
  const sourceSha = sha(Buffer.from(html, "utf8"));
  const contentImages = [];
  const failures = [];
  const droppedSpacers = [];
  const seen = new Map(); // 同一张图重复引用时复用同一个占位符（例如列表里反复出现的图标）
  let remoteCount = 0;
  let seq = 0;

  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ tag: m[0], start: m.index }));
  for (const { tag } of imgTags) {
    const srcMatch = tag.match(/\ssrc\s*=\s*"([^"]*)"/i) || tag.match(/\ssrc\s*=\s*'([^']*)'/i);
    if (!srcMatch) continue;
    const rawSrc = srcMatch[1].replace(/&amp;/g, "&").trim();
    if (!rawSrc) continue;
    let bytes = null;
    let ext = null;
    let localPath = null;

    if (/^https?:/i.test(rawSrc)) {
      remoteCount += 1;
      try {
        const got = await download(rawSrc);
        bytes = got.bytes;
        ext = MIME_EXT[got.type] || (rawSrc.match(/\.(png|jpe?g|gif|webp|bmp)(?:\?|$)/i) || [])[1] || "jpg";
      } catch (error) {
        failures.push(rawSrc + " (" + error.message + ")");
        continue;
      }
    } else if (/^data:/i.test(rawSrc)) {
      const m = rawSrc.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (!m) { failures.push("无效 data URI"); continue; }
      bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
      ext = MIME_EXT[(m[1] || "").toLowerCase()] || "png";
    } else {
      const clean = decodeURIComponent(rawSrc.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1"));
      localPath = path.isAbsolute(clean) || /^[A-Za-z]:[\\/]/.test(clean)
        ? clean
        : path.resolve(htmlDir, clean);
      if (!fs.existsSync(localPath)) { failures.push(clean + "（本机不存在）"); continue; }
      bytes = fs.readFileSync(localPath);
      ext = (path.extname(localPath).replace(".", "") || "jpg").toLowerCase();
    }

    if (!bytes || !bytes.length) { failures.push(rawSrc + "（空文件）"); continue; }
    // 1×1 追踪像素/占位小图没有可见内容，各平台都会丢弃，留在包里只会造成上传卡住。
    if (D.isSpacerImage(bytes)) {
      droppedSpacers.push(tag.slice(0, 120));
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp("<p\\b[^>]*>\\s*" + escaped + "\\s*</p>", "gi"), "");
      if (html.includes(tag)) html = html.replace(tag, "");
      continue;
    }
    const key = /^https?:/i.test(rawSrc) ? "url:" + rawSrc
      : /^data:/i.test(rawSrc) ? "sha:" + sha(bytes)
        : "file:" + path.resolve(localPath);
    const reused = seen.get(key);
    if (reused) {
      html = html.replace(tag, tag.replace(srcMatch[0], srcMatch[0].replace(srcMatch[1], reused.placeholder)));
      continue;
    }
    seq += 1;
    const bundleFile = String(seq).padStart(3, "0") + "." + ext;
    fs.writeFileSync(path.join(assetsDir, bundleFile), bytes);
    const placeholder = "WECHATIMGPH_" + seq;
    contentImages.push({ placeholder, bundleFile, sha256: sha(bytes), bytes: bytes.length });
    seen.set(key, { placeholder, bundleFile });
    html = html.replace(tag, tag.replace(srcMatch[0], srcMatch[0].replace(srcMatch[1], placeholder)));
  }

  let coverImage = null;
  let coverStatus = "NOT_FOUND";
  let coverSource = null;
  if (args.cover) {
    const coverPath = path.resolve(args.cover);
    if (!fs.existsSync(coverPath)) throw new Error("封面文件不存在: " + coverPath);
    const bytes = fs.readFileSync(coverPath);
    const ext = (path.extname(coverPath).replace(".", "") || "jpg").toLowerCase();
    const bundleFile = "cover." + ext;
    fs.writeFileSync(path.join(assetsDir, bundleFile), bytes);
    coverImage = { bundleFile, sha256: sha(bytes), bytes: bytes.length, sourceName: path.basename(coverPath) };
    coverStatus = "FOUND";
    coverSource = "explicit";
  } else if (!args["no-cover"] && profile.cover.auto === "first-body-image") {
    // 规则：正文里的第一张图当封面。跳过 GIF（装饰/动图，公众号封面不吃 gif），
    // 找不到可用图片时保持无封面（扩展只提醒，不阻断）。
    const firstPhoto = contentImages.find((item) => !/\.gif$/i.test(item.bundleFile));
    if (firstPhoto) {
      const srcExt = path.extname(firstPhoto.bundleFile).replace(".", "").toLowerCase();
      const bundleFile = "cover." + srcExt;
      fs.copyFileSync(path.join(assetsDir, firstPhoto.bundleFile), path.join(assetsDir, bundleFile));
      coverImage = {
        bundleFile,
        sha256: firstPhoto.sha256,
        bytes: firstPhoto.bytes,
        sourceName: "正文第一张图（" + firstPhoto.bundleFile + "）",
      };
      coverStatus = "FOUND";
      coverSource = "first-body-image";
    }
  }

  let summary = (args.summary || "").trim();
  if (!summary && profile.summary.mode === "auto") {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    summary = [...text].slice(0, 100).join("");
    console.log("未提供 --summary，已从正文取前 100 字作为摘要。");
  }
  if (profile.summary.max && [...summary].length > profile.summary.max)
    throw new Error("摘要超过 " + profile.summary.max + " 字（当前 " + [...summary].length + "）");

  const profileChecks = D.profileChecks(profile, {
    title, summary, author: (args.author || "").trim(), coverImage,
  });

  const manifest = {
    bundleContractVersion: 1,
    profile: { id: profile.id, version: 1 },
    profileSpec: D.profileSpecOf(profile),
    title,
    author: (args.author || "").trim(),
    summary,
    issueDate,
    contentImages,
    coverImage,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  fs.writeFileSync(path.join(outDir, "manifest.json"), manifestText, "utf8");
  fs.writeFileSync(path.join(outDir, "raw-content.txt"), html, "utf8");

  const report = {
    state: failures.length ? 'INCOMPLETE' : 'PREPARED',
    bundle_contract_version: 1,
    profile_id: profile.id,
    profile_checks: profileChecks,
    source_html: path.relative(outDir, htmlPath).split(path.sep).join("/"),
    source_sha256: sourceSha,
    payload_sha256: sha(Buffer.from(html, "utf8")),
    manifest_sha256: sha(Buffer.from(manifestText, "utf8")),
    title: manifest.title,
    miniprogram_preview_replaced: false,
    native_miniprogram_card_count: 0,
    local_image_count: contentImages.length,
    dropped_spacer_count: droppedSpacers.length,
    dropped_spacers: droppedSpacers,
    assets: contentImages.map(({ bundleFile, sha256, bytes }) => ({ bundleFile, sha256, bytes })),
    cover_image_status: coverStatus,
    cover_image: coverImage ? coverImage.bundleFile : null,
    cover_image_sha256: coverImage ? coverImage.sha256 : null,
    cover_image_source: coverSource,
    remote_image_count: failures.filter(item => /^https?:/i.test(item)).length,
    unresolved_images: failures,
    files: { raw_html: "raw-content.txt", manifest: "manifest.json" },
  };
  fs.writeFileSync(path.join(outDir, "preparation-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  if (droppedSpacers.length)
    console.log("已剔除 " + droppedSpacers.length + " 张 1×1 空图（微信追踪像素/占位图），各平台都会忽略它们。");

  console.log(JSON.stringify({
    status: report.state,
    out: outDir,
    profile: profile.id,
    profile_label: profile.label,
    title: manifest.title,
    summary_chars: [...summary].length,
    images: contentImages.map((x) => x.bundleFile),
    cover: coverImage ? coverImage.bundleFile : null,
    cover_source: coverSource,
    downloaded_remote_images: remoteCount,
    dropped_spacer_images: droppedSpacers.length,
    unresolved_images: failures,
  }, null, 2));
  if (failures.length) {
    console.log("\n⚠️ 以下图片没能本地化，原标签已保留；请补齐后重新生成，不应直接导入：\n - " + failures.join("\n - "));
    report.state = 'INCOMPLETE';
    fs.writeFileSync(path.join(outDir, 'preparation-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error("FAILED:", error.message); process.exitCode = 1; });
