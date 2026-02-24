import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ROOT = process.cwd();
const ANDROID_DIR = path.join(ROOT, "android");
const RELEASE_APK = path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk");

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return String(v).trim();
}

function readVersionFromAppJs() {
  const file = path.join(ROOT, "app.js");
  const code = fs.readFileSync(file, "utf8");
  const m = code.match(/const\s+APP_VERSION\s*=\s*"([^"]+)"/);
  if (!m) {
    throw new Error("无法从 app.js 读取 APP_VERSION");
  }
  return m[1];
}

function run(cmd, cwd = ROOT) {
  console.log(`[run] ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

function hashSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").toUpperCase();
}

function formatIsoWithOffset(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offH = pad(Math.floor(abs / 60));
  const offM = pad(abs % 60);
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`;
}

function joinUrl(base, key) {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

function normalizePrefix(prefix) {
  const p = String(prefix || "").trim().replace(/^\/+|\/+$/g, "");
  return p ? `${p}/` : "";
}

function readExistingLatest(latestPath) {
  if (!fs.existsSync(latestPath)) return {};
  try {
    const raw = fs.readFileSync(latestPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeHistoryItem(item) {
  if (!item || typeof item !== "object") return null;
  const version = String(item.version || "").trim();
  if (!version) return null;
  return {
    version,
    notes: String(item.notes || "").trim(),
    buildTime: String(item.buildTime || "").trim(),
    downloadUrl: String(item.downloadUrl || "").trim(),
    sha256: String(item.sha256 || "").trim()
  };
}

function buildHistory(existingLatest, current, maxItems = 20) {
  const history = [];
  const add = (x) => {
    const n = normalizeHistoryItem(x);
    if (!n) return;
    if (!history.some((h) => h.version === n.version)) {
      history.push(n);
    }
  };

  add(current);
  if (Array.isArray(existingLatest.history)) {
    for (const item of existingLatest.history) add(item);
  }
  add(existingLatest);

  return history.slice(0, maxItems);
}

async function uploadToS3({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, key, filePath, contentType }) {
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey }
  });
  const body = fs.readFileSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
}

async function main() {
  const version = readVersionFromAppJs();
  const apkName = `RainYun-App-v${version}-release.apk`;
  const apkOut = path.join(ROOT, apkName);

  const endpoint = mustEnv("S3_ENDPOINT");
  const bucket = mustEnv("S3_BUCKET");
  const accessKeyId = mustEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = mustEnv("S3_SECRET_ACCESS_KEY");
  const publicBaseUrl = mustEnv("PUBLIC_BASE_URL");
  const region = process.env.S3_REGION?.trim() || "auto";
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false";
  const prefix = normalizePrefix(process.env.S3_PREFIX || "app");
  const releaseNotes = (process.env.RELEASE_NOTES || "").trim() || `${version} 发布版：自动打包并上传。`;

  run("npm run cap:sync");
  const gradleCmd = process.platform === "win32" ? "gradlew.bat assembleRelease" : "./gradlew assembleRelease";
  run(gradleCmd, ANDROID_DIR);

  if (!fs.existsSync(RELEASE_APK)) {
    throw new Error(`未找到 APK: ${RELEASE_APK}`);
  }

  fs.copyFileSync(RELEASE_APK, apkOut);
  const sha256 = hashSha256(apkOut);
  const buildTime = formatIsoWithOffset(new Date());

  const apkKey = `${prefix}${apkName}`;
  const latestKey = `${prefix}latest.json`;
  const downloadUrl = joinUrl(publicBaseUrl, apkKey);

  const latestPath = path.join(ROOT, "latest.json");
  const existingLatest = readExistingLatest(latestPath);
  const currentRelease = {
    version,
    downloadUrl,
    notes: releaseNotes,
    sha256,
    buildTime,
    force: false
  };
  const latest = {
    ...currentRelease,
    history: buildHistory(existingLatest, currentRelease)
  };
  fs.writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");

  await uploadToS3({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    key: apkKey,
    filePath: apkOut,
    contentType: "application/vnd.android.package-archive"
  });
  console.log(`[ok] 已上传 ${apkKey}`);

  await uploadToS3({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    key: latestKey,
    filePath: latestPath,
    contentType: "application/json; charset=utf-8"
  });
  console.log(`[ok] 已上传 ${latestKey}`);
  console.log(`[done] version=${version}`);
  console.log(`[done] downloadUrl=${downloadUrl}`);
  console.log(`[done] sha256=${sha256}`);
}

main().catch((e) => {
  console.error("[release-publish] 失败:", e);
  process.exit(1);
});
