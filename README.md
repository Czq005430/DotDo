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

## 本地开发

```bash
npm install
npm run electron:dev
```

Vite 开发服务器会运行在 `5187` 端口，Electron 在开发模式下会加载这个本地服务。

## 许可证

MIT
