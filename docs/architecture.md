# 代码结构

扩展无需构建步骤，`studio.html` 和 `popup.html` 直接加载本地脚本。Markdown 解析器也随扩展本地分发。

## 工作台

- `studio-core.js`、`import-fidelity.js`：导入清理、样式保真、数据文件校验和微信包生成。
- `wechat-capture.js`、`image-localizer.js`：读取用户指定来源页、本地化远程素材。
- `authoring-core.js`、`authoring-ui.js`、`authoring-components.js`：正文编排、交互与组件。
- `studio.js`、`studio-polish.js`：工作稿状态、本机保存、导入导出与界面。
- `compare-preview.js`：来源和目标平台的双侧对照。

## 分发与填入

- `distribution-core.js`：平台配置、来源契约、转换记录与校验。
- `layout-core.js`、`layout-render.js`、`layout-client.js`：复杂布局识别、局部截图和转换范围证明。
- `sohu-format.js`、`toutiao-format.js`、`yidian-format.js`：平台可保存格式转换。
- `weibo.js`、`toutiao.js`、`yidian.js`、`other-platforms.js`：用户触发的页面适配器。
- `popup.js`、`matrix-cover.js`：选择准备包、目标页、上传及回读核对。
- `distribution-zip.js`：离线 ZIP 与本地预览。

命令行复用上述核心，不另写平台转换规则。`tools/layout-render-node.mjs` 提供独立无头浏览器截图，禁止截图过程访问远程 HTTP(S) 资源。

## 数据边界

导入时原稿与当前工作副本分开保存。平台包携带 `source-wechat.json`、原始素材与转换范围；重新分发可还原微信来源后生成新的平台包。正文或素材被改动后，原完整性报告不能直接沿用。

`bridge-client.js`、`bundle-locator.js`、`matrix-format.js` 和相关封面模块支持可选的本机矩阵集成。普通独立使用无需服务端或连接文件，详见 [可选集成](integrations.md)。
