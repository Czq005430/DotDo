# DotDo

DotDo 是一个极简的 macOS 悬浮待办应用，基于 Electron、Vite、React 和
Tailwind CSS 构建。它适合管理每天的小型任务清单，可以常驻桌面，又不会占用太多注意力。

## 下载

请在 [GitHub Releases](../../releases) 页面下载最新的 macOS 安装包。

第一版公开发布会提供未签名的 DMG 文件：

- Apple Silicon Mac：`DotDo-*-arm64.dmg`
- Intel Mac：`DotDo-*-x64.dmg`

因为当前版本暂未进行 Apple 签名和公证，macOS 可能会在首次启动时阻止打开。
如果遇到这种情况，请先尝试启动一次 DotDo，然后打开 **系统设置 > 隐私与安全性**，
为 DotDo 选择 **仍要打开**。

## 截图

第一版公开发布后，截图会补充到 `docs/assets/` 目录。

## 本地开发

```bash
npm install
npm run electron:dev
```

Vite 开发服务器会运行在 `5187` 端口，Electron 在开发模式下会加载这个本地服务。

## 构建

只构建 Web 静态资源：

```bash
npm run build:web
```

构建 macOS DMG 安装包：

```bash
npm run dist:mac
```

生成的安装包会输出到 `dist_electron/` 目录。

## 发布

当推送匹配 `v*` 的 Git tag 时，GitHub Actions 会自动构建发布产物：

```bash
git tag v1.0.0
git push origin v1.0.0
```

工作流会把生成的 DMG 和 blockmap 文件上传到对应的 GitHub Release。
第一版发布产物不签名，也不做 Apple 公证。

## 许可证

MIT
