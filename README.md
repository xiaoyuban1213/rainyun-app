# 雨云 App Web（Vue 3）

移动端风格的雨云 Web App，已接入核心产品接口。

## 功能

- 底部导航：主页 / 推广中心 / 我的（固定 Tab）
- 主页：余额、积分、本月消费、代办事件、产品入口
- 产品：列表 + 详情（配置与监控信息）
- 我的：账号信息、头像、API 配置
- 推广中心：推广数据卡片（头像与“我的”同步）

## 技术栈

- Vue 3
- Vue Router 4
- Vite 5

## 快速开始（推荐）

```powershell
cd e:\github\雨云app
npm install
npm run dev
```

访问：`http://127.0.0.1:5173/#/home`

## 构建与预览

```powershell
npm run build
npm run preview
```

## 打包 Android APK（Capacitor）

前置要求：

- JDK 17+（必须，Java 8 无法构建）
- Android SDK / Build-Tools（建议安装 Android Studio）

已提供脚本：

```powershell
# 首次生成 Android 工程（只需一次）
npm run cap:add:android

# 同步 Web 资源到 Android
npm run cap:sync

# 打开 Android Studio
npm run android:open

# 直接命令行打 debug APK
npm run android:debug
```

APK 产物路径：

- `android/app/build/outputs/apk/debug/app-debug.apk`

## 一键发布并自动上传 S3

已提供脚本：`npm run release:publish`

脚本会自动执行：

1. `npm run cap:sync`（含 Web 构建）
2. `android/gradlew.bat assembleRelease`
3. 复制并命名 APK 为 `RainYun-App-v{APP_VERSION}-release.apk`
4. 计算 SHA256 并更新根目录 `latest.json`
5. 上传 APK 和 `latest.json` 到 S3 对象存储

需要的环境变量（PowerShell 示例）：

```powershell
$env:S3_ENDPOINT = "https://<your-s3-endpoint>"
$env:S3_REGION = "auto"
$env:S3_BUCKET = "<bucket-name>"
$env:S3_ACCESS_KEY_ID = "<access-key>"
$env:S3_SECRET_ACCESS_KEY = "<secret-key>"
$env:S3_PREFIX = "app"
$env:PUBLIC_BASE_URL = "http://ros.yuban.cloud"
$env:RELEASE_NOTES = "1.0.6 正式版：..."
npm run release:publish
```

说明：

- `S3_PREFIX` 默认为 `app`，最终会上传为 `app/latest.json` 和 `app/RainYun-App-vX.Y.Z-release.apk`
- `PUBLIC_BASE_URL` 用于生成 `latest.json.downloadUrl`
- `S3_FORCE_PATH_STYLE` 默认为 `true`（可选，设为 `false` 可关闭）

## 目录

- `index.html`：入口 HTML
- `app.js`：Vue 页面与路由逻辑
- `styles.css`：全局样式
- `sw.js`：Service Worker（当前缓存版本 `0.0.1`）
- `vite.config.js`：Vite 配置
- `package.json`：项目脚本与依赖
