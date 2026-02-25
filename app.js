import { createApp, reactive, computed, ref, onMounted, watch } from "vue";
import { createRouter, createWebHashHistory, useRouter, useRoute } from "vue-router";
import { Capacitor } from "@capacitor/core";
import AButton from "@arco-design/web-vue/es/button";
import AInput from "@arco-design/web-vue/es/input";
import ATag from "@arco-design/web-vue/es/tag";
import ATypography from "@arco-design/web-vue/es/typography";
import "@arco-design/web-vue/es/button/style/css.js";
import "@arco-design/web-vue/es/input/style/css.js";
import "@arco-design/web-vue/es/tag/style/css.js";
import "@arco-design/web-vue/es/typography/style/css.js";

const BRAND_LOGO = "https://cdn.apifox.com/app/project-icon/custom/20231116/e416b172-004f-452f-8090-8e85991f422c.png";
const AVATAR = "https://i.pravatar.cc/120?img=32";
const APP_VERSION = "1.0.8";
const UPDATE_BASE_URL = "http://ros.yuban.cloud/app";
const UPDATE_FEED_URL = `${UPDATE_BASE_URL}/latest.json`;
let navOriginTrackerInited = false;

function setNavOrigin(clientX, clientY) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const app = document.querySelector(".mobile-app");
  if (app) {
    const rect = app.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const shiftX = (cx - x) * 0.06;
    const shiftY = (cy - y) * 0.06;
    root.style.setProperty("--nav-origin-x", `${x}px`);
    root.style.setProperty("--nav-origin-y", `${y}px`);
    root.style.setProperty("--nav-shift-x", `${shiftX.toFixed(2)}px`);
    root.style.setProperty("--nav-shift-y", `${shiftY.toFixed(2)}px`);
    return;
  }
  root.style.setProperty("--nav-origin-x", `${Math.max(0, clientX)}px`);
  root.style.setProperty("--nav-origin-y", `${Math.max(0, clientY)}px`);
  root.style.setProperty("--nav-shift-x", "0px");
  root.style.setProperty("--nav-shift-y", "0px");
}

function initNavOriginTracker() {
  if (typeof window === "undefined") return;
  if (navOriginTrackerInited) return;
  navOriginTrackerInited = true;
  const setCenter = () => {
    if (typeof document === "undefined") return;
    const app = document.querySelector(".mobile-app");
    if (app) {
      const rect = app.getBoundingClientRect();
      setNavOrigin(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else {
      setNavOrigin(window.innerWidth / 2, window.innerHeight / 2);
    }
  };
  const onPointerDown = (e) => setNavOrigin(e.clientX, e.clientY);
  const onTouchStart = (e) => {
    if (!e.touches || !e.touches.length) return;
    const t = e.touches[0];
    setNavOrigin(t.clientX, t.clientY);
  };
  setCenter();
  window.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
  window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  window.addEventListener("resize", setCenter, { passive: true });
}

const store = reactive({
  auth: loadAuth(),
  loading: false,
  summary: { domain: [], rca: [], rcs: [], ssl_order: [] },
  summarySource: "",
  rawSummary: null,
  userProfile: null,
  userCoupons: [],
  homeNews: [],
  lastSyncAt: ""
});
let summaryInflightPromise = null;
const apiGetCache = new Map();
const apiGetInflight = new Map();
const API_GET_DEFAULT_TTL = 8000;

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function reportLog(level, event, detail = {}) {
  if (typeof console === "undefined") return;
  const payload = { level, event, detail, at: new Date().toISOString() };
  if (level === "ERROR") {
    console.error("[rainyun-app]", payload);
  } else if (level === "WARN") {
    console.warn("[rainyun-app]", payload);
  } else {
    console.log("[rainyun-app]", payload);
  }
}

function loadAuth() {
  try {
    const raw = localStorage.getItem("rainyun-auth");
    if (!raw) return { baseUrl: "https://api.v2.rainyun.com", apiKey: "", devToken: "" };
    const v = JSON.parse(raw);
    return {
      baseUrl: v.baseUrl || "https://api.v2.rainyun.com",
      apiKey: v.apiKey || "",
      devToken: v.devToken || ""
    };
  } catch {
    return { baseUrl: "https://api.v2.rainyun.com", apiKey: "", devToken: "" };
  }
}

function saveAuth(nextAuth) {
  store.auth = {
    baseUrl: (nextAuth.baseUrl || "https://api.v2.rainyun.com").trim(),
    apiKey: (nextAuth.apiKey || "").trim(),
    devToken: (nextAuth.devToken || "").trim()
  };
  localStorage.setItem("rainyun-auth", JSON.stringify(store.auth));
  apiGetCache.clear();
  apiGetInflight.clear();
  reportLog("INFO", "auth_saved", { hasApiKey: Boolean(store.auth.apiKey), hasDevToken: Boolean(store.auth.devToken) });
}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (store.auth.apiKey) h["x-api-key"] = store.auth.apiKey;
  if (store.auth.devToken) h["rain-dev-token"] = store.auth.devToken;
  return h;
}

function normalizeSummary(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    domain: list(data.domain),
    rca: list(data.rca),
    rcs: list(data.rcs),
    ssl_order: list(data.ssl_order)
  };
}

function summaryIsEmpty(s) {
  return !s.domain.length && !s.rca.length && !s.rcs.length && !s.ssl_order.length;
}

function normalizeAssetUrl(url) {
  if (!url) return "";
  const v = String(url).trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.startsWith("//")) return `https:${v}`;
  if (v.startsWith("/")) return `https://api.v2.rainyun.com${v}`;
  return v;
}

function pickFirstFieldDeep(input, keys, maxDepth = 4) {
  if (!input || typeof input !== "object") return "";
  const keySet = new Set(keys.map((k) => String(k).toLowerCase()));
  const queue = [{ node: input, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    for (const [k, v] of Object.entries(node)) {
      if (keySet.has(String(k).toLowerCase()) && v !== null && v !== undefined && v !== "") {
        return v;
      }
    }
    if (depth >= maxDepth) continue;
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") queue.push({ node: v, depth: depth + 1 });
    }
  }
  return "";
}

function pickByAlias(input, aliases, fallback = "-") {
  const v = pickFirstFieldDeep(input, aliases);
  if (v === "" || v === null || v === undefined) return fallback;
  return v;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(v) {
  const n = toNumberOrNull(v);
  return n === null ? "-" : `¥ ${n.toFixed(2)}`;
}

function formatCount(v) {
  const n = toNumberOrNull(v);
  return n === null ? "-" : String(Math.floor(n));
}

function formatFixed2(v) {
  const n = toNumberOrNull(v);
  return n === null ? String(v ?? "-") : n.toFixed(2);
}

function formatDate(v) {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (Number.isFinite(n)) {
    const ms = n > 1000000000000 ? n : (n > 1000000000 ? n * 1000 : n);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}年${m}月${day}日`;
    }
  }
  const d = new Date(String(v));
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}年${m}月${day}日`;
  }
  return String(v);
}

function formatDateTime(v) {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  let d;
  if (Number.isFinite(n)) {
    const ms = n > 1000000000000 ? n : (n > 1000000000 ? n * 1000 : n);
    d = new Date(ms);
  } else {
    d = new Date(String(v));
  }
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function normalizeVersion(v) {
  return String(v || "").trim().replace(/^v/i, "");
}

function compareVersion(a, b) {
  const pa = normalizeVersion(a).split(".").map((x) => Number(x));
  const pb = normalizeVersion(b).split(".").map((x) => Number(x));
  const validA = pa.length && pa.every((n) => Number.isFinite(n));
  const validB = pb.length && pb.every((n) => Number.isFinite(n));
  if (validA && validB) {
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }
  const sa = normalizeVersion(a);
  const sb = normalizeVersion(b);
  if (sa === sb) return 0;
  return sa > sb ? 1 : -1;
}

function pickUpdateField(payload, keys) {
  const v = pickFirstFieldDeep(payload, keys);
  return v === null || v === undefined ? "" : String(v);
}

function toAbsoluteUrl(url, base) {
  if (!url) return "";
  const raw = String(url).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `http:${raw}`;
  if (raw.startsWith("/")) {
    try {
      const u = new URL(base);
      return `${u.protocol}//${u.host}${raw}`;
    } catch {
      return raw;
    }
  }
  return `${String(base).replace(/\/$/, "")}/${raw.replace(/^\.\//, "")}`;
}

function apiGetCacheKey(path) {
  return `${String(store.auth.baseUrl || "").trim()}|${String(store.auth.apiKey || "").trim()}|${path}`;
}

async function apiGet(path, options = {}) {
  const force = Boolean(options.force);
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Math.max(0, Number(options.ttlMs)) : API_GET_DEFAULT_TTL;
  const key = apiGetCacheKey(path);

  if (!force && ttlMs > 0) {
    const cached = apiGetCache.get(key);
    if (cached && Date.now() - cached.at < ttlMs) {
      return cached.payload;
    }
  }

  if (!force && apiGetInflight.has(key)) {
    return apiGetInflight.get(key);
  }

  const p = apiRequest("GET", path)
    .then((payload) => {
      if (ttlMs > 0) {
        apiGetCache.set(key, { at: Date.now(), payload });
      }
      return payload;
    })
    .finally(() => {
      apiGetInflight.delete(key);
    });

  apiGetInflight.set(key, p);
  return p;
}

async function apiRequest(method, path, body) {
  const configuredBase = String(store.auth.baseUrl || "").trim().replace(/\/$/, "");
  const baseCandidates = [configuredBase, "https://api.v2.rainyun.com"].filter(Boolean);
  const baseList = [...new Set(baseCandidates)];
  const options = { method, headers: authHeaders() };
  if (body !== undefined) options.body = JSON.stringify(body);

  let lastError = null;
  for (const base of baseList) {
    const url = `${base}${path}`;
    try {
      reportLog("INFO", "api_request_start", { method, url });
      const res = await fetch(url, options);
      const text = await res.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
        for (let i = 0; i < 2 && typeof payload === "string"; i += 1) {
          const t = String(payload).trim();
          if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
            payload = JSON.parse(t);
          } else {
            break;
          }
        }
      } catch {
        payload = { raw: text };
      }
      reportLog("INFO", "api_request_done", { method, url, status: res.status, code: payload.code });
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      return payload;
    } catch (e) {
      lastError = e;
      reportLog("WARN", "api_request_retry", { method, base, error: String(e) });
    }
  }

  throw new Error(`网络请求失败，请检查 Base URL/网络：${String(lastError || "unknown")}`);
}

async function refreshSummary(force = false) {
  if (!store.auth.apiKey) return;
  if (!force && store.rawSummary && store.userProfile) return;
  if (summaryInflightPromise) return summaryInflightPromise;
  if (force) {
    apiGetCache.clear();
  }

  summaryInflightPromise = (async () => {
    store.loading = true;
    try {
      const [userRes, couponRes, newsRes, productRes] = await Promise.allSettled([
        apiGet("/user/", { force, ttlMs: 15000 }),
        apiGet("/user/coupons/", { force, ttlMs: 10000 }),
        apiGet("/news", { force, ttlMs: 10000 }),
        apiGet("/product/", { force, ttlMs: 10000 })
      ]);

      if (userRes.status === "fulfilled") {
        const userPayload = userRes.value;
        store.userProfile = userPayload && userPayload.data ? userPayload.data : userPayload;
      } else {
        reportLog("WARN", "user_profile_load_error", { error: String(userRes.reason) });
      }

      if (couponRes.status === "fulfilled") {
        const couponData = extractPayloadData(couponRes.value);
        store.userCoupons = Array.isArray(couponData) ? couponData : [];
      } else {
        store.userCoupons = [];
        reportLog("WARN", "user_coupons_load_error", { error: String(couponRes.reason) });
      }

      if (newsRes.status === "fulfilled") {
        const newsData = extractPayloadData(newsRes.value);
        store.homeNews = Array.isArray(newsData) ? newsData : [];
      } else {
        store.homeNews = [];
        reportLog("WARN", "home_news_load_error", { error: String(newsRes.reason) });
      }

      if (productRes.status !== "fulfilled") {
        throw productRes.reason || new Error("产品列表请求失败");
      }

      const p1 = productRes.value;
      let s = normalizeSummary(p1);
      let source = "/product/";

      if (summaryIsEmpty(s)) {
        const p2 = await apiGet("/product/id_list", { force, ttlMs: 10000 });
        const s2 = normalizeSummary(p2);
        if (!summaryIsEmpty(s2)) {
          s = s2;
          source = "/product/id_list";
          store.rawSummary = p2;
        } else {
          store.rawSummary = p1;
        }
      } else {
        store.rawSummary = p1;
      }

      store.summary = s;
      store.summarySource = source;
      store.lastSyncAt = new Date().toLocaleTimeString();
      if (summaryIsEmpty(s)) {
        toast("当前账号暂无产品数据");
      }
    } catch (e) {
      toast(String(e));
      reportLog("ERROR", "summary_load_error", { error: String(e) });
    } finally {
      store.loading = false;
      summaryInflightPromise = null;
    }
  })();

  return summaryInflightPromise;
}

function getKindLabel(kind) {
  const map = { rcs: "云服务器", rca: "云应用", domain: "域名服务", ssl_order: "SSL证书" };
  return map[kind] || kind;
}

function extractPayloadData(payload) {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object") return parsed.data;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return {};
    }
  }
  if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object") return payload.data;
  if (payload && typeof payload === "object") return payload;
  return {};
}

function extractUpdateInfo(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const version = pickUpdateField(p, ["version", "latestVersion", "tag_name"]);
  const notes = pickUpdateField(p, ["notes", "body"]);
  let downloadUrl = pickUpdateField(p, ["downloadUrl", "url", "html_url", "browser_download_url"]);
  if (!downloadUrl) {
    const assets = p.assets;
    if (Array.isArray(assets) && assets.length && assets[0] && typeof assets[0] === "object") {
      downloadUrl = pickUpdateField(assets[0], ["browser_download_url", "downloadUrl", "url"]);
    }
  }
  return {
    version: normalizeVersion(version),
    notes: notes || "",
    downloadUrl: toAbsoluteUrl(downloadUrl, UPDATE_BASE_URL)
  };
}

function hasUpdateVersionField(payload) {
  if (!payload || typeof payload !== "object") return false;
  const v = pickFirstFieldDeep(payload, ["version", "latestVersion", "tag_name"]);
  return v !== "" && v !== null && v !== undefined;
}

function formatDisplayValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (typeof v === "number") return formatFixed2(v);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (v.every((x) => x === null || x === undefined || ["string", "number", "boolean"].includes(typeof x))) {
      return v.slice(0, 6).map((x) => (typeof x === "number" ? formatFixed2(x) : String(x))).join(", ");
    }
    const first = v[0];
    if (first && typeof first === "object") {
      const keys = Object.keys(first).slice(0, 3).join(", ");
      return `共${v.length}项${keys ? `（字段: ${keys}）` : ""}`;
    }
    return `共${v.length}项`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v);
    const brief = ["name", "status", "id", "plan_name", "chinese_name", "region", "ip"].map((k) => v[k]).filter(Boolean);
    if (brief.length) return brief.slice(0, 3).join(" / ");
    return keys.length ? `对象(${keys.length}字段)` : "{}";
  }
  return String(v);
}

function toDisplayRows(obj, limit = 16) {
  if (!obj || typeof obj !== "object") return [];
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    rows.push({ key: k, value: formatDisplayValue(v) });
    if (rows.length >= limit) break;
  }
  return rows;
}

function toNumericMetrics(obj, limit = 8) {
  if (!obj || typeof obj !== "object") return [];
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number") {
      rows.push({ key: k, value: Number.isFinite(v) ? formatFixed2(v) : "-" });
    } else if (typeof v === "string" && v && !Number.isNaN(Number(v))) {
      rows.push({ key: k, value: formatFixed2(v) });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = toNumericMetrics(v, limit - rows.length);
      for (const item of nested) rows.push({ key: `${k}.${item.key}`, value: item.value });
    }
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 ** 2).toFixed(2)} MB/s`;
}

function buildDetailView(kind, id, detailData, monitorData) {
  const detailEnvelope = detailData && typeof detailData === "object" ? detailData : {};
  const dataRoot = detailData && typeof detailData === "object" && detailData.Data && typeof detailData.Data === "object"
    ? detailData.Data
    : detailData;
  const pick = (...keys) => {
    for (const key of keys) {
      const val = pickFirstFieldDeep(dataRoot, [key]);
      if (val !== "" && val !== undefined && val !== null) return val;
    }
    return "";
  };
  const status = pick("Status", "status", "state", "run_status", "running_status");
  const name = pick("OsName", "name", "title", "server_name", "hostname", "HostName");
  const region = pick("Region", "region_name", "zone_name", "region", "zone", "area");
  const ip = pick("NatPublicIP", "MainIPv4", "IP", "ip", "public_ip", "ipv4", "main_ip");
  const spec = pick("plan_name", "PlanName", "spec", "cpu_model", "config");
  const expireRaw = pick("ExpDate", "expired_at", "expire_at", "end_time", "due_time");
  const expireAt = Number(expireRaw) > 1000000000 ? new Date(Number(expireRaw) * 1000).toLocaleString() : (expireRaw || "-");

  if (kind === "rcs") {
    const d = dataRoot || {};
    const plan = d.Plan || {};
    const node = d.Node || {};
    const usage = d.UsageData || {};
    // RCS detail response places these arrays at data root (same level as Data), not inside Data.
    const rbsList = Array.isArray(detailEnvelope.RBSList) ? detailEnvelope.RBSList : (Array.isArray(d.RBSList) ? d.RBSList : []);
    const eDiskList = Array.isArray(detailEnvelope.EDiskList) ? detailEnvelope.EDiskList : (Array.isArray(d.EDiskList) ? d.EDiskList : []);
    const eipList = Array.isArray(detailEnvelope.EIPList) ? detailEnvelope.EIPList : (Array.isArray(d.EIPList) ? d.EIPList : []);
    const vnets = Array.isArray(detailEnvelope.VNets) ? detailEnvelope.VNets : (Array.isArray(d.VNets) ? d.VNets : []);
    const ipv6 = eipList.find((x) => String(x.Type || "").toLowerCase().includes("ipv6"));
    const showIp = (ipv6 && ipv6.IP) || d.NatPublicIP || d.MainIPv4 || "-";
    const baseInfo = [
      { key: "产品类型", value: "云服务器" },
      { key: "产品ID", value: String(id) },
      { key: "名称", value: d.OsName || d.HostName || "-" },
      { key: "状态", value: d.Status || "-" },
      { key: "地域", value: node.Region || "-" },
      { key: "公网IP", value: showIp },
      { key: "配置", value: plan.plan_name || "-" },
      { key: "到期时间", value: expireAt }
    ];
    const configRows = [
      { key: "CPU", value: `${String(d.CPU ?? plan.cpu ?? "-")} 核` },
      { key: "内存", value: `${String(d.Memory ?? plan.memory ?? "-")} MB` },
      { key: "系统盘", value: `${String(d.Disk ?? "-")} GB` },
      { key: "上行带宽", value: `${String(d.NetIn ?? plan.net_in ?? "-")} Mbps` },
      { key: "下行带宽", value: `${String(d.NetOut ?? plan.net_out ?? "-")} Mbps` },
      { key: "系统", value: d.OsInfo?.chinese_name || d.OsName || "-" },
      { key: "可用区", value: d.Zone || "-" },
      { key: "备份数量", value: `${String(rbsList.length)} 个` },
      { key: "数据盘", value: `${String(eDiskList.length)} 个` },
      { key: "IP数量", value: `${String(eipList.length)} 个` },
      { key: "私有网络", value: `${String(vnets.length)} 个` }
    ];
    const monitorRows = [
      { key: "CPU(%)", value: usage.CPU === undefined ? "-" : Number(usage.CPU).toFixed(2) },
      {
        key: "内存使用",
        value: usage.FreeMem !== undefined && usage.MaxMem !== undefined
          ? `${formatBytes(Math.max(0, usage.MaxMem - usage.FreeMem))} / ${formatBytes(usage.MaxMem)}`
          : "-"
      },
      { key: "磁盘读速率", value: usage.DiskRead === undefined ? "-" : formatRate(usage.DiskRead) },
      { key: "磁盘写速率", value: usage.DiskWrite === undefined ? "-" : formatRate(usage.DiskWrite) },
      { key: "上行速率", value: usage.NetOut === undefined ? "-" : formatRate(usage.NetOut) },
      { key: "下行速率", value: usage.NetIn === undefined ? "-" : formatRate(usage.NetIn) }
    ];
    const chargeType = String(plan.charge_type || "").toLowerCase();
    const hasTrafficBase = Number(plan.traffic_base_gb || 0) > 0;
    const hasTrafficPrice = !!(plan.traffic_price && typeof plan.traffic_price === "object" && Object.keys(plan.traffic_price).length);
    const isTrafficMetered = chargeType.includes("traffic") || hasTrafficBase || hasTrafficPrice;

    const serverInfo = {
      id: String(d.ID || id),
      tag: d.Tag && String(d.Tag).trim() ? String(d.Tag) : "未设定",
      status: d.Status || "-",
      node: node.ChineseName || d.Zone || node.Region || "-",
      expireAt,
      showTraffic: isTrafficMetered,
      trafficLeft: d.TrafficBytes !== undefined ? formatBytes(d.TrafficBytes) : "-"
    };
    return { baseInfo, serverInfo, configRows, monitorRows };
  }

  if (kind === "rca") {
    const d = dataRoot || {};
    const usage = d.usage_data || {};
    const maxCpuRaw = Number(d.resource_limits?.max_cpu);
    const maxMemoryRaw = Number(d.resource_limits?.max_memory);
    const cpuReadable = Number.isFinite(maxCpuRaw) && maxCpuRaw > 1000
      ? `${(maxCpuRaw / 1000).toFixed(2)} 核 (${maxCpuRaw} mCPU)`
      : (Number.isFinite(maxCpuRaw) ? `${maxCpuRaw.toFixed(2)} 核` : "-");
    const memoryReadable = Number.isFinite(maxMemoryRaw)
      ? (maxMemoryRaw >= 1024 ? `${maxMemoryRaw} MB (~${(maxMemoryRaw / 1024).toFixed(2)} GB)` : `${maxMemoryRaw} MB`)
      : "-";

    const baseInfo = [
      { key: "产品类型", value: "云应用" },
      { key: "产品ID", value: String(id) },
      { key: "名称", value: d.name || "-" },
      { key: "状态", value: d.Status || "-" },
      { key: "地域", value: d.region?.name || "-" },
      { key: "公网IP", value: "-" },
      { key: "配置", value: d.charge_type || "-" },
      { key: "到期时间", value: expireAt }
    ];
    const configRows = [
      { key: "namespace", value: d.namespace || "-" },
      { key: "CPU上限", value: cpuReadable },
      { key: "内存上限", value: memoryReadable },
      { key: "存储空间", value: d.volume_size === undefined ? "-" : `${d.volume_size} GB` },
      { key: "小时费用", value: d.hourly_price === undefined ? "-" : `${formatMoney(d.hourly_price)} / 小时` },
      { key: "下次计费", value: formatDateTime(d.next_charge_time) }
    ];
    const monitorRows = [
      { key: "CPU", value: usage.cpu === undefined ? "-" : `${formatFixed2(usage.cpu)} %` },
      { key: "内存占用", value: usage.memory === undefined ? "-" : formatBytes(usage.memory) },
      { key: "今日流量", value: usage.traffic_today === undefined ? "-" : formatBytes(usage.traffic_today) },
      { key: "应用数量", value: usage.app_count === undefined ? "-" : String(usage.app_count) },
      { key: "健康实例", value: usage.healthy_pods === undefined ? "-" : `${usage.healthy_pods}/${usage.app_count ?? "-"}` }
    ];
    const serverInfo = {
      id: String(d.ID || id),
      tag: d.Tag && String(d.Tag).trim() ? String(d.Tag) : "未设定",
      status: d.Status || "-",
      node: d.region?.chinese_name || d.region?.name || "-",
      expireAt,
      showTraffic: false,
      trafficLeft: "-"
    };
    return { baseInfo, serverInfo, configRows, monitorRows };
  }

  if (kind === "domain") {
    const d = dataRoot || {};
    const domainName = String(
      pickFirstFieldDeep(d, ["domain", "DomainName", "Domain", "domain_name", "name"]) || "-"
    );
    const statusRaw = String(
      pickFirstFieldDeep(d, ["status", "Status", "state", "verify_status"]) || "-"
    );
    const statusMap = {
      ok: "正常",
      running: "正常",
      hold: "暂停",
      clienthold: "暂停",
      serverhold: "暂停",
      pending: "处理中"
    };
    const domainStatus = statusMap[statusRaw.toLowerCase()] || statusRaw;
    const isDefaultNs = !!pickFirstFieldDeep(d, ["is_default_nameservers"]);
    const dnsProvider = isDefaultNs ? "默认DNS" : "自定义DNS";
    const nsList = Array.isArray(d.name_servers) && d.name_servers.length
      ? d.name_servers
      : (Array.isArray(detailEnvelope.dns_hosts) ? detailEnvelope.dns_hosts : []);
    const nsValue = nsList.length ? nsList.join(", ") : "-";
    const lockRaw = pickFirstFieldDeep(d, ["is_locked", "Lock", "DomainLock", "domain_lock", "lock"]);
    const expireNoticeRaw = pickFirstFieldDeep(d, ["expire_notice"]);
    const icpRaw = pickFirstFieldDeep(d, ["site_license", "SiteLicense", "ICP", "icp", "beian", "备案号"]);
    const regDate = formatDateTime(pickFirstFieldDeep(d, ["reg_date", "register_time"]));
    const domainExpireAt = formatDateTime(pickFirstFieldDeep(d, ["exp_date", "expire_at", "expired_at"]));

    const yesNo = (v) => {
      if (v === "" || v === null || v === undefined) return "-";
      const s = String(v).toLowerCase();
      if (s === "1" || s === "true" || s === "yes" || s === "open") return "是";
      if (s === "0" || s === "false" || s === "no" || s === "close") return "否";
      return String(v);
    };

    const baseInfo = [
      { key: "产品类型", value: "域名服务" },
      { key: "产品ID", value: String(id) },
      { key: "域名", value: domainName },
      { key: "状态", value: String(domainStatus) },
      { key: "DNS 模式", value: String(dnsProvider) },
      { key: "到期时间", value: domainExpireAt || "-" }
    ];

    const configRows = [
      { key: "域名", value: String(domainName) },
      { key: "DNS", value: String(dnsProvider) },
      { key: "NS", value: formatDisplayValue(nsValue) || "-" },
      { key: "注册时间", value: regDate || "-" },
      { key: "到期时间", value: domainExpireAt || "-" },
      { key: "到期提醒", value: yesNo(expireNoticeRaw) },
      { key: "域名锁", value: yesNo(lockRaw) },
      { key: "备案号", value: icpRaw ? String(icpRaw) : "-" }
    ];

    return { baseInfo, configRows, monitorRows: [] };
  }

  const baseInfo = [
    { key: "产品类型", value: getKindLabel(kind) },
    { key: "产品ID", value: id },
    { key: "名称", value: name || "-" },
    { key: "状态", value: status || "-" },
    { key: "地域", value: region || "-" },
    { key: "公网IP", value: ip || "-" },
    { key: "配置", value: spec || "-" },
    { key: "到期时间", value: expireAt || "-" }
  ];

  const keyMap = {
    rcs: ["cpu", "memory", "mem", "disk", "bandwidth", "os", "image", "traffic", "port"],
    rca: ["runtime", "cpu", "memory", "disk", "domain", "php", "region"],
    domain: ["domain", "name", "status", "dns", "ns", "expired_at", "auto_renew", "lock"],
    ssl_order: ["common_name", "status", "brand", "cert_type", "expired_at"]
  };
  const mapped = [];
  const seen = new Set();
  for (const k of keyMap[kind] || []) {
    const v = pickFirstFieldDeep(dataRoot, [k]);
    if (v === "" || v === undefined || v === null) continue;
    const label = k.toUpperCase();
    if (seen.has(label)) continue;
    seen.add(label);
    mapped.push({ key: label, value: typeof v === "object" ? JSON.stringify(v) : String(v) });
  }
  const fallback = toDisplayRows(dataRoot, 20).filter((row) => !seen.has(String(row.key).toUpperCase()));
  const configRows = mapped.length ? mapped.concat(fallback.slice(0, 12)) : fallback;

  const monitorCards = toNumericMetrics(monitorData, 8);
  const monitorRows = monitorCards.length ? monitorCards : toDisplayRows(monitorData, 10);

  return { baseInfo, configRows, monitorRows };
}

const MobileShell = {
  template: `
    <div class="mobile-app" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd">
      <header class="m-header">
        <img :src="logo" alt="logo" />
        <div>
          <h1>雨云 App</h1>
          <p>{{ title }}</p>
        </div>
      </header>

      <main :class="mainClass"><slot /></main>

      <nav class="m-tabbar">
        <button :class="tabClass('/home')" @click="go('/home')"><i class="fa-solid fa-house"></i><span>主页</span></button>
        <button :class="tabClass('/promo')" @click="go('/promo')"><i class="fa-solid fa-bullhorn"></i><span>推广中心</span></button>
        <button :class="tabClass('/me')" @click="go('/me')"><i class="fa-solid fa-user"></i><span>我的</span></button>
      </nav>
    </div>
  `,
  props: ["title"],
  setup() {
    const router = useRouter();
    const route = useRoute();
    const touchState = { active: false, startX: 0, startY: 0, deltaX: 0, deltaY: 0 };
    const isTabRootPath = (path) => {
      const p = String(path || "/");
      return p === "/" || p === "/home" || p === "/promo" || p === "/me";
    };
    const tabClass = (path) => ["tab-item", route.path.startsWith(path) ? "active" : ""];
    // Tab 页面切换不进入 history，避免返回键在三个 Tab 之间来回切换。
    const go = (path) => router.replace(path);
    const fallbackRouteByPath = (path) => {
      const p = String(path || "/");
      if (p === "/" || p === "/home") return "/home";
      if (p.startsWith("/todo/")) return "/home";
      if (p.startsWith("/product/")) {
        const seg = p.split("/").filter(Boolean); // [product, kind, id?]
        if (seg.length >= 3) return `/product/${seg[1]}`;
        return "/home";
      }
      if (p === "/promo" || p === "/me") return "/home";
      return "/home";
    };
    const goBackSafe = () => {
      const currentPath = route.path || "/";
      if (isTabRootPath(currentPath)) return;
      const historyState = window.history.state || {};
      const hasInternalBack = typeof historyState.back === "string" && historyState.back.startsWith("/");
      if (hasInternalBack && window.history.length > 1) {
        router.back();
      } else {
        router.replace(fallbackRouteByPath(currentPath));
      }
    };
    const onTouchStart = (e) => {
      if (!e.touches || !e.touches.length) return;
      const t = e.touches[0];
      const isEdge = t.clientX <= 22;
      touchState.active = isEdge;
      touchState.startX = t.clientX;
      touchState.startY = t.clientY;
      touchState.deltaX = 0;
      touchState.deltaY = 0;
    };
    const onTouchMove = (e) => {
      if (!touchState.active || !e.touches || !e.touches.length) return;
      const t = e.touches[0];
      touchState.deltaX = t.clientX - touchState.startX;
      touchState.deltaY = t.clientY - touchState.startY;
    };
    const onTouchEnd = () => {
      if (!touchState.active) return;
      const horizontalEnough = touchState.deltaX > 72;
      const directionOK = Math.abs(touchState.deltaX) > Math.abs(touchState.deltaY) * 1.25;
      touchState.active = false;
      if (horizontalEnough && directionOK) {
        goBackSafe();
      }
    };
    const mainClass = computed(() => {
      const classes = ["m-main"];
      if (route.path === "/home") classes.push("m-main-home");
      return classes;
    });
    return { go, tabClass, mainClass, logo: BRAND_LOGO, onTouchStart, onTouchMove, onTouchEnd };
  }
};

const HomePage = {
  components: { MobileShell },
  template: `
    <MobileShell title="主页总览">
      <section class="panel news-strip">
        <div class="news-title">
          <i class="fa-solid fa-flag"></i>
          <a-typography-title class="typo-title-inline" :heading="6">最新活动</a-typography-title>
          <a-tag size="small" bordered color="arcoblue">LIVE</a-tag>
        </div>
        <div class="news-list" v-if="activityNews.length">
          <button class="news-item" v-for="item in activityNews" :key="item.time + item.title" @click="openNews(item.url)">
            <span class="news-item-main">
              <i class="fa-solid fa-fire"></i>
              <a-typography-text class="news-main-text" bold>{{ item.title }}</a-typography-text>
            </span>
            <a-typography-text class="news-time-text" type="secondary">{{ item.time }}</a-typography-text>
          </button>
        </div>
        <a-typography-text class="muted" type="secondary" v-else>暂无活动公告</a-typography-text>
      </section>

      <section class="panel stat-grid">
        <div class="stat-cell"><b>{{ balance }}</b><span>余额</span></div>
        <div class="stat-cell"><b>{{ points }}</b><span>积分</span></div>
        <div class="stat-cell"><b>{{ monthCost }}</b><span>本月消费</span></div>
        <div class="stat-cell"><b>{{ productTotal }}</b><span>产品总数</span></div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">代办事件</a-typography-title>
          <div class="title-actions">
            <a-typography-text class="panel-subtext" type="secondary">同步 {{ lastSyncAt || '--:--:--' }}</a-typography-text>
            <a-button class="link-btn" size="mini" type="outline" :loading="syncing" @click="refresh">{{ syncing ? '同步中...' : '刷新' }}</a-button>
          </div>
        </div>
        <div class="todo-row">
          <button class="todo-card" @click="goTodo('ticket')"><i class="fa-regular fa-life-ring"></i><b>{{ tickets }}</b><span>工单</span></button>
          <button class="todo-card" @click="goTodo('renew')"><i class="fa-solid fa-clock-rotate-left"></i><b>{{ renew }}</b><span>待续费</span></button>
          <button class="todo-card" @click="goTodo('coupon')"><i class="fa-solid fa-ticket"></i><b>{{ coupons }}</b><span>优惠券</span></button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">产品入口</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">数据来源 {{ source }}</a-typography-text>
        </div>
        <div class="entry-grid">
          <button class="entry" @click="goList('rcs')"><i class="fa-solid fa-server"></i><span>云服务器</span><em>{{ summary.rcs.length }}</em></button>
          <button class="entry" @click="goList('rca')"><i class="fa-solid fa-cloud"></i><span>云应用</span><em>{{ summary.rca.length }}</em></button>
          <button class="entry" @click="goList('domain')"><i class="fa-solid fa-globe"></i><span>域名服务</span><em>{{ summary.domain.length }}</em></button>
          <button class="entry" @click="goList('ssl_order')"><i class="fa-solid fa-key"></i><span>SSL证书</span><em>{{ summary.ssl_order.length }}</em></button>
        </div>
      </section>
    </MobileShell>
  `,
  setup() {
    const router = useRouter();
    const summary = computed(() => store.summary);
    const profile = computed(() => store.userProfile || {});
    const rawData = computed(() => (store.rawSummary && store.rawSummary.data) ? store.rawSummary.data : {});
    const source = computed(() => store.summarySource || "--");
    const productTotal = computed(() => summary.value.domain.length + summary.value.rca.length + summary.value.rcs.length + summary.value.ssl_order.length);
    const tickets = computed(() => 0);
    const renew = computed(() => summary.value.rcs.length + summary.value.rca.length);
    const coupons = computed(() => (Array.isArray(store.userCoupons) ? store.userCoupons.length : 0));
    const syncing = computed(() => store.loading);
    const lastSyncAt = computed(() => store.lastSyncAt);
    const activityNews = computed(() => {
      const list = Array.isArray(store.homeNews) ? store.homeNews : [];
      const mapped = list.map((item) => ({
        type: String(item.Type || item.type || ""),
        title: String(item.Title || item.title || "-"),
        url: String(item.URL || item.url || ""),
        time: formatDate(item.TimeStamp || item.time || item.date)
      }));
      const activityOnly = mapped.filter((x) => x.type.includes("活动"));
      const source = activityOnly.length ? activityOnly : mapped;
      return source.slice(0, 2);
    });

    const points = computed(() => formatCount(
      pickFirstFieldDeep(profile.value, ["Points", "points", "point", "score", "integral", "credit_point", "reward_points"]) ||
      pickFirstFieldDeep(rawData.value, ["Points", "points", "point", "score", "integral", "credit_point"])
    ));
    const monthCost = computed(() => formatMoney(
      pickFirstFieldDeep(profile.value, ["ConsumeMonthly", "consume_monthly", "month_cost", "month_consume", "month_pay", "month_spend"]) ||
      pickFirstFieldDeep(rawData.value, ["ConsumeMonthly", "consume_monthly", "month_cost", "month_consume", "month_pay", "month_spend"])
    ));
    const balance = computed(() => formatMoney(
      pickFirstFieldDeep(profile.value, ["Money", "balance", "money", "amount", "wallet", "credit", "user_money", "cash"]) ||
      pickFirstFieldDeep(rawData.value, ["Money", "balance", "money", "amount", "wallet", "credit", "user_money", "cash"])
    ));

    const goList = (kind) => router.push(`/product/${kind}`);
    const goTodo = (type) => router.push(`/todo/${type}`);
    const refresh = () => refreshSummary(true);
    const openNews = (url) => {
      const u = String(url || "").trim();
      if (!u) return;
      window.open(u, "_blank");
    };

    onMounted(() => refreshSummary(false));

    return { summary, source, productTotal, points, monthCost, balance, tickets, renew, coupons, syncing, lastSyncAt, activityNews, goList, goTodo, refresh, openNews };
  }
};

const TodoPage = {
  components: { MobileShell },
  template: `
    <MobileShell :title="title">
      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">{{ title }}</a-typography-title>
          <a-button class="link-btn" size="mini" type="outline" @click="loadData">刷新</a-button>
        </div>
        <a-typography-text class="muted" type="secondary" v-if="type === 'ticket'">接口：<code>/workorder/?options=...</code></a-typography-text>
        <a-typography-text class="muted" type="secondary" v-if="type === 'renew'">接口：<code>/product/*/{id}/</code> + <code>/product/rcs/price?scene=renew...</code></a-typography-text>
        <a-typography-text class="muted" type="secondary" v-if="type === 'coupon'">接口：<code>/user/coupons/</code></a-typography-text>
      </section>

      <section class="panel" v-if="loading">
        <a-typography-text class="muted" type="secondary">加载中...</a-typography-text>
      </section>

      <section class="panel" v-else-if="errorText">
        <p class="error-text">{{ errorText }}</p>
      </section>

      <section class="panel" v-else-if="type === 'ticket'">
        <div v-if="!ticketRows.length" class="empty">暂无工单记录</div>
        <div v-else class="todo-list">
          <div class="todo-item" v-for="row in ticketRows" :key="'t-' + row.id">
            <b>#{{ row.id }} {{ row.title }}</b>
            <span>{{ row.status }} · {{ row.time }}</span>
          </div>
        </div>
      </section>

      <section class="panel" v-else-if="type === 'renew'">
        <div v-if="!renewRows.length" class="empty">暂无待续费数据</div>
        <div v-else class="todo-list">
          <div class="todo-item" v-for="row in renewRows" :key="'r-' + row.kind + '-' + row.id">
            <b>{{ row.name }}</b>
            <span>{{ row.kindLabel }} #{{ row.id }} · {{ row.statusText }}</span>
            <span>到期：{{ row.expireAt }}（{{ row.daysText }}）</span>
            <span>自动续费：{{ row.autoRenewText }}<template v-if="row.renewPrice"> · 1月续费约 {{ row.renewPrice }}</template></span>
            <a-button class="line-btn sm inline-btn" size="small" type="outline" @click="openProduct(row.kind, row.id)">查看详情</a-button>
          </div>
        </div>
      </section>

      <section class="panel" v-else-if="type === 'coupon'">
        <div v-if="!couponRows.length" class="empty">暂无可用优惠券</div>
        <div v-else class="todo-list">
          <div class="todo-item" v-for="row in couponRows" :key="'c-' + row.id">
            <b>{{ row.name }}</b>
            <span>{{ row.typeText }} · {{ row.valueText }} · {{ row.expireText }}</span>
            <span>适用产品：{{ row.productText }} · 场景：{{ row.sceneText }}</span>
            <span>最低消费：{{ row.baseLimitText }} · 状态：{{ row.statusText }}</span>
          </div>
        </div>
      </section>

      <section class="panel action-grid">
        <a-button class="line-btn" size="medium" type="outline" @click="goBack">返回主页</a-button>
        <a-button class="line-btn" size="medium" type="outline" @click="openMainSite">打开主站</a-button>
      </section>
    </MobileShell>
  `,
  setup() {
    const route = useRoute();
    const router = useRouter();
    const type = computed(() => String(route.params.type || ""));
    const loading = ref(false);
    const errorText = ref("");
    const ticketRows = ref([]);
    const renewRows = ref([]);
    const couponRows = ref([]);
    let todoInflight = null;

    function queryOptions(page = 1, perPage = 20) {
      return encodeURIComponent(JSON.stringify({
        columnFilters: {},
        sort: [],
        page,
        perPage
      }));
    }

    function mapTicketStatus(raw) {
      const s = String(raw || "").toLowerCase();
      if (s.includes("open") || s === "0") return "处理中";
      if (s.includes("close") || s === "1") return "已关闭";
      if (s.includes("pending")) return "待处理";
      return String(raw || "-");
    }

    function parseExpire(v) {
      if (v === null || v === undefined || v === "") return { text: "-", daysText: "-", days: Number.POSITIVE_INFINITY };
      const n = Number(v);
      let d;
      if (Number.isFinite(n)) {
        const ms = n > 1000000000000 ? n : (n > 1000000000 ? n * 1000 : n);
        d = new Date(ms);
      } else {
        d = new Date(String(v));
      }
      if (Number.isNaN(d.getTime())) return { text: String(v), daysText: "-", days: Number.POSITIVE_INFINITY };
      const diffMs = d.getTime() - Date.now();
      const days = Math.ceil(diffMs / 86400000);
      const daysText = days < 0 ? `已过期 ${Math.abs(days)} 天` : `剩余 ${days} 天`;
      return { text: d.toLocaleString(), daysText, days };
    }

    function endpointFor(kindName, productId) {
      if (kindName === "rcs") return `/product/rcs/${productId}/`;
      if (kindName === "rca") return `/product/rca/project/${productId}/`;
      if (kindName === "domain") return `/product/domain/${productId}/`;
      return "";
    }

    async function loadTickets() {
      const payload = await apiGet(`/workorder/?options=${queryOptions(1, 20)}`);
      const data = extractPayloadData(payload) || {};
      const records = Array.isArray(data.Records) ? data.Records : [];
      ticketRows.value = records.map((item) => ({
        id: String(item.ID || item.id || "-"),
        title: String(item.Title || item.title || "未命名工单"),
        status: mapTicketStatus(item.Status || item.status),
        time: formatDateTime(item.Time || item.time)
      }));
    }

    async function tryGetRcsRenewPrice(id) {
      try {
        const p = await apiGet(`/product/rcs/price?scene=renew&product_id=${id}&duration=1&with_coupon_id=0&is_old=true`);
        const d = extractPayloadData(p) || {};
        const v = pickFirstFieldDeep(d, ["price", "renew", "detail.per_scene.renew"]);
        const perScene = d.detail && d.detail.per_scene ? d.detail.per_scene : {};
        const renewValue = perScene.renew !== undefined ? perScene.renew : v;
        const n = toNumberOrNull(renewValue);
        return n === null ? "" : `¥ ${n.toFixed(2)}`;
      } catch {
        return "";
      }
    }

    async function loadRenews() {
      await refreshSummary(false);
      const kinds = ["rcs", "rca", "domain"];
      const rows = [];
      const tasks = [];
      for (const kindName of kinds) {
        const ids = (store.summary[kindName] || []).slice(0, 30);
        for (const productId of ids) {
          tasks.push(async () => {
            const detailPath = endpointFor(kindName, productId);
            if (!detailPath) return null;
            try {
              const payload = await apiGet(detailPath);
              const detailData = extractPayloadData(payload);
              const d = detailData && detailData.Data && typeof detailData.Data === "object" ? detailData.Data : detailData;
              const name = String(
                pickFirstFieldDeep(d, ["name", "domain", "OsName", "HostName", "title", "domain_name"]) ||
                `${getKindLabel(kindName)} #${productId}`
              );
              const statusRaw = String(pickFirstFieldDeep(d, ["status", "Status", "state"]) || "-");
              const autoRaw = pickFirstFieldDeep(d, ["AutoRenew", "auto_renew", "expire_notice"]);
              const expRaw = pickFirstFieldDeep(d, ["ExpDate", "exp_date", "expired_at", "expire_at", "end_time", "due_time"]);
              const exp = parseExpire(expRaw);
              const renewPrice = kindName === "rcs" ? await tryGetRcsRenewPrice(productId) : "";
              return {
                kind: kindName,
                kindLabel: getKindLabel(kindName),
                id: String(productId),
                name,
                statusText: statusRaw,
                autoRenewText: (String(autoRaw).toLowerCase() === "true" || String(autoRaw) === "1") ? "已开启" : "未开启",
                expireAt: exp.text,
                daysText: exp.daysText,
                days: exp.days,
                renewPrice
              };
            } catch {
              return null;
            }
          });
        }
      }
      const concurrency = 5;
      let cursor = 0;
      async function worker() {
        while (cursor < tasks.length) {
          const idx = cursor;
          cursor += 1;
          const item = await tasks[idx]();
          if (item) rows.push(item);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
      renewRows.value = rows
        .sort((a, b) => a.days - b.days)
        .slice(0, 50);
    }

    async function loadCoupons() {
      const payload = await apiGet("/user/coupons/");
      const data = extractPayloadData(payload);
      const items = Array.isArray(data) ? data : [];
      store.userCoupons = items;
      couponRows.value = items.map((item) => {
        const rawType = String(item.type || "normal").toLowerCase();
        const used = Number(item.use_date || 0) > 0;
        const expired = Number(item.exp_date || 0) > 0 && (Number(item.exp_date) * 1000 < Date.now());
        const statusText = used ? "已使用" : (expired ? "已过期" : "可使用");
        const productMap = { rcs: "云服务器", rca: "云应用", rgs: "游戏云", ros: "对象存储", rbm: "裸金属", rvh: "虚拟主机" };
        const sceneMap = { renew: "续费", create: "新购", upgrade: "升级" };
        const productText = String(item.usable_product || "")
          .split(",")
          .filter(Boolean)
          .map((x) => productMap[x] || x)
          .join("、") || "全产品";
        const sceneText = String(item.usable_scenes || "")
          .split(",")
          .filter(Boolean)
          .map((x) => sceneMap[x] || x)
          .join("、") || "全部";
        return {
          id: Number(item.id),
          name: String(item.friendly_name || `优惠券 #${item.id}`),
          typeText: rawType === "discount" ? "折扣券" : "直减券",
          valueText: rawType === "discount"
            ? `${(Number(item.value) * 10).toFixed(2)} 折`
            : `¥ ${formatFixed2(item.value)}`,
          expireText: Number(item.exp_date || 0) > 0 ? `到期 ${formatDateTime(item.exp_date)}` : "无到期时间",
          productText,
          sceneText,
          baseLimitText: `¥ ${formatFixed2(item.base_limit || 0)}`,
          statusText
        };
      });
    }

    async function loadData() {
      if (todoInflight) return todoInflight;
      loading.value = true;
      errorText.value = "";
      todoInflight = (async () => {
        try {
          if (type.value === "ticket") {
            await loadTickets();
          } else if (type.value === "renew") {
            await loadRenews();
          } else if (type.value === "coupon") {
            await loadCoupons();
          }
        } catch (e) {
          errorText.value = String(e);
        } finally {
          loading.value = false;
          todoInflight = null;
        }
      })();
      return todoInflight;
    }

    const title = computed(() => {
      const t = type.value;
      if (t === "ticket") return "工单中心";
      if (t === "renew") return "待续费";
      if (t === "coupon") return "优惠券";
      return "代办详情";
    });
    const goBack = () => router.push("/home");
    const openMainSite = () => window.open("https://app.rainyun.com/", "_blank");
    const openProduct = (kind, id) => router.push(`/product/${kind}/${id}`);

    onMounted(loadData);
    return {
      type,
      title,
      loading,
      errorText,
      ticketRows,
      renewRows,
      couponRows,
      loadData,
      openProduct,
      goBack,
      openMainSite
    };
  }
};

const ProductListPage = {
  components: { MobileShell },
  template: `
    <MobileShell :title="kindLabel">
      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">{{ kindLabel }}</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">共 {{ ids.length }} 项</a-typography-text>
        </div>
        <div class="list-toolbar">
          <a-input v-model="keyword" allow-clear placeholder="搜索ID" inputmode="numeric" />
          <a-button class="line-btn sm" size="small" type="outline" @click="toggleSort">{{ asc ? '升序' : '降序' }}</a-button>
          <a-button class="line-btn sm" size="small" type="outline" @click="refresh">刷新</a-button>
        </div>
        <div class="list-tip" v-if="keyword">匹配 {{ viewIds.length }} 项</div>
        <div v-if="!viewIds.length" class="empty">暂无匹配数据</div>
        <div v-else class="list-cards">
          <button class="id-card" v-for="id in viewIds" :key="id" @click="openDetail(id)">
            <div><b>#{{ id }}</b><span>{{ kindLabel }}</span></div>
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
        <div class="action-grid list-actions">
          <a-button class="line-btn" size="medium" type="outline" @click="copyAllIds">复制全部ID</a-button>
          <a-button class="line-btn" size="medium" type="outline" @click="openMainSite">打开主站</a-button>
        </div>
      </section>
    </MobileShell>
  `,
  setup() {
    const route = useRoute();
    const router = useRouter();
    const kind = computed(() => String(route.params.kind));
    const ids = computed(() => store.summary[kind.value] || []);
    const keyword = ref("");
    const asc = ref(true);
    const kindLabel = computed(() => getKindLabel(kind.value));
    const viewIds = computed(() => {
      const list = [...ids.value];
      const sorted = list.sort((a, b) => asc.value ? Number(a) - Number(b) : Number(b) - Number(a));
      if (!keyword.value) return sorted;
      return sorted.filter((id) => String(id).includes(keyword.value));
    });
    const openDetail = (id) => router.push(`/product/${kind.value}/${id}`);
    const toggleSort = () => { asc.value = !asc.value; };
    const refresh = async () => {
      await refreshSummary(true);
      toast("产品列表已刷新");
    };
    const copyAllIds = async () => {
      if (!viewIds.value.length) {
        toast("暂无可复制ID");
        return;
      }
      const text = viewIds.value.join(",");
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          toast("ID已复制");
          return;
        }
      } catch {
        // fallback
      }
      window.prompt("复制ID列表", text);
    };
    const openMainSite = () => {
      window.open("https://app.rainyun.com/", "_blank");
    };
    onMounted(() => refreshSummary(false));
    return { ids, kindLabel, viewIds, keyword, asc, openDetail, toggleSort, refresh, copyAllIds, openMainSite };
  }
};

const ProductDetailPage = {
  components: { MobileShell },
  template: `
    <MobileShell :title="kindLabel + '详情'">
      <section class="panel" v-if="loading">
        <a-typography-text class="muted" type="secondary">正在加载详情...</a-typography-text>
      </section>

      <section class="panel" v-else-if="errorText">
        <p class="error-text">{{ errorText }}</p>
      </section>

      <section class="panel" v-else>
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">{{ kind === 'rcs' ? '服务器信息' : (kind === 'rca' ? '应用信息' : '基础状态') }}</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">{{ detailPath || '--' }}</a-typography-text>
        </div>
        <div v-if="kind === 'rcs' || kind === 'rca'" class="server-info-list">
          <div class="server-row"><span>{{ kind === 'rca' ? '项目 ID' : '服务器 ID' }}</span><b>{{ serverInfo.id }}</b></div>
          <div class="server-row"><span>标签</span><b>{{ serverInfo.tag }}</b></div>
          <div class="server-row">
            <span>运行状态</span>
            <b :class="['state-badge', statusView.className]">
              <i :class="statusView.icon"></i>{{ statusView.label }}
            </b>
          </div>
          <div class="server-row"><span>{{ kind === 'rca' ? '区域' : '节点' }}</span><b>{{ serverInfo.node }}</b></div>
          <div class="server-row"><span>到期日期</span><b>{{ serverInfo.expireAt }}</b></div>
          <div class="server-row" v-if="serverInfo.showTraffic"><span>剩余流量</span><b>{{ serverInfo.trafficLeft }}</b></div>
        </div>
        <div v-else class="detail-metrics">
          <div class="metric-item" v-for="row in baseInfo" :key="'base-' + row.key">
            <span>{{ row.key }}</span>
            <b>{{ row.value }}</b>
          </div>
        </div>
      </section>

      <section class="panel" v-if="!loading && !errorText">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">配置信息</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">{{ detailPath || '--' }}</a-typography-text>
        </div>
        <div class="kv" v-for="row in configRows" :key="'cfg-' + row.key + row.value">
          <span>{{ row.key }}</span><b>{{ row.value }}</b>
        </div>
      </section>

      <section class="panel" v-if="monitorPath">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">监控信息</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">{{ monitorPath }}</a-typography-text>
        </div>
        <div v-if="monitorChartRows.length" class="monitor-chart-list">
          <div class="monitor-chart-item" v-for="row in monitorChartRows" :key="'m-' + row.key">
            <div class="monitor-chart-head">
              <span>{{ row.label }}</span>
              <b>{{ row.value }}</b>
            </div>
            <div class="monitor-chart-bar">
              <i :style="{ width: row.percent + '%' }"></i>
            </div>
          </div>
        </div>
        <a-typography-text class="muted" type="secondary" v-else>该产品暂未返回监控指标</a-typography-text>
      </section>

      <section class="panel action-grid">
        <a-button class="line-btn" size="medium" type="outline" @click="loadDetail">刷新数据</a-button>
      </section>
    </MobileShell>
  `,
  setup() {
    const route = useRoute();
    const router = useRouter();
    const id = computed(() => String(route.params.id));
    const kind = computed(() => String(route.params.kind));
    const kindLabel = computed(() => getKindLabel(kind.value));
    const loading = ref(false);
    const errorText = ref("");
    const baseInfo = ref([]);
    const serverInfo = ref({
      id: "-",
      tag: "未设定",
      status: "-",
      node: "-",
      expireAt: "-",
      showTraffic: false,
      trafficLeft: "-"
    });
    const statusView = computed(() => {
      const raw = String(serverInfo.value.status || "").toLowerCase();
      if (raw === "running") {
        return { className: "is-running", icon: "fa-solid fa-circle-play", label: "运行中" };
      }
      if (raw === "stopped" || raw === "stop") {
        return { className: "is-stopped", icon: "fa-solid fa-circle-pause", label: "已停止" };
      }
      if (raw) {
        return { className: "is-unknown", icon: "fa-solid fa-circle-question", label: String(serverInfo.value.status) };
      }
      return { className: "is-unknown", icon: "fa-solid fa-circle-question", label: "-" };
    });
    const configRows = ref([]);
    const monitorRows = ref([]);
    const detailPath = ref("");
    const monitorPath = ref("");
    function parseSizeToBytes(num, unit) {
      const n = Number(num);
      if (!Number.isFinite(n)) return null;
      const u = String(unit || "").toUpperCase();
      const map = {
        B: 1,
        KB: 1024,
        MB: 1024 ** 2,
        GB: 1024 ** 3,
        TB: 1024 ** 4,
        PB: 1024 ** 5
      };
      const factor = map[u];
      if (!factor) return null;
      return n * factor;
    }
    function parseRateToBytesPerSec(text) {
      const m = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*\/\s*s/i);
      if (!m) return null;
      return parseSizeToBytes(m[1], m[2]);
    }
    function parseFirstNumber(text) {
      const m = String(text || "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    }
    function percentByKey(key, value) {
      const k = String(key || "").toLowerCase();
      const v = String(value ?? "");

      // CPU: key already indicates percent semantic.
      if (k.includes("cpu")) {
        const n = parseFirstNumber(v);
        if (n === null) return null;
        return Math.max(0, Math.min(100, n));
      }

      // Used/total style memory or usage ratios (with unit conversion support).
      const ratioWithUnitHit = v.match(
        /(-?\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*\/\s*(-?\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)/i
      );
      if (ratioWithUnitHit) {
        const a = parseSizeToBytes(ratioWithUnitHit[1], ratioWithUnitHit[2]);
        const b = parseSizeToBytes(ratioWithUnitHit[3], ratioWithUnitHit[4]);
        if (a !== null && b !== null && b > 0) {
          return Math.max(0, Math.min(100, (a / b) * 100));
        }
      }
      const ratioHit = v.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
      if (ratioHit) {
        const a = Number(ratioHit[1]);
        const b = Number(ratioHit[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
          return Math.max(0, Math.min(100, (a / b) * 100));
        }
      }

      // explicit percentage in value.
      const percentHit = v.match(/(-?\d+(?:\.\d+)?)\s*%/);
      if (percentHit) {
        const p = Number(percentHit[1]);
        if (Number.isFinite(p)) return Math.max(0, Math.min(100, p));
      }

      // Throughput metrics: map to fixed scale (10MB/s = full bar).
      if (k.includes("速率") || k.includes("net") || k.includes("read") || k.includes("write") || k.includes("traffic")) {
        const bps = parseRateToBytesPerSec(v);
        if (bps !== null) {
          const full = 10 * 1024 * 1024;
          return Math.max(0, Math.min(100, (bps / full) * 100));
        }
      }

      return null;
    }
    const monitorChartRows = computed(() => {
      const rows = Array.isArray(monitorRows.value) ? monitorRows.value : [];
      if (!rows.length) return [];
      const parsed = rows.map((row) => {
        const key = String(row.key || "-");
        const value = String(row.value ?? "-");
        const p = percentByKey(key, value);
        const n = parseFirstNumber(value);
        return { key, label: monitorLabel(key), value, typedPercent: p, numeric: n !== null ? Math.abs(n) : null };
      });

      const maxRaw = parsed
        .filter((x) => x.typedPercent === null && x.numeric !== null)
        .reduce((m, x) => Math.max(m, Number(x.numeric)), 0);

      return parsed.map((x) => {
        let p = 0;
        if (x.typedPercent !== null) {
          p = x.typedPercent;
        } else {
          if (x.numeric === null) {
            p = 12;
          } else if (x.numeric === 0) {
            p = 0;
          } else {
            p = maxRaw > 0 ? (x.numeric / maxRaw) * 100 : 12;
          }
        }
        const percent = Math.max(0, Math.min(100, Number(p)));
        return { key: x.key, label: x.label, value: x.value, percent: percent.toFixed(2) };
      });
    });

    function endpointFor(kindName, productId) {
      if (kindName === "rcs") {
        return {
          detail: `/product/rcs/${productId}/`,
          monitor: `/product/rcs/${productId}/monitor`
        };
      }
      if (kindName === "rca") {
        return {
          detail: `/product/rca/project/${productId}/`,
          monitor: `/product/rca/project/${productId}/metrics`
        };
      }
      if (kindName === "domain") {
        return {
          detail: `/product/domain/${productId}/`,
          monitor: ""
        };
      }
      if (kindName === "ssl_order") {
        return {
          detail: "",
          monitor: ""
        };
      }
      return { detail: "", monitor: "" };
    }

    async function loadDetail() {
      await refreshSummary(false);
      loading.value = true;
      errorText.value = "";
      baseInfo.value = [];
      serverInfo.value = { id: "-", tag: "未设定", status: "-", node: "-", expireAt: "-", showTraffic: false, trafficLeft: "-" };
      configRows.value = [];
      monitorRows.value = [];

      const endpoint = endpointFor(kind.value, id.value);
      detailPath.value = endpoint.detail;
      monitorPath.value = endpoint.monitor;

      try {
        if (!endpoint.detail) {
          throw new Error("当前类型暂无详情接口映射");
        }
        const detailPayload = await apiGet(endpoint.detail);
        const detailData = extractPayloadData(detailPayload);
        let monitorData = {};
        if (endpoint.monitor) {
          try {
            const tryPaths = [
              endpoint.monitor,
              `${endpoint.monitor}?range=1h`,
              `${endpoint.monitor}?step=60`,
              `${endpoint.monitor}?type=basic`
            ];
            let ok = false;
            for (const p of tryPaths) {
              try {
                const monitorPayload = await apiGet(p);
                monitorData = extractPayloadData(monitorPayload);
                monitorPath.value = p;
                ok = true;
                break;
              } catch {
                // continue
              }
            }
            if (!ok) {
              reportLog("WARN", "monitor_api_unavailable", { kind: kind.value, id: id.value, endpoint: endpoint.monitor });
            }
          } catch (e) {
            reportLog("WARN", "monitor_api_error", { kind: kind.value, id: id.value, error: String(e) });
          }
        }
        const view = buildDetailView(kind.value, id.value, detailData, monitorData);
        baseInfo.value = view.baseInfo;
        if (view.serverInfo) serverInfo.value = view.serverInfo;
        configRows.value = view.configRows.length ? view.configRows : [{ key: "提示", value: "接口暂无可展示配置字段" }];
        if (!monitorRows.value.length) {
          monitorRows.value = view.monitorRows;
        }
      } catch (e) {
        errorText.value = String(e);
      } finally {
        loading.value = false;
      }
    }

    function goList() {
      router.push(`/product/${kind.value}`);
    }

    function monitorLabel(rawKey) {
      const k = String(rawKey || "").trim();
      if (!k) return "-";
      return k.replace(/\./g, " · ");
    }

    onMounted(() => {
      loadDetail();
    });

    return {
      id,
      kind,
      kindLabel,
      loading,
      errorText,
      baseInfo,
      serverInfo,
      statusView,
      configRows,
      monitorRows,
      monitorChartRows,
      detailPath,
      monitorPath,
      monitorLabel,
      loadDetail,
      goList
    };
  }
};

const PromoPage = {
  components: { MobileShell },
  template: `
    <MobileShell title="推广中心">
      <section class="panel promo-top">
        <img :src="avatar" alt="avatar" class="avatar" />
        <div class="promo-main">
          <a-typography-title :heading="6" class="typo-title">{{ promo.name }}</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">等级：{{ promo.level }}</a-typography-text>
          <div class="promo-tags">
            <span class="promo-chip">{{ promo.badge }}</span>
            <span class="promo-chip ghost">邀请码 {{ promo.shareCode }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">推广链接</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">支持复制和分享</a-typography-text>
        </div>
        <div class="promo-link">{{ promo.link }}</div>
        <div class="action-grid promo-actions">
          <a-button class="line-btn" size="medium" type="outline" @click="copyLink">复制链接</a-button>
          <a-button class="line-btn" size="medium" type="outline" @click="openLink">打开链接</a-button>
          <a-button class="line-btn" size="medium" type="outline" @click="shareLink">分享</a-button>
        </div>
      </section>

      <section class="panel kpi-grid">
        <div><b>{{ promo.monthIncome }}</b><span>本月收益(元)</span></div>
        <div><b>{{ promo.totalIncome }}</b><span>总收益(元)</span></div>
        <div><b>{{ promo.prevMonthIncome }}</b><span>上月收益(元)</span></div>
        <div><b>{{ promo.momRate }}</b><span>收益环比</span></div>
        <div><b>{{ promo.todayStock }}</b><span>今日进货</span></div>
        <div><b>{{ promo.monthStock }}</b><span>本月进货</span></div>
        <div><b>{{ promo.subUserAll }}</b><span>总客户数</span></div>
        <div><b>{{ promo.monthNewUser }}</b><span>本月新增客户</span></div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">季度达成</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">根据用户中心字段计算</a-typography-text>
        </div>
        <div class="promo-progress-item">
          <div class="promo-progress-title"><span>一级进货</span><b>{{ promo.primaryProgressText }}</b></div>
          <div class="progress"><span :style="{ width: promo.primaryProgress + '%' }"></span></div>
        </div>
        <div class="promo-progress-item">
          <div class="promo-progress-title"><span>二级进货</span><b>{{ promo.secondaryProgressText }}</b></div>
          <div class="progress second"><span :style="{ width: promo.secondaryProgress + '%' }"></span></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <a-typography-title :heading="6" class="typo-title">推广权益</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">当前 VIP 配置</a-typography-text>
        </div>
        <div class="kv"><span>直销返利</span><b>{{ promo.saleProfit }}</b></div>
        <div class="kv"><span>进货返利</span><b>{{ promo.resellProfit }}</b></div>
        <div class="kv"><span>二级返利</span><b>{{ promo.secondResellProfit }}</b></div>
        <div class="kv"><span>可发优惠券</span><b>{{ promo.canSendCoupons }}</b></div>
        <div class="kv"><span>可自定义推广码</span><b>{{ promo.canCustomCode }}</b></div>
      </section>
    </MobileShell>
  `,
  setup() {
    const profile = computed(() => store.userProfile || {});
    const promo = computed(() => {
      const p = profile.value;
      const vip = p.VIP && typeof p.VIP === "object" ? p.VIP : {};
      const monthPoints = toNumberOrNull(pickFirstFieldDeep(p, ["ResellPointsMonthly", "resell_points_monthly"]));
      const totalPoints = toNumberOrNull(pickFirstFieldDeep(p, ["ResellPointsAll", "resell_points_all"]));
      const shareCode = String(pickFirstFieldDeep(p, ["ShareCode", "share_code", "invite_code", "code"]) || "-");
      const primaryCurrent = toNumberOrNull(pickFirstFieldDeep(p, ["StockQuarter", "stock_quarter", "quarter_stock"])) ?? 0;
      const secondaryCurrent = toNumberOrNull(pickFirstFieldDeep(p, ["SecondStockQuarter", "second_stock_quarter"])) ?? 0;
      const primaryTarget = toNumberOrNull(vip.StockRequire) ?? 0;
      const secondaryTarget = toNumberOrNull(vip.SecondStockRequire) ?? 0;
      const monthIncomeByPoints = monthPoints === null ? null : monthPoints / 2000;
      const totalIncomeByPoints = totalPoints === null ? null : totalPoints / 2000;
      const prevMonthIncome = toNumberOrNull(pickFirstFieldDeep(p, ["ResellBeforeMonth", "resell_before_month"]));
      const currMonthIncomeRaw = monthIncomeByPoints ?? toNumberOrNull(pickFirstFieldDeep(p, ["ResellMonthly", "resell_monthly"]));
      const momRate = (currMonthIncomeRaw !== null && prevMonthIncome && prevMonthIncome !== 0)
        ? (((currMonthIncomeRaw - prevMonthIncome) / prevMonthIncome) * 100)
        : null;
      const primaryProgress = primaryTarget > 0 ? Math.max(0, Math.min(100, (primaryCurrent / primaryTarget) * 100)) : 0;
      const secondaryProgress = secondaryTarget > 0 ? Math.max(0, Math.min(100, (secondaryCurrent / secondaryTarget) * 100)) : 0;

      return {
        name: String(pickByAlias(p, ["Name", "nickname", "username", "name", "user_name"], "-")),
        level: String(vip.Title || pickByAlias(p, ["Title", "VipTitle", "level_name", "vip_level_name", "level"], "-")),
        badge: String(vip.AgentTitle || pickByAlias(p, ["AgentTitle", "agent_level_name", "agent_title", "agent_badge", "promotion_level_name"], "-")),
        shareCode,
        link: `https://www.rainyun.com/${encodeURIComponent(shareCode === "-" ? "" : shareCode)}_`,
        monthIncome: formatMoney(
          currMonthIncomeRaw ?? pickFirstFieldDeep(p, ["month_income", "month_profit", "promotion_month_income", "ResellMonthly"])
        ).replace("¥ ", ""),
        totalIncome: formatMoney(
          totalIncomeByPoints ?? pickFirstFieldDeep(p, ["total_income", "total_profit", "promotion_total_income", "ResellAll"])
        ).replace("¥ ", ""),
        prevMonthIncome: formatMoney(prevMonthIncome).replace("¥ ", ""),
        momRate: momRate === null ? "-" : `${momRate >= 0 ? "+" : ""}${formatFixed2(momRate)}%`,
        todayStock: formatCount(pickFirstFieldDeep(p, ["StockDaily", "today_stock", "today_purchase", "promotion_today_stock"])),
        monthStock: formatFixed2(pickFirstFieldDeep(p, ["StockMonthly", "month_stock", "month_purchase", "promotion_month_stock"])),
        subUserAll: formatCount(pickFirstFieldDeep(p, ["SubUserAll", "sub_user_all", "customer_total"])),
        monthNewUser: formatCount(pickFirstFieldDeep(p, ["SubUserMonthly", "sub_user_monthly", "customer_monthly"])),
        primaryProgress: Number(primaryProgress.toFixed(2)),
        primaryProgressText: `${formatFixed2(primaryCurrent)} / ${formatFixed2(primaryTarget)}`,
        secondaryProgress: Number(secondaryProgress.toFixed(2)),
        secondaryProgressText: `${formatFixed2(secondaryCurrent)} / ${formatFixed2(secondaryTarget)}`,
        saleProfit: `${formatFixed2((toNumberOrNull(vip.SaleProfit) ?? 0) * 100)}%`,
        resellProfit: `${formatFixed2((toNumberOrNull(vip.ResellProfit) ?? 0) * 100)}%`,
        secondResellProfit: `${formatFixed2((toNumberOrNull(vip.SecondResellProfit) ?? 0) * 100)}%`,
        canSendCoupons: vip.CanSendCoupons ? "是" : "否",
        canCustomCode: vip.CanCustomCode ? "是" : "否"
      };
    });
    const avatar = computed(() => {
      const profile = store.userProfile || {};
      return normalizeAssetUrl(
        pickFirstFieldDeep(profile, ["IconUrl", "iconUrl", "icon_url", "avatar", "avatar_url", "headimgurl", "head_img", "face"]) ||
        AVATAR
      );
    });
    async function copyLink() {
      const link = promo.value.link;
      if (!link || link.endsWith("/")) {
        toast("暂无可用推广码");
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(link);
          toast("推广链接已复制");
          return;
        }
      } catch {
        // fallback below
      }
      window.prompt("复制推广链接", link);
    }
    function openLink() {
      const link = promo.value.link;
      if (!link || link.endsWith("/")) {
        toast("暂无可用推广码");
        return;
      }
      window.open(link, "_blank");
    }
    async function shareLink() {
      const link = promo.value.link;
      if (!link || link.endsWith("/")) {
        toast("暂无可用推广码");
        return;
      }
      // Android app: use native system share sheet first.
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
        try {
          const { Share } = await import("@capacitor/share");
          await Share.share({
            title: "雨云推广链接",
            text: `通过我的邀请码注册雨云：${link}`,
            dialogTitle: "分享邀请链接"
          });
          return;
        } catch (e) {
          reportLog("WARN", "native_share_error", { error: String(e) });
        }
      }
      if (navigator.share) {
        try {
          await navigator.share({ title: "雨云推广链接", text: "通过我的邀请码注册雨云", url: link });
          return;
        } catch {
          // fallback copy
        }
      }
      await copyLink();
    }
    onMounted(() => refreshSummary(false));
    return { avatar, promo, copyLink, openLink, shareLink };
  }
};

const MePage = {
  components: { MobileShell },
  template: `
    <MobileShell title="我的">
      <section class="panel user-head">
        <div class="user-top">
          <img :src="avatarUrl" alt="avatar" class="avatar" />
          <div class="user-head-main">
            <a-typography-title :heading="6" class="typo-title">{{ userCard.name }}</a-typography-title>
            <a-typography-text type="secondary">用户ID: {{ userCard.id }}</a-typography-text>
            <a-typography-text type="secondary">注册日期: {{ userCard.registerDate }}</a-typography-text>
          </div>
        </div>
        <div class="user-meta-row">
          <div class="meta-pill">月消费: {{ userCard.monthCost }}</div>
          <div class="meta-pill">Alipay实名认证: {{ userCard.alipayStatus }}</div>
        </div>
      </section>

      <section class="panel me-stats">
        <div><b>{{ summary.rcs.length }}</b><span>云服务器</span></div>
        <div><b>{{ summary.rca.length }}</b><span>云应用</span></div>
        <div><b>{{ summary.domain.length }}</b><span>域名</span></div>
        <div><b>{{ summary.ssl_order.length }}</b><span>证书</span></div>
      </section>

      <section class="panel">
        <div class="panel-title"><a-typography-title :heading="6" class="typo-title">账号配置</a-typography-title></div>
        <div class="form-grid">
          <label>X-Api-Key
            <div class="input-with-action">
              <a-input :type="showApiKey ? 'text' : 'password'" v-model="form.apiKey" />
              <a-button class="line-btn sm" size="small" type="outline" @click="toggleApiKey">{{ showApiKey ? '隐藏' : '显示' }}</a-button>
            </div>
          </label>
        </div>
        <div class="btn-row">
          <a-button class="primary-btn" type="primary" @click="save">保存并刷新</a-button>
          <a-button class="line-btn about-btn" type="outline" @click="openAbout">关于应用</a-button>
          <a-button class="line-btn update-btn" type="outline" @click="checkUpdate">检查更新</a-button>
        </div>
      </section>

      <div v-if="showAboutModal" class="about-modal-mask" @click.self="closeAbout">
        <div class="about-modal">
          <div class="about-modal-head">
            <a-typography-title :heading="5" class="typo-title">关于应用</a-typography-title>
            <button class="about-close" @click="closeAbout"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="about-brand">
            <img :src="brandLogo" alt="logo" />
            <div>
              <b>RainYun APP</b>
              <p>新一代云服务提供商</p>
            </div>
          </div>
          <div class="kv"><span>版本</span><b>{{ appVersion }}</b></div>
          <div class="kv"><span>更新源</span><b class="about-url">{{ updateBaseUrl }}</b></div>
          <div class="kv kv-stack">
            <span>技术栈</span>
            <div class="about-tech-tags">
              <a-tag size="small" color="arcoblue">Vue 3</a-tag>
              <a-tag size="small" color="cyan">Vue Router 4</a-tag>
              <a-tag size="small" color="blue">Arco Design Vue</a-tag>
              <a-tag size="small" color="green">Vite 5</a-tag>
              <a-tag size="small" color="purple">Capacitor 7</a-tag>
            </div>
          </div>
          <div class="about-block">
            <h4>致谢</h4>
            <p>感谢 RainYun 官方 API 提供数据能力。</p>
            <p>感谢社区项目 <code>rainyun-go-sdk</code> 提供接口参考与字段映射思路。</p>
          </div>
          <div class="about-block">
            <h4>免责声明</h4>
            <p>本 App 基于 RainYun API 开发，与雨云官方客户端并非同一产品。</p>
            <p>API Key 仅用于你与 RainYun API 的请求交互，不会上传至开发者服务器。</p>
          </div>
          <div class="about-actions">
            <a-button class="line-btn" type="outline" @click="copyUpdateUrl">复制更新源</a-button>
            <a-button class="primary-btn" type="primary" @click="closeAbout">我知道了</a-button>
          </div>
        </div>
      </div>

    </MobileShell>
  `,
  setup() {
    const summary = computed(() => store.summary);
    const form = reactive({ ...store.auth });
    const showApiKey = ref(false);
    const showAboutModal = ref(false);

    const userCard = computed(() => {
      const profile = store.userProfile || {};
      const payload = store.rawSummary || {};
      const data = payload.data || {};
      return {
        name: pickByAlias(profile, ["Name", "nickname", "username", "name", "user_name"]),
        id: pickByAlias(profile, ["ID", "uid", "id", "user_id"]),
        registerDate: formatDate(pickFirstFieldDeep(profile, ["RegisterTime", "register_at", "created_at", "register_date", "register_time"])),
        monthCost: formatMoney(
          pickFirstFieldDeep(profile, ["ConsumeMonthly", "month_cost", "month_consume"]) ||
          data.month_cost
        ),
        alipayStatus: (() => {
          const s = String(
            pickFirstFieldDeep(profile, ["CertifyStatus", "certify_status", "alipay_status", "alipay_verify"]) ||
            data.alipay_status ||
            "-"
          ).toLowerCase();
          if (s === "passed" || s === "done" || s === "verified" || s === "success" || s === "1") return "已完成";
          if (s === "-") return "-";
          return s;
        })()
      };
    });

    const avatarUrl = computed(() => {
      const profile = store.userProfile || {};
      return normalizeAssetUrl(
        pickFirstFieldDeep(profile, ["IconUrl", "iconUrl", "icon_url", "avatar", "avatar_url", "headimgurl", "head_img", "face"]) ||
        AVATAR
      );
    });

    const toggleApiKey = () => {
      showApiKey.value = !showApiKey.value;
    };

    async function save() {
      if (!form.apiKey.trim()) {
        toast("请填写 X-Api-Key");
        return;
      }
      saveAuth(form);
      showApiKey.value = false;
      await refreshSummary(true);
      toast("已保存");
    }

    function openAbout() {
      showAboutModal.value = true;
    }

    function closeAbout() {
      showAboutModal.value = false;
    }

    async function copyUpdateUrl() {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(UPDATE_BASE_URL);
          toast("更新源已复制");
          return;
        }
      } catch {
        // fallback
      }
      window.prompt("复制更新源", UPDATE_BASE_URL);
    }

    async function fetchUpdatePayload() {
      const urls = [UPDATE_FEED_URL, `${UPDATE_BASE_URL}/`];
      for (const url of urls) {
        try {
          const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { method: "GET", cache: "no-store" });
          if (!res.ok) continue;
          const text = await res.text();
          let payload = {};
          try {
            payload = text ? JSON.parse(text) : {};
            for (let i = 0; i < 2 && typeof payload === "string"; i += 1) {
              const t = String(payload).trim();
              if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
                payload = JSON.parse(t);
              } else {
                break;
              }
            }
          } catch {
            payload = {};
          }
          if (payload && typeof payload === "object" && hasUpdateVersionField(payload)) return payload;
        } catch {
          // try next endpoint
        }
      }
      throw new Error("更新源不可用或返回格式不正确");
    }

    async function checkUpdate() {
      try {
        toast("正在检查更新...");
        const payload = await fetchUpdatePayload();
        const info = extractUpdateInfo(payload);
        if (!info.version) {
          toast("更新源缺少版本字段");
          return;
        }
        const cmp = compareVersion(info.version, APP_VERSION);
        if (cmp <= 0) {
          toast(`当前已是最新版本（${APP_VERSION}）`);
          return;
        }
        const target = info.downloadUrl || UPDATE_BASE_URL;
        const notes = info.notes || "暂无更新说明";
        const ok = confirm(`发现新版本 ${info.version}\n当前版本 ${APP_VERSION}\n\n更新说明：\n${notes}\n\n是否立即下载？`);
        if (!ok) return;
        window.open(target, "_blank");
      } catch (e) {
        reportLog("WARN", "check_update_error", { error: String(e) });
        toast(`检查更新失败: ${String(e)}`);
      }
    }

    onMounted(() => refreshSummary(false));

    return {
      summary,
      form,
      userCard,
      avatarUrl,
      showApiKey,
      showAboutModal,
      appVersion: APP_VERSION,
      updateBaseUrl: UPDATE_BASE_URL,
      brandLogo: BRAND_LOGO,
      toggleApiKey,
      save,
      openAbout,
      closeAbout,
      copyUpdateUrl,
      checkUpdate
    };
  }
};

const routes = [
  { path: "/", redirect: "/home" },
  { path: "/home", component: HomePage },
  { path: "/promo", component: PromoPage },
  { path: "/me", component: MePage },
  { path: "/todo/:type", component: TodoPage },
  { path: "/product/:kind", component: ProductListPage },
  { path: "/product/:kind/:id", component: ProductDetailPage }
];

const router = createRouter({ history: createWebHashHistory(), routes });

const RootApp = {
  template: `
    <div>
      <div class="global-loading" v-show="loading"></div>
      <transition name="boot-fade">
        <div v-if="bootVisible" :class="['boot-splash', bootMode === 'progress' ? 'boot-progress-mode' : 'boot-animated-mode']">
          <div class="boot-splash-inner">
            <div class="boot-logo-wrap">
              <img :src="logo" alt="RainYun" class="boot-logo" />
            </div>
            <div class="boot-title">雨云APP</div>
            <div class="boot-subtitle">{{ bootMode === 'progress' ? 'RainYun App · Progress Mode' : 'RainYun App' }}</div>
            <div class="boot-loader"><i :style="{ width: bootProgress + '%' }"></i></div>
            <div class="boot-progress-text">{{ bootProgress }}%</div>
          </div>
        </div>
      </transition>
      <router-view v-slot="{ Component, route }">
        <transition name="page-slide" mode="out-in">
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </router-view>
    </div>
  `,
  setup() {
    const loading = computed(() => store.loading);
    const bootVisible = ref(true);
    const minBootElapsed = ref(false);
    const bootProgress = ref(4);
    const bootMode = ref("animated");
    const reducedMotion = ref(false);
    let progressTimer = null;

    const tryCloseBoot = () => {
      if (minBootElapsed.value && !loading.value) {
        bootProgress.value = 100;
        setTimeout(() => {
          bootVisible.value = false;
        }, 220);
      }
    };

    onMounted(() => {
      if (typeof window !== "undefined" && window.matchMedia) {
        const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
        reducedMotion.value = Boolean(mql.matches);
        if (reducedMotion.value) {
          bootMode.value = "progress";
        }
      }
      progressTimer = setInterval(() => {
        if (!bootVisible.value) return;
        const cap = minBootElapsed.value && !loading.value ? 100 : 94;
        if (bootProgress.value < cap) {
          const delta = bootMode.value === "progress"
            ? (bootProgress.value < 60 ? 2 : 1)
            : (bootProgress.value < 40 ? 3 : (bootProgress.value < 75 ? 2 : 1));
          bootProgress.value = Math.min(cap, bootProgress.value + delta);
        }
      }, 120);
      setTimeout(() => {
        minBootElapsed.value = true;
        tryCloseBoot();
      }, 5000);
    });

    watch(loading, () => {
      tryCloseBoot();
    });

    watch(bootVisible, (v) => {
      if (!v && progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    });

    return { loading, bootVisible, bootProgress, bootMode, logo: BRAND_LOGO };
  }
};

router.beforeEach((to) => {
  if (!store.auth.apiKey && to.path !== "/me") {
    toast("请先在“我的”页填写 API Key");
    return "/me";
  }
  return true;
});

async function setupAndroidBackHandler() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  try {
    const { App: CapacitorApp } = await import("@capacitor/app");
    let lastBackAt = 0;
    const isTabRootPath = (path) => {
      const p = String(path || "/");
      return p === "/" || p === "/home" || p === "/promo" || p === "/me";
    };
    const fallbackRouteByPath = (path) => {
      const p = String(path || "/");
      if (p === "/" || p === "/home") return "/home";
      if (p.startsWith("/todo/")) return "/home";
      if (p.startsWith("/product/")) {
        const seg = p.split("/").filter(Boolean);
        if (seg.length >= 3) return `/product/${seg[1]}`;
        return "/home";
      }
      if (p === "/promo" || p === "/me") return "/home";
      return "/home";
    };
    CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      const currentPath = router.currentRoute.value.path || "/";
      if (!isTabRootPath(currentPath)) {
        const historyState = window.history.state || {};
        const hasInternalBack = typeof historyState.back === "string" && historyState.back.startsWith("/");
        if (canGoBack && hasInternalBack && window.history.length > 1) {
          router.back();
        } else {
          router.replace(fallbackRouteByPath(currentPath));
        }
        return;
      }
      // 在 Tab 主界面层不再执行 back 导航，避免在三个 Tab 页面来回切换。
      const now = Date.now();
      if (now - lastBackAt < 1500) {
        CapacitorApp.exitApp();
        return;
      }
      lastBackAt = now;
      toast("再滑一次返回退出应用");
    });
    reportLog("INFO", "android_back_handler_ready");
  } catch (e) {
    reportLog("WARN", "android_back_handler_error", { error: String(e) });
  }
}

setupAndroidBackHandler();

createApp(RootApp).use(AButton).use(AInput).use(ATag).use(ATypography).use(router).mount("#app");

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    }).catch(() => {});
  }
}

window.addEventListener("error", (e) => {
  reportLog("ERROR", "window_error", { message: e.message, source: e.filename, line: e.lineno });
});

initNavOriginTracker();
