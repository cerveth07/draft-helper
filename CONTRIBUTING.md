# 贡献指南

欢迎修复平台适配、完善兼容日志与改进可访问性。提交前请保留准备包契约、来源证明和既有用户数据的兼容性。

## 环境与检查

Node.js 22+，npm；浏览器检查另外需要 Chromium。

```sh
npm ci
npm run check
npm test
npx playwright-core install chromium
npm run test:browser
```

默认单元测试只使用自制内容或模拟接口，不需要平台账号。浏览器套件使用隔离临时配置文件、合成编辑器和本地素材；不要替换成日常浏览器的登录配置文件。

检查证据默认写到系统临时目录；可用 `DRAFT_HELPER_TEST_OUTPUT` 指向仓库外目录。无浏览器依赖时可使用 `npm ci --omit=optional` 运行静态检查和单元测试。若指定已有 Playwright 模块，使用 `DRAFT_HELPER_PLAYWRIGHT_MODULE`；命令行截图可用 `DRAFT_HELPER_BROWSER_PATH` 指定 Chrome / Chromium。

## 外部素材回归

以下检查需要用户提供素材，默认测试及 CI 不执行，也不把素材纳入发布包：

- `npm run test:authoring-packages -- /path/to/authorized-package`：读取用户有权使用的准备包，检查工作台恢复和对照预览。
- `extension/tests/fidelity-sample.browser.cjs`、`matrix-workbench.browser.cjs`、`matrix-studio.browser.cjs`：额外样稿与集成验收脚本，按脚本要求提供输入；不属于默认套件。其中来源稿保真脚本可能下载样稿所引用的微信 CDN 图片。

## 修改原则

- 新增有损压缩、图片整合、省略或样式降级时，必须保留来源，并写入工作台及包内的逐项处理日志。
- 不静默截断标题、改写正文、减帧或将 GIF 转为静图。
- 填入必须由用户选择目标页并触发；保持旧稿防覆盖、正文和图片回读检查，不增加自动保存或发布。
- 不加入真实稿件、截图、二维码资产、浏览器配置、Cookie 或本机连接文件。测试使用合成页面和自行制作的图片。
- 若更新第三方组件，保留其版权与许可证，并同步第三方声明。

## 提交 PR

说明触发场景、用户看到的前后差异与相关验证。测试涉及平台模拟页面时，应明确区分本地结果与实站结果。提交代码表示同意按本项目 MIT 许可贡献该部分，并确认自己有权贡献；第三方代码应保留原许可。

## 本地打包

```sh
npm run release:pack
```

生成的源码 ZIP 和扩展 ZIP 保存在 `dist/`，不会自动提交、上传仓库或发布到扩展商店。扩展包包含第一方许可证和 Marked 声明；源码包额外包含测试、示例、CI 与开发文档。
