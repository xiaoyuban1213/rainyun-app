# RainYun App Web

RainYun 移动端风格 Web App（Vue 3 + Capacitor），支持本地调试、Android 打包、`latest.json` 在线更新检测和 S3 自动发布。

## 主要功能

- 底部导航：`主页` / `推广中心` / `我的`（固定 Tab）
- 主页：余额、积分、本月消费、代办事项、产品入口
- 产品：列表与详情（基础状态、配置信息、监控信息）
- 我的：账号信息、头像、API Key 管理、关于弹窗
- 推广中心：推广数据、邀请链接、分享能力
- 客户端更新：读取 `latest.json` 检测新版本并跳转下载

## 技术栈

- `Vue 3`
- `Vue Router 4`
- `Arco Design Vue`
- `Vite 5`
- `Capacitor 7 (Android)`

## 环境要求

- `Node.js 18+`
- `npm 9+`
- `JDK 17+`（Android 构建）
- Android SDK（建议通过 Android Studio 安装）

## 本地开发

```powershell
npm install
npm run dev
```

默认访问：`http://127.0.0.1:5173/#/home`

## 构建 Web

```powershell
npm run build
npm run preview
```

## Android 开发与打包

```powershell
# 首次创建 Android 工程（仅一次）
npm run cap:add:android

# 同步 Web 资源到 Android（每次改完前端后执行）
npm run cap:sync

# 打开 Android Studio
npm run android:open

# 命令行调试包
npm run android:debug
```

常见产物路径：

- Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- Release APK：`android/app/build/outputs/apk/release/app-release.apk`

## 一键发布（构建 + 上传 S3）

脚本：`npm run release:publish`（`scripts/release-publish.mjs`）

自动流程：

1. 构建并同步 Web 资源（`cap:sync`）
2. 打包 Android Release APK
3. 生成版本文件名 `RainYun-App-v{APP_VERSION}-release.apk`
4. 计算 SHA256
5. 更新根目录 `latest.json`（保留 `history` 历史日志）
6. 上传 APK 与 `latest.json` 到 S3
7. 可选：同步创建/更新 GitHub Release 并上传 APK

PowerShell 示例：

```powershell
$env:S3_ENDPOINT = "https://<your-s3-endpoint>"
$env:S3_REGION = "auto"
$env:S3_BUCKET = "<bucket-name>"
$env:S3_ACCESS_KEY_ID = "<access-key>"
$env:S3_SECRET_ACCESS_KEY = "<secret-key>"
$env:S3_PREFIX = "app"
$env:PUBLIC_BASE_URL = "http://ros.yuban.cloud"
$env:RELEASE_NOTES = "1.0.x 发布说明..."
$env:GITHUB_TOKEN = "<github-personal-access-token>"
$env:GITHUB_REPO = "xiaoyuban1213/rainyun-app"
npm run release:publish
```

关键说明：

- `S3_PREFIX` 默认 `app`，最终对象如 `app/latest.json`、`app/RainYun-App-vX.Y.Z-release.apk`
- `PUBLIC_BASE_URL` 用于生成 `latest.json.downloadUrl`
- `S3_FORCE_PATH_STYLE` 默认 `true`（可选）
- 配置 `GITHUB_TOKEN` + `GITHUB_REPO` 后，会自动同步到 GitHub Releases
- `GITHUB_REPO` 支持 `owner/repo` 或完整 URL
- 可选参数：`GITHUB_TAG_NAME`、`GITHUB_RELEASE_NAME`、`GITHUB_RELEASE_LATEST`（默认 `true`）
- 默认 `GITHUB_TAG_NAME=release`，即持续更新同一个 Release

## `latest.json` 结构

顶层保留当前版本，`history` 保留历史版本：

```json
{
  "version": "1.0.7",
  "downloadUrl": "http://ros.yuban.cloud/app/RainYun-App-v1.0.7-release.apk",
  "notes": "更新说明",
  "sha256": "SHA256",
  "buildTime": "2026-02-25T03:22:24+08:00",
  "force": false,
  "history": [
    {
      "version": "1.0.7",
      "notes": "更新说明",
      "buildTime": "2026-02-25T03:22:24+08:00",
      "downloadUrl": "http://ros.yuban.cloud/app/RainYun-App-v1.0.7-release.apk",
      "sha256": "SHA256"
    }
  ]
}
```

## 目录结构

- `app.js`：核心页面、路由、数据逻辑
- `styles.css`：全局样式与响应式布局
- `index.html`：入口
- `sw.js`：Service Worker（缓存版本管理）
- `scripts/release-publish.mjs`：发布与上传脚本
- `latest.json`：更新源元数据
- `android/`：Capacitor Android 工程

## 安全与协作约定

- 仓库已通过 `.gitignore` 忽略 APK、密钥、环境文件、编辑器与构建缓存
- 不要提交 `keystore`、`local.properties`、`.env*`
- 发布前确认 `APP_VERSION`、`RELEASE_NOTES`、`latest.json` 是否一致



