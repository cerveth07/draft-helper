# 上传开源仓库

此目录已整理为仓库根目录。源码 ZIP 用于传输源码，独立扩展 ZIP 用于普通使用者安装；不要把扩展 ZIP 当作整个仓库源码上传。

## 使用 Git

在 GitHub 等服务创建一个空仓库；若使用下列首次上传命令，先不要在远程生成 README 或 LICENSE。

在本目录打开终端，将 `YOUR_REPOSITORY_GIT_URL` 替换为自己的仓库地址：

```sh
git init -b main
git add .
git status --short
git commit -m "Initial open-source release of SyncPress"
git remote add origin YOUR_REPOSITORY_GIT_URL
git push -u origin main
```

此操作由维护者自行执行。项目的检查和打包命令不会初始化 Git、提交或推送代码。

## 使用网页上传

解压源码 ZIP，将其中 `draft-helper/` 下的内容放到仓库根目录，确认 README、LICENSE、`extension/`、`tools/`、`examples/` 和 `.github/` 均上传。以点开头的文件和目录也要保留。不要连同整个外层目录嵌套一层。

## 发布安装包

```sh
npm ci
npm run check
npm test
npm run release:pack
```

需要浏览器验收时先执行 `npx playwright-core install chromium` 和 `npm run test:browser`。生成结果位于 `dist/`，分别为源码 ZIP 和独立扩展 ZIP，可由维护者手动附到 Release。扩展商店上架及其审核不是本项目打包流程的一部分。

`.gitignore` 排除了依赖、构建包、运行数据和常见凭证文件。发布脚本还使用明确文件清单；不要直接压缩现用工作目录。

许可证为 MIT，版权署名是 `SyncPress contributors`。第三方许可随对应文件保留。仓库创建后可在设置中开启私密漏洞反馈；其他仓库信息可由维护者按实际情况补充。
