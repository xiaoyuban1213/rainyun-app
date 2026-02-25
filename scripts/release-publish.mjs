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

function parseGitHubRepo(repo) {
  const val = String(repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  const [owner, name] = val.split("/");
  if (!owner || !name) return null;
  return { owner, repo: name };
}

async function githubRequest({ token, method, path, body, isJson = true }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "rainyun-app-release-script",
    Accept: "application/vnd.github+json"
  };
  if (isJson) headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body == null ? undefined : (isJson ? JSON.stringify(body) : body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} 失败: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function githubUploadAsset({ token, uploadUrlTemplate, filePath, fileName }) {
  const uploadUrl = uploadUrlTemplate.replace(/\{.*\}$/, "");
  const url = `${uploadUrl}?name=${encodeURIComponent(fileName)}`;
  const body = fs.readFileSync(filePath);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "rainyun-app-release-script",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/vnd.android.package-archive"
    },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub 上传资产失败: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function publishGitHubRelease({
  token,
  owner,
  repo,
  version,
  releaseNotes,
  apkFilePath,
  apkFileName,
  sha256,
  buildTime
}) {
  const tagName = process.env.GITHUB_TAG_NAME?.trim() || "release";
  const releaseName = process.env.GITHUB_RELEASE_NAME?.trim() || `RainYun-App-v${version}-release`;
  const makeLatest = String(process.env.GITHUB_RELEASE_LATEST || "true").toLowerCase() !== "false";
  const body = `${version} 发布日志` + "\n\n" + `${releaseNotes}` + "\n\n" + `- sha256: ${sha256}` + "\n" + `- buildTime: ${buildTime}`;

  let release = null;
  try {
    release = await githubRequest({
      token,
      method: "GET",
      path: `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tagName)}`
    });
  } catch (e) {
    if (!String(e.message).includes("404")) throw e;
  }

  if (!release) {
    release = await githubRequest({
      token,
      method: "POST",
      path: `/repos/${owner}/${repo}/releases`,
      body: {
        tag_name: tagName,
        name: releaseName,
        body,
        draft: false,
        prerelease: false,
        make_latest: makeLatest ? "true" : "false"
      }
    });
    console.log(`[ok] 已创建 GitHub Release: ${tagName}`);
  } else {
    release = await githubRequest({
      token,
      method: "PATCH",
      path: `/repos/${owner}/${repo}/releases/${release.id}`,
      body: {
        name: releaseName,
        body,
        draft: false,
        prerelease: false,
        make_latest: makeLatest ? "true" : "false"
      }
    });
    console.log(`[ok] 已更新 GitHub Release: ${tagName}`);
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const old = assets.find((a) => a && a.name === apkFileName);
  if (old?.id) {
    await githubRequest({
      token,
      method: "DELETE",
      path: `/repos/${owner}/${repo}/releases/assets/${old.id}`
    });
    console.log(`[ok] 已删除同名旧资产: ${apkFileName}`);
  }

  await githubUploadAsset({
    token,
    uploadUrlTemplate: release.upload_url,
    filePath: apkFilePath,
    fileName: apkFileName
  });
  console.log(`[ok] 已上传 GitHub Release 资产: ${apkFileName}`);
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

  const githubToken = process.env.GITHUB_TOKEN?.trim() || "";
  const githubRepoInput = process.env.GITHUB_REPO?.trim() || "";
  if (githubToken && githubRepoInput) {
    const parsed = parseGitHubRepo(githubRepoInput);
    if (!parsed) {
      throw new Error("GITHUB_REPO 格式错误，示例：xiaoyuban1213/rainyun-app");
    }
    await publishGitHubRelease({
      token: githubToken,
      owner: parsed.owner,
      repo: parsed.repo,
      version,
      releaseNotes,
      apkFilePath: apkOut,
      apkFileName: apkName,
      sha256,
      buildTime
    });
  } else {
    console.log("[skip] 未配置 GITHUB_TOKEN 或 GITHUB_REPO，跳过 GitHub Releases 同步。");
  }
}

main().catch((e) => {
  console.error("[release-publish] 失败:", e);
  process.exit(1);
});

