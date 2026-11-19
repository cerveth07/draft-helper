# 准备包与命令行

## 包目录

微信来源包最少包含：

```text
manifest.json
raw-content.txt
preparation-report.json
assets/
```

平台派生包另含 `source-wechat.json`；一般还会导出 `preview-article.html`、`分发处理日志.txt`、标题和使用说明。`raw-content.txt` 实际是使用本地图片占位符的 HTML。不要手动改包内正文或清单后沿用原校验报告。

`manifest.json` 声明版本、平台配置、标题、作者、摘要、正文素材和封面。报告记录正文与清单的 SHA-256；每个素材另有字节数及 SHA-256。派生包用来源证明绑定微信原稿、布局转图、图片副本和格式转换。

包内原始素材可能多于最终正文中使用的图片，原因包括重复图片复用、装饰图省略、二维码省略或布局转图。实际变化以逐项日志为准。导出包不代表图片已经上传、文章已经保存或发布。

## 生成微信来源包

```sh
node prepare.mjs --html examples/html/article.html --title "图文排版与多平台迁移示例" --author "示例作者" --summary "使用合成文字与图片检查平台格式转换。" --cover examples/html/assets/cover.png --profile wechat-head --out-dir out/example-wechat
node verify.mjs out/example-wechat
```

`--profile` 可取 `wechat-head` 或 `wechat-sub`。头条默认取首张非 GIF 正文图作为封面，也可用 `--cover` 指定；次条不自动选封面。`--no-cover` 明确不带封面。可用 `--issue-date YYYY-MM-DD` 指定日期，未提供时使用执行日期。

带本地图片的 HTML 使用相对路径。命令行输入应为自己有权使用且已经确认的 HTML；完整网页的正文提取和样式分析优先使用扩展导入。CLI 不是任意网页的完整浏览器渲染或安全沙箱。

## 生成四个平台包

```sh
node distribute.mjs --source-dir out/example-wechat --out-dir out/example-platforms --platforms weibo,sohu,toutiao,yidian --summaries examples/platform-summaries.json --layout preserve
```

目标目录必须尚不存在，避免覆盖已有稿件。也可从带有完整 `source-wechat.json` 的平台包还原来源后再分发。

- `--titles titles.json`：按平台单独确认标题，例如 `{"toutiao":"独立平台标题"}`；不会截断原标题。
- `--summaries summaries.json`：仅接受微博独立导语，例如 `{"weibo":"44字以内的可选导语"}`，空字符串表示不填。
- `--layout auto`：默认策略，兼容不了的局部布局整合为图片，需要本机 Chrome / Chromium 与可选 Playwright 依赖。
- `--layout preserve`：保留原结构，平台可能拆散复杂样式。
- `--layout-width`：来源参考宽度，320–1000px，默认 677px。

### 当前配置中的标题限制

| 平台 | 字数 |
| --- | --- |
| 微信公众号 | 1–64 |
| 微博头条文章 | 1–32；导语可选，最多 44 |
| 搜狐号 | 5–72 |
| 今日头条 | 2–30 |
| 一点号、企鹅号 | 5–64 |

这些是本版本配置的预检值，平台或不同账号的限制可能变化，以当前编辑页为准。`verify.mjs` 只检查微信来源包；平台包的完整校验由扩展及 `distribution-core.js` 执行。
