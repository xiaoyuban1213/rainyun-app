import { createApp, reactive, computed, ref, onMounted, watch } from "vue";
import { createRouter, createWebHashHistory, useRouter, useRoute } from "vue-router";
import { Capacitor } from "@capacitor/core";
import { animate } from "@motionone/dom";
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
const APP_VERSION = "1.1.0";
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
  summary: { domain: [], rca: [], rcs: [], rgpu: [], rgs: [], ssl_order: [] },
  renewDueCount: 0,
  renewDueRows: [],
  renewDueAt: 0,
  renewDuePriceAt: 0,
  productOverview: null,
  summarySource: "",
  rawSummary: null,
  userProfile: null,
  userCoupons: [],
  userCouponsAt: 0,
  homeNews: [],
  lastSyncAt: ""
});
let summaryInflightPromise = null;
let renewPriceInflightPromise = null;
let couponInflightPromise = null;
const apiGetCache = new Map();
const apiGetInflight = new Map();
const API_GET_DEFAULT_TTL = 8000;
const RENEW_ROWS_TTL_MS = 60 * 1000;
const RENEW_PRICE_TTL_MS = 2 * 60 * 1000;
const COUPON_TTL_MS = 60 * 1000;
const API_REQUEST_CACHE_KEY = "rainyun-api-request-cache";
const PROMO_DAILY_CACHE_KEY = "rainyun-promo-income-daily-cache";
const API_REQUEST_CACHE_LIMIT = 240;
const PROMO_DAILY_CACHE_LIMIT = 180;
const BOOT_METRICS_KEY = "rainyun-boot-metrics-v1";
const BOOT_EXPECTED_FALLBACK_MS = 2600;
const BOOT_EXPECTED_MIN_MS = 1200;
const BOOT_EXPECTED_MAX_MS = 6500;
const BOOT_MIN_VISIBLE_MS = 700;
const BOOT_EMA_ALPHA = 0.35;
const AUTH_LOGIN_PATHS = ["/user/login", "/auth/login", "/login", "/account/login"];
const TENCENT_CAPTCHA_APP_ID = "2039519451";

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
  const defaultAuth = {
    baseUrl: "https://api.v2.rainyun.com",
    apiKey: "",
    devToken: "",
    authMode: "apiKey",
    account: ""
  };
  try {
    const raw = localStorage.getItem("rainyun-auth");
    if (!raw) return defaultAuth;
    const v = JSON.parse(raw);
    return {
      baseUrl: v.baseUrl || defaultAuth.baseUrl,
      apiKey: v.apiKey || "",
      devToken: v.devToken || "",
      authMode: v.authMode === "account" ? "account" : "apiKey",
      account: v.account || ""
    };
  } catch {
    return defaultAuth;
  }
}

function saveAuth(nextAuth) {
  store.auth = {
    baseUrl: (nextAuth.baseUrl || "https://api.v2.rainyun.com").trim(),
    apiKey: (nextAuth.apiKey || "").trim(),
    devToken: (nextAuth.devToken || "").trim(),
    authMode: nextAuth.authMode === "account" ? "account" : "apiKey",
    account: (nextAuth.account || "").trim()
  };
  localStorage.setItem("rainyun-auth", JSON.stringify(store.auth));
  apiGetCache.clear();
  apiGetInflight.clear();
  store.renewDueRows = [];
  store.renewDueCount = 0;
  store.renewDueAt = 0;
  store.renewDuePriceAt = 0;
  store.userCoupons = [];
  store.userCouponsAt = 0;
  reportLog("INFO", "auth_saved", { hasApiKey: Boolean(store.auth.apiKey), hasDevToken: Boolean(store.auth.devToken) });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function readBootMetrics() {
  try {
    const raw = localStorage.getItem(BOOT_METRICS_KEY);
    if (!raw) return { emaMs: BOOT_EXPECTED_FALLBACK_MS, samples: 0, lastMs: BOOT_EXPECTED_FALLBACK_MS };
    const parsed = JSON.parse(raw);
    const emaMs = Number(parsed?.emaMs);
    const samples = Number(parsed?.samples);
    const lastMs = Number(parsed?.lastMs);
    return {
      emaMs: Number.isFinite(emaMs) ? clamp(emaMs, BOOT_EXPECTED_MIN_MS, BOOT_EXPECTED_MAX_MS) : BOOT_EXPECTED_FALLBACK_MS,
      samples: Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : 0,
      lastMs: Number.isFinite(lastMs) ? clamp(lastMs, BOOT_EXPECTED_MIN_MS, BOOT_EXPECTED_MAX_MS) : BOOT_EXPECTED_FALLBACK_MS
    };
  } catch {
    return { emaMs: BOOT_EXPECTED_FALLBACK_MS, samples: 0, lastMs: BOOT_EXPECTED_FALLBACK_MS };
  }
}

function writeBootMetrics(actualMs) {
  if (!Number.isFinite(actualMs) || actualMs <= 0) return;
  const nextMs = clamp(Number(actualMs), BOOT_EXPECTED_MIN_MS, BOOT_EXPECTED_MAX_MS);
  const prev = readBootMetrics();
  const hasPrev = Number.isFinite(prev.emaMs) && prev.samples > 0;
  const emaMs = hasPrev
    ? (BOOT_EMA_ALPHA * nextMs + (1 - BOOT_EMA_ALPHA) * prev.emaMs)
    : nextMs;
  const payload = {
    emaMs: clamp(emaMs, BOOT_EXPECTED_MIN_MS, BOOT_EXPECTED_MAX_MS),
    samples: Math.min(50, (Number(prev.samples) || 0) + 1),
    lastMs: nextMs,
    at: new Date().toISOString()
  };
  try {
    localStorage.setItem(BOOT_METRICS_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function couponStorageKey() {
  const base = String(store.auth.baseUrl || "").trim();
  const apiKey = String(store.auth.apiKey || "").trim();
  const devToken = String(store.auth.devToken || "").trim();
  const mode = String(store.auth.authMode || "apiKey");
  const account = String(store.auth.account || "").trim();
  return `rainyun-coupons-cache:${base}|${mode}|${account}|${apiKey}|${devToken}`;
}

function loadCouponCacheFromLocal() {
  try {
    const raw = localStorage.getItem(couponStorageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const at = Number(parsed?.at || 0);
    const rows = Array.isArray(parsed?.items) ? parsed.items : [];
    if (!at || !rows.length) return;
    if (Date.now() - at > COUPON_TTL_MS) return;
    store.userCoupons = rows;
    store.userCouponsAt = at;
  } catch {
    // ignore invalid cache
  }
}

function saveCouponCacheToLocal(items) {
  try {
    const rows = Array.isArray(items) ? items : [];
    const at = Date.now();
    localStorage.setItem(couponStorageKey(), JSON.stringify({ at, items: rows }));
    store.userCouponsAt = at;
  } catch {
    // ignore storage errors
  }
}

function hasFreshCoupons() {
  if (!Array.isArray(store.userCoupons) || !store.userCoupons.length) return false;
  if (!store.userCouponsAt) return false;
  return Date.now() - store.userCouponsAt < COUPON_TTL_MS;
}

function readJsonCache(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJsonCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota/storage errors
  }
}

function toDayKey(dateLike = Date.now()) {
  const d = new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractPromoIncomeMetrics(userData) {
  const p = userData && userData.Data && typeof userData.Data === "object" ? userData.Data : userData;
  if (!p || typeof p !== "object") {
    return {
      incomeMode: "none",
      monthIncome: null,
      todayIncome: null,
      totalIncome: null,
      prevMonthIncome: null,
      monthPoints: null,
      totalPoints: null
    };
  }

  const monthIncomeMoney = toNumberOrNull(
    pickFirstFieldDeep(p, ["ResellMonthly", "resell_monthly", "month_income", "month_profit", "promotion_month_income"])
  );
  const todayIncomeMoney = toNumberOrNull(
    pickFirstFieldDeep(p, ["ResellDaily", "resell_daily", "today_income", "promotion_today_income"])
  );
  const totalIncomeMoney = toNumberOrNull(
    pickFirstFieldDeep(p, ["ResellAll", "resell_all", "total_income", "total_profit", "promotion_total_income"])
  );
  const prevMonthIncomeMoney = toNumberOrNull(
    pickFirstFieldDeep(p, ["ResellBeforeMonth", "resell_before_month"])
  );

  const monthPoints = toNumberOrNull(pickFirstFieldDeep(p, ["ResellPointsMonthly", "resell_points_monthly"]));
  const todayPoints = toNumberOrNull(pickFirstFieldDeep(p, ["ResellPointsDaily", "resell_points_daily"]));
  const totalPoints = toNumberOrNull(pickFirstFieldDeep(p, ["ResellPointsAll", "resell_points_all"]));
  const prevMonthPoints = toNumberOrNull(pickFirstFieldDeep(p, ["ResellPointsBeforeMonth", "resell_points_before_month"]));
  const hasPointsIncomeField = [monthPoints, todayPoints, totalPoints, prevMonthPoints].some((v) => v !== null);
  const hasMoneyIncomeField = [monthIncomeMoney, todayIncomeMoney, totalIncomeMoney, prevMonthIncomeMoney].some((v) => v !== null);

  if (hasPointsIncomeField) {
    // 对齐雨云推广中心：收益相关指标优先使用积分口径并换算元。
    // 若某个积分字段缺失，则回退对应金额字段，避免阶段趋势出现缺失值。
    return {
      incomeMode: "points",
      monthIncome: monthPoints === null ? monthIncomeMoney : (monthPoints / 2000),
      todayIncome: todayPoints === null ? todayIncomeMoney : (todayPoints / 2000),
      totalIncome: totalPoints === null ? totalIncomeMoney : (totalPoints / 2000),
      prevMonthIncome: prevMonthPoints === null ? prevMonthIncomeMoney : (prevMonthPoints / 2000),
      monthPoints,
      totalPoints
    };
  }

  if (hasMoneyIncomeField) {
    return {
      incomeMode: "money",
      monthIncome: monthIncomeMoney,
      todayIncome: todayIncomeMoney,
      totalIncome: totalIncomeMoney,
      prevMonthIncome: prevMonthIncomeMoney,
      monthPoints,
      totalPoints
    };
  }

  return {
    incomeMode: "none",
    monthIncome: null,
    todayIncome: null,
    totalIncome: null,
    prevMonthIncome: null,
    monthPoints,
    totalPoints
  };
}

function parsePromoTotalIncomeFromUserData(userData) {
  const metrics = extractPromoIncomeMetrics(userData);
  return metrics.totalIncome;
}

function appendApiRequestCache(entry) {
  const list = readJsonCache(API_REQUEST_CACHE_KEY, []);
  const next = Array.isArray(list) ? list : [];
  next.push(entry);
  if (next.length > API_REQUEST_CACHE_LIMIT) {
    next.splice(0, next.length - API_REQUEST_CACHE_LIMIT);
  }
  writeJsonCache(API_REQUEST_CACHE_KEY, next);
}

function appendPromoDailySnapshotFromUserPayload(payload) {
  const data = extractPayloadData(payload);
  const metrics = extractPromoIncomeMetrics(data);
  const totalIncome = metrics.totalIncome;
  if (totalIncome === null || !Number.isFinite(totalIncome)) return;
  const incomeMode = metrics.incomeMode;
  const day = toDayKey();
  const nowIso = new Date().toISOString();
  const cache = readJsonCache(PROMO_DAILY_CACHE_KEY, { updatedAt: "", series: [], incomeMode: "" });
  const prevMode = String(cache?.incomeMode || "");
  const series = (prevMode && prevMode !== incomeMode)
    ? []
    : (Array.isArray(cache?.series) ? cache.series : []);
  const idx = series.findIndex((x) => x && x.day === day);
  if (idx >= 0) {
    const prev = Number(series[idx].totalIncome || 0);
    series[idx] = {
      day,
      totalIncome: Math.max(prev, Number(totalIncome)),
      lastSeenAt: nowIso
    };
  } else {
    series.push({
      day,
      totalIncome: Number(totalIncome),
      lastSeenAt: nowIso
    });
  }
  series.sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (series.length > PROMO_DAILY_CACHE_LIMIT) {
    series.splice(0, series.length - PROMO_DAILY_CACHE_LIMIT);
  }
  writeJsonCache(PROMO_DAILY_CACHE_KEY, { updatedAt: nowIso, incomeMode, series });
}

function readPromoDailySeries() {
  const cache = readJsonCache(PROMO_DAILY_CACHE_KEY, { updatedAt: "", series: [] });
  const series = Array.isArray(cache?.series) ? cache.series : [];
  return series
    .map((x) => ({
      day: String(x?.day || ""),
      totalIncome: Number(x?.totalIncome || 0),
      lastSeenAt: String(x?.lastSeenAt || "")
    }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day) && Number.isFinite(x.totalIncome))
    .sort((a, b) => a.day.localeCompare(b.day));
}

async function fetchCoupons(options = {}) {
  const force = Boolean(options.force);
  const preferCache = options.preferCache !== false;
  if (!isAuthenticated()) return [];

  if (preferCache && hasFreshCoupons() && !force) return store.userCoupons;
  if (!store.userCoupons.length) loadCouponCacheFromLocal();
  if (preferCache && hasFreshCoupons() && !force) return store.userCoupons;

  if (!force && couponInflightPromise) return couponInflightPromise;
  couponInflightPromise = (async () => {
    const payload = await apiGet("/user/coupons/", { force, ttlMs: 30000 });
    const data = extractPayloadData(payload);
    const items = Array.isArray(data) ? data : [];
    store.userCoupons = items;
    saveCouponCacheToLocal(items);
    return items;
  })();

  try {
    return await couponInflightPromise;
  } finally {
    couponInflightPromise = null;
  }
}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (store.auth.apiKey) h["x-api-key"] = store.auth.apiKey;
  if (store.auth.devToken) h["rain-dev-token"] = store.auth.devToken;
  return h;
}

function isAuthenticated() {
  return Boolean(String(store.auth.apiKey || "").trim() || String(store.auth.devToken || "").trim());
}

function normalizeSummary(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    domain: list(data.domain),
    rca: list(data.rca),
    rcs: list(data.rcs),
    rgpu: list(data.rgpu),
    rgs: list(data.rgs),
    ssl_order: list(data.ssl_order)
  };
}

function summaryIsEmpty(s) {
  return !s.domain.length && !s.rca.length && !s.rcs.length && !s.rgpu.length && !s.rgs.length && !s.ssl_order.length;
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
  return `${String(store.auth.baseUrl || "").trim()}|${String(store.auth.authMode || "apiKey").trim()}|${String(store.auth.account || "").trim()}|${String(store.auth.apiKey || "").trim()}|${String(store.auth.devToken || "").trim()}|${path}`;
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
      appendApiRequestCache({
        at: new Date().toISOString(),
        method,
        path,
        url,
        status: Number(res.status),
        ok: Boolean(res.ok),
        code: payload && typeof payload === "object" ? payload.code : undefined,
        // 控制体积，避免本地缓存无限膨胀
        payload:
          payload && typeof payload === "object"
            ? JSON.parse(JSON.stringify(payload, (k, v) => {
              if (typeof v === "string" && v.length > 200) return `${v.slice(0, 200)}...(truncated)`;
              return v;
            }))
            : payload
      });
      if (method === "GET" && path === "/user/" && res.ok) {
        appendPromoDailySnapshotFromUserPayload(payload);
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

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/$/, "") || "https://api.v2.rainyun.com";
}

function pickCredentialCandidate(payload, keys) {
  const v = pickFirstFieldDeep(payload, keys);
  if (v === null || v === undefined || v === "") return "";
  return String(v).trim();
}

function extractAuthCredential(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const apiKey = pickCredentialCandidate(root, [
    "APIKey", "api_key", "apikey", "apiKey", "x_api_key", "x-api-key", "XApiKey", "ApiKey", "key"
  ]);
  const token = pickCredentialCandidate(root, [
    "APIToken", "api_token", "access_token", "token", "rain_dev_token", "rainDevToken", "dev_token", "devToken"
  ]);
  return {
    apiKey: apiKey || "",
    devToken: token || ""
  };
}

function extractAuthCredentialFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return { apiKey: "", devToken: "" };
  const directApiKey = String(headers.get("x-api-key") || headers.get("X-API-KEY") || "").trim();
  const directDevToken = String(headers.get("rain-dev-token") || headers.get("Rain-Dev-Token") || "").trim();
  const auth = String(headers.get("authorization") || headers.get("Authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return {
    apiKey: directApiKey || "",
    devToken: directDevToken || bearer || ""
  };
}

function authBodyCandidates(account, password, extras = {}) {
  const accountText = String(account || "").trim();
  const pwd = String(password || "");
  const ticket = String(extras.captchaTicket || "").trim();
  const randstr = String(extras.captchaRandstr || "").trim();
  if (ticket) {
    // 对齐主站：验证码场景只提交一次标准登录参数，避免票据被多次重放消耗。
    return [{
      field: accountText,
      password: pwd,
      vticket: ticket,
      vrandstr: randstr
    }];
  }
  return [
    { field: accountText, password: pwd },
    { account: accountText, password: pwd },
    { username: accountText, password: pwd },
    { email: accountText, password: pwd },
    { name: accountText, password: pwd }
  ];
}

async function tryAuthAction({ baseUrl, account, password, captchaTicket = "", captchaRandstr = "" }) {
  const hasCaptcha = Boolean(String(captchaTicket || "").trim());
  const paths = hasCaptcha ? ["/user/login"] : AUTH_LOGIN_PATHS;
  const requestBodies = authBodyCandidates(account, password, { captchaTicket, captchaRandstr });
  const base = normalizeBaseUrl(baseUrl);
  let lastError = null;
  const errors = [];

  for (const path of paths) {
    for (const body of requestBodies) {
      const url = `${base}${path}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store"
        });
        const text = await res.text();
        let payload = {};
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { raw: text };
        }

        if (!res.ok) {
          const msg = String(pickFirstFieldDeep(payload, ["msg", "message", "error", "detail"]) || `HTTP ${res.status}`);
          throw new Error(`${path} => ${msg}`);
        }

        const cred = extractAuthCredential(payload);
        const headerCred = extractAuthCredentialFromHeaders(res.headers);
        const mergedCred = {
          apiKey: cred.apiKey || headerCred.apiKey || "",
          devToken: cred.devToken || headerCred.devToken || ""
        };
        if (mergedCred.apiKey || mergedCred.devToken) {
          return { ...mergedCred, path, payload };
        }
        if (hasCaptcha && path === "/user/login") {
          // 主站现有行为：登录可能仅建立 Cookie 会话，不直接返回 APIKey/Token。
          return { apiKey: "", devToken: "", path, payload, sessionOnly: true };
        }
        throw new Error(`${path} => 登录响应缺少认证字段（APIKey/Token）`);
      } catch (e) {
        lastError = e;
        errors.push(String(e || ""));
      }
    }
  }

  const firstUseful = errors.find((x) => !x.includes("=> 找不到请求的对象/资源") && !x.includes("=> HTTP 404"));
  throw new Error(`未能通过登录接口获取认证信息：${firstUseful || String(lastError || "unknown")}`);
}

let tencentCaptchaSdkPromise = null;
function ensureTencentCaptchaSdk() {
  if (typeof window === "undefined") return Promise.reject(new Error("当前环境不支持验证码"));
  if (window.TencentCaptcha) return Promise.resolve();
  if (tencentCaptchaSdkPromise) return tencentCaptchaSdkPromise;
  tencentCaptchaSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://turing.captcha.qcloud.com/TCaptcha.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("验证码 SDK 加载失败"));
    document.head.appendChild(script);
  }).catch((e) => {
    tencentCaptchaSdkPromise = null;
    throw e;
  });
  return tencentCaptchaSdkPromise;
}

async function runTencentCaptcha() {
  await ensureTencentCaptchaSdk();
  return new Promise((resolve, reject) => {
    try {
      const inst = new window.TencentCaptcha(TENCENT_CAPTCHA_APP_ID, (res = {}) => {
        if (res.ret !== 0) {
          if (res.ret === 2) {
            reject(new Error("已取消验证码"));
          } else {
            reject(new Error("验证码未完成"));
          }
          return;
        }
        if (res.errorCode) {
          reject(new Error(`验证码校验失败(${res.errorCode})`));
          return;
        }
        resolve({
          ticket: String(res.ticket || ""),
          randstr: String(res.randstr || "")
        });
      });
      inst.show();
    } catch (e) {
      reject(new Error(`验证码模块异常：${String(e || "unknown")}`));
    }
  });
}

async function validateAuth(baseUrl, apiKey, devToken) {
  const base = normalizeBaseUrl(baseUrl);
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = String(apiKey).trim();
  if (devToken) headers["rain-dev-token"] = String(devToken).trim();
  const res = await fetch(`${base}/user/`, {
    method: "GET",
    headers,
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`认证校验失败（/user/ ${res.status}）`);
  }
}

function parseExpireForRenew(v) {
  if (v === null || v === undefined || v === "") return { text: "-", daysText: "-", days: Number.POSITIVE_INFINITY };
  const n = Number(v);
  let d;
  if (Number.isFinite(n)) {
    if (n <= 0) return { text: "-", daysText: "-", days: Number.POSITIVE_INFINITY };
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

function renewDetailPath(kindName, productId) {
  if (kindName === "rcs") return `/product/rcs/${productId}/`;
  if (kindName === "rgpu") return `/product/rcs/${productId}/`;
  if (kindName === "rgs") return `/product/rgs/${productId}/`;
  if (kindName === "rca") return `/product/rca/project/${productId}/`;
  if (kindName === "domain") return `/product/domain/${productId}/`;
  return "";
}

async function tryGetRenewPrice(kindName, id) {
  try {
    if (kindName !== "rcs" && kindName !== "rgpu" && kindName !== "rgs") return "";
    const renewKind = kindName === "rgpu" ? "rcs" : kindName;
    const p = await apiGet(`/product/${renewKind}/price?scene=renew&product_id=${id}&duration=1&with_coupon_id=0&is_old=true`);
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

async function collectRenewRowsFromSummary(summary, options = {}) {
  const maxDays = Number.isFinite(Number(options.maxDays)) ? Number(options.maxDays) : 7;
  const includeRenewPrice = Boolean(options.includeRenewPrice);
  const kinds = ["rcs", "rgpu", "rgs", "rca", "domain"];
  const rows = [];
  const tasks = [];

  for (const kindName of kinds) {
    const ids = (summary?.[kindName] || []).slice(0, 30);
    for (const productId of ids) {
      tasks.push(async () => {
        const detailPath = renewDetailPath(kindName, productId);
        if (!detailPath) return null;
        try {
          const payload = await apiGet(detailPath, { ttlMs: 15000 });
          const detailData = extractPayloadData(payload);
          const d = detailData && detailData.Data && typeof detailData.Data === "object" ? detailData.Data : detailData;
          const name = String(
            pickFirstFieldDeep(d, ["name", "domain", "OsName", "HostName", "title", "domain_name"]) ||
            `${getKindLabel(kindName)} #${productId}`
          );
          const statusRaw = String(pickFirstFieldDeep(d, ["status", "Status", "state"]) || "-");
          const autoRaw = pickFirstFieldDeep(d, ["AutoRenew", "auto_renew", "expire_notice"]);
          const expRaw = pickFirstFieldDeep(d, ["ExpDate", "exp_date", "expired_at", "expire_at", "end_time", "due_time"]);
          const exp = parseExpireForRenew(expRaw);
          if (!(Number.isFinite(exp.days) && exp.days >= 0 && exp.days <= maxDays)) return null;
          const renewPrice = includeRenewPrice ? await tryGetRenewPrice(kindName, productId) : "";
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

  let cursor = 0;
  const concurrency = 6;
  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor;
      cursor += 1;
      const item = await tasks[idx]();
      if (item) rows.push(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return rows.sort((a, b) => a.days - b.days).slice(0, 50);
}

function isRgpuLikeRcsDetail(detailData) {
  const d = detailData && detailData.Data && typeof detailData.Data === "object" ? detailData.Data : detailData;
  const texts = [
    d?.OsName,
    d?.HostName,
    d?.Plan?.subtype,
    d?.Plan?.plan_name,
    d?.Plan?.machine,
    d?.Plan?.chinese,
    d?.Node?.Subtype,
    d?.Node?.Machine,
    d?.Node?.ChineseName
  ]
    .map((x) => String(x || "").toLowerCase())
    .filter(Boolean)
    .join(" ");

  // 兼容常见显卡机型/命名，避免显卡云混入云服务器列表。
  return /(gpu|v100|a100|a800|h100|h800|l20|l40|p40|p100|tesla|rtx|quadro|4090|4080|4070|4060|3090)/i.test(texts);
}

async function splitRcsAndRgpuIds(rcsIds, force = false) {
  const ids = [...new Set((Array.isArray(rcsIds) ? rcsIds : []).map((x) => String(x)).filter(Boolean))];
  if (!ids.length) return { rcs: [], rgpu: [] };

  const rcs = [];
  const rgpu = [];
  const concurrency = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const idx = cursor;
      cursor += 1;
      const id = ids[idx];
      try {
        const payload = await apiGet(`/product/rcs/${id}/`, { force, ttlMs: 15000 });
        const detail = extractPayloadData(payload);
        if (isRgpuLikeRcsDetail(detail)) {
          rgpu.push(id);
        } else {
          rcs.push(id);
        }
      } catch {
        rcs.push(id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return { rcs, rgpu };
}

function hasFreshRenewRows() {
  if (!Array.isArray(store.renewDueRows)) return false;
  if (!store.renewDueAt) return false;
  return Date.now() - store.renewDueAt < RENEW_ROWS_TTL_MS;
}

function hasFreshRenewPriceRows() {
  if (!hasFreshRenewRows()) return false;
  if (!store.renewDuePriceAt) return false;
  if (Date.now() - store.renewDuePriceAt >= RENEW_PRICE_TTL_MS) return false;
  return store.renewDueRows.every((row) => String(row.renewPrice || "").trim() !== "");
}

async function enrichRenewRowsWithPrice(force = false) {
  if (!Array.isArray(store.renewDueRows) || !store.renewDueRows.length) return [];
  if (!force && hasFreshRenewPriceRows()) return store.renewDueRows;
  if (!force && renewPriceInflightPromise) return renewPriceInflightPromise;

  renewPriceInflightPromise = (async () => {
    const rows = store.renewDueRows.map((x) => ({ ...x }));
    const queue = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => force || String(row.renewPrice || "").trim() === "");
    let cursor = 0;
    const concurrency = Math.min(4, queue.length || 1);

    async function worker() {
      while (cursor < queue.length) {
        const idx = cursor;
        cursor += 1;
        const { row, index } = queue[idx];
        try {
          const renewPrice = await tryGetRenewPrice(row.kind, row.id);
          if (renewPrice) rows[index].renewPrice = renewPrice;
        } catch {
          // 忽略单项续费价格失败，避免整页阻断
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    store.renewDueRows = rows;
    store.renewDueCount = rows.length;
    store.renewDuePriceAt = Date.now();
    return rows;
  })();

  try {
    return await renewPriceInflightPromise;
  } finally {
    renewPriceInflightPromise = null;
  }
}

async function refreshSummary(force = false) {
  if (!isAuthenticated()) return;
  if (!force && store.rawSummary && store.userProfile && hasFreshRenewRows()) {
    return;
  }
  if (summaryInflightPromise) return summaryInflightPromise;
  if (force) {
    apiGetCache.clear();
  }

  summaryInflightPromise = (async () => {
    store.loading = true;
    try {
      if (!store.userCoupons.length) loadCouponCacheFromLocal();
      fetchCoupons({ force, preferCache: true }).catch((e) => {
        reportLog("WARN", "user_coupons_load_error", { error: String(e) });
      });

      const [userRes, newsRes, productRes] = await Promise.allSettled([
        apiGet("/user/", { force, ttlMs: 15000 }),
        apiGet("/news", { force, ttlMs: 10000 }),
        apiGet("/product/", { force, ttlMs: 10000 })
      ]);

      if (userRes.status === "fulfilled") {
        const userPayload = userRes.value;
        store.userProfile = userPayload && userPayload.data ? userPayload.data : userPayload;
      } else {
        reportLog("WARN", "user_profile_load_error", { error: String(userRes.reason) });
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
      store.productOverview = extractPayloadData(p1);
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

      // API 的 id_list 中，显卡云可能混在 rcs 内；这里按明细字段拆分为独立 rgpu。
      if (Array.isArray(s.rcs) && s.rcs.length) {
        const split = await splitRcsAndRgpuIds(s.rcs, force);
        s.rcs = split.rcs;
        s.rgpu = [...new Set([...(Array.isArray(s.rgpu) ? s.rgpu : []), ...split.rgpu])];
      } else if (!Array.isArray(s.rgpu)) {
        s.rgpu = [];
      }

      store.summary = s;
      store.summarySource = source;
      store.lastSyncAt = new Date().toLocaleTimeString();
      try {
        const rows = await collectRenewRowsFromSummary(s, { maxDays: 7, includeRenewPrice: false });
        store.renewDueRows = rows;
        store.renewDueCount = rows.length;
        store.renewDueAt = Date.now();
        store.renewDuePriceAt = 0;
      } catch (e) {
        reportLog("WARN", "renew_due_count_error", { error: String(e) });
        store.renewDueRows = [];
        store.renewDueCount = 0;
        store.renewDueAt = 0;
        store.renewDuePriceAt = 0;
      }
      if (summaryIsEmpty(s)) {
        toast("当前账号暂无产品数据");
      }
    } catch (e) {
      toast(String(e));
      reportLog("ERROR", "summary_load_error", { error: String(e) });
      store.renewDueRows = [];
      store.renewDueCount = 0;
      store.renewDueAt = 0;
      store.renewDuePriceAt = 0;
    } finally {
      store.loading = false;
      summaryInflightPromise = null;
    }
  })();

  return summaryInflightPromise;
}

function getKindLabel(kind) {
  const map = { rcs: "云服务器", rgpu: "显卡云电脑", rca: "云应用", rgs: "游戏云", domain: "域名服务", ssl_order: "SSL证书" };
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

function normalizeUpdateNotes(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item === null || item === undefined) return "";
        if (typeof item === "string") return item;
        if (typeof item === "object") {
          return String(
            pickFirstFieldDeep(item, ["note", "notes", "text", "title", "content", "message", "body"]) || ""
          );
        }
        return String(item);
      })
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  if (raw && typeof raw === "object") {
    const nested =
      pickFirstFieldDeep(raw, ["notes", "body", "text", "content", "message", "desc", "description"]) ||
      pickFirstFieldDeep(raw, ["changes", "items", "logs", "list"]);
    return normalizeUpdateNotes(nested);
  }

  const text = String(raw || "").replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function formatUpdateNotesForDialog(notesText) {
  const lines = String(notesText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "暂无更新说明";
  return lines.map((line) => `- ${line}`).join("\n");
}

function extractUpdateInfo(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const version = pickUpdateField(p, ["version", "latestVersion", "tag_name"]);
  const notes = normalizeUpdateNotes(pickUpdateField(p, ["notes", "body", "changes", "changelog", "logs"]));
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
  const countFromAny = (...vals) => {
    for (const v of vals) {
      if (Array.isArray(v)) return v.length;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return 0;
  };
  const addonCounts = (d) => {
    const rbs = countFromAny(detailEnvelope.RBSList, d.RBSList, d.Backup);
    const eDisk = countFromAny(detailEnvelope.EDiskList, d.EDiskList, Number(d.DataDisk) > 0 ? 1 : 0);
    const ipByList = countFromAny(detailEnvelope.EIPList, d.EIPList);
    const natByList = countFromAny(detailEnvelope.NatList, d.NatList);
    const natIp = String(d.NatPublicIP || d.MainIPv4 || "").trim();
    const ipCount = ipByList > 0 ? ipByList : (natByList > 0 ? natByList : (natIp && natIp !== "-" ? 1 : 0));
    const vnetByList = countFromAny(detailEnvelope.VNets, d.VNets);
    const vnetCount = vnetByList > 0 ? vnetByList : (Number(d.VnetID || 0) > 0 ? 1 : 0);
    return { rbs, eDisk, ipCount, vnetCount };
  };
  const getChargeTypeText = (raw) => {
    const s = String(raw || "").toLowerCase();
    if (!s) return "-";
    if (s.includes("dynamic")) return "动态计费";
    if (s.includes("elastic")) return "固定计费";
    return String(raw);
  };
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

  if (kind === "rcs" || kind === "rgpu") {
    const d = dataRoot || {};
    const plan = d.Plan || {};
    const node = d.Node || {};
    const usage = d.UsageData || {};
    const counts = addonCounts(d);
    const eipList = Array.isArray(detailEnvelope.EIPList) ? detailEnvelope.EIPList : (Array.isArray(d.EIPList) ? d.EIPList : []);
    const ipv6 = eipList.find((x) => String(x.Type || "").toLowerCase().includes("ipv6"));
    const showIp = (ipv6 && ipv6.IP) || d.NatPublicIP || d.MainIPv4 || "-";
    const lineText = String(plan.line || node.IpZone || d.Zone || node.Region || "-");
    const baseInfo = [
      { key: "产品类型", value: kind === "rgpu" ? "显卡云电脑" : "云服务器" },
      { key: "产品ID", value: String(id) },
      { key: "名称", value: d.OsName || d.HostName || "-" },
      { key: "状态", value: d.Status || "-" },
      { key: "线路", value: lineText },
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
      { key: "线路", value: lineText },
      { key: "备份数量", value: `${String(counts.rbs)} 个` },
      { key: "数据盘", value: `${String(counts.eDisk)} 个` },
      { key: "IP数量", value: `${String(counts.ipCount)} 个` },
      { key: "私有网络", value: `${String(counts.vnetCount)} 个` }
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

  if (kind === "rgs") {
    const d = dataRoot || {};
    const plan = d.Plan || d.plan || {};
    const node = d.Node || d.node || {};
    const usage = d.UsageData || d.usage_data || d.usage || {};
    const natList = Array.isArray(detailEnvelope.NatList) ? detailEnvelope.NatList : (Array.isArray(d.NatList) ? d.NatList : []);
    const counts = addonCounts(d);
    const eipList = Array.isArray(detailEnvelope.EIPList) ? detailEnvelope.EIPList : (Array.isArray(d.EIPList) ? d.EIPList : []);
    const ipv6 = eipList.find((x) => String(x.Type || "").toLowerCase().includes("ipv6"));
    const showIp = (ipv6 && ipv6.IP) || d.NatPublicIP || d.MainIPv4 || d.IP || "-";
    const subtype = String(plan.subtype || node.Subtype || d.Subtype || "").toLowerCase();
    const isMcsm = subtype.includes("mcsm");
    const eggType = d.EggType && typeof d.EggType === "object" ? d.EggType : {};
    const eggMeta = eggType.egg && typeof eggType.egg === "object" ? eggType.egg : {};
    const gameTitle = String(eggMeta.title || eggMeta.name || eggType.egg_name || d.EggTypeId || "-");
    const accessHost = d.NatPublicDomain || d.NATSpareDomain || d.NatPublicIP || "-";
    const natPorts = natList
      .map((x) => {
        const out = x && x.PortOut !== undefined ? String(x.PortOut) : "";
        const type = x && x.PortType ? String(x.PortType) : "";
        return out ? `${out}${type ? `/${type}` : ""}` : "";
      })
      .filter(Boolean)
      .join(", ");
    const displayName = isMcsm
      ? String(pickFirstFieldDeep(d, ["McsmUserName", "EggType.egg.title", "EggType.egg_name"]) || `MCSM #${id}`)
      : String(d.OsName || d.HostName || d.Name || "-");
    const gameExpireRaw = pickFirstFieldDeep(d, ["ExpDate", "exp_date", "expired_at", "expire_at", "end_time", "due_time"]);
    const gameExpireAt = formatDateTime(gameExpireRaw) || "-";
    const lineText = String(plan.line || node.IpZone || d.Zone || node.Region || "-");
    const baseInfo = [
      { key: "产品类型", value: "游戏云" },
      { key: "产品ID", value: String(id) },
      { key: "名称", value: displayName },
      { key: "状态", value: d.Status || "-" },
      { key: "线路", value: lineText },
      { key: "公网IP", value: isMcsm ? accessHost : showIp },
      { key: "配置", value: plan.chinese || plan.plan_name || d.PlanName || d.Spec || "-" },
      { key: "到期时间", value: gameExpireAt }
    ];
    const commonRows = [
      { key: "CPU", value: `${String(d.CPU ?? plan.cpu ?? "-")} 核` },
      { key: "内存", value: `${String(d.Memory ?? plan.memory ?? "-")} GB` },
      { key: "系统盘", value: `${String(d.BaseDisk ?? d.Disk ?? plan.base_disk ?? plan.disk ?? "-")} GB` },
      { key: "计费模式", value: getChargeTypeText(plan.charge_type || d.charge_type) },
      { key: "电量", value: d.CpuPoint === undefined ? "-" : `${String(d.CpuPoint)} 点` },
      { key: "上行带宽", value: `${String(d.NetIn ?? plan.net_in ?? "-")} Mbps` },
      { key: "下行带宽", value: `${String(d.NetOut ?? plan.net_out ?? "-")} Mbps` },
      { key: "备份数量", value: `${String(counts.rbs)} 个` },
      { key: "数据盘", value: `${String(counts.eDisk)} 个` },
      { key: "IP数量", value: `${String(counts.ipCount)} 个` },
      { key: "私有网络", value: `${String(counts.vnetCount)} 个` }
    ];
    const configRows = isMcsm
      ? [
          ...commonRows,
          { key: "接入地址", value: accessHost },
          { key: "开放端口", value: natPorts || "-" },
          { key: "游戏类型", value: String(gameTitle) },
          { key: "运行镜像", value: String(eggType.mcsm_docker || eggType.docker || "-") },
          { key: "面板账号", value: String(d.McsmUserName || d.McsmUser?.name || "-") },
          { key: "实例UUID", value: String(d.ServerUUID || d.DaemonUUID || "-") },
          { key: "线路", value: lineText }
        ]
      : [
          ...commonRows,
          { key: "系统", value: d.OsInfo?.chinese_name || d.OsName || "-" },
          { key: "线路", value: lineText }
        ];
    const monitorRows = [
      { key: "CPU(%)", value: usage.CPU === undefined ? "-" : Number(usage.CPU).toFixed(2) },
      {
        key: "内存使用",
        value: usage.FreeMem !== undefined && usage.MaxMem !== undefined
          ? `${formatBytes(Math.max(0, usage.MaxMem - usage.FreeMem))} / ${formatBytes(usage.MaxMem)}`
          : (usage.memory_used !== undefined && usage.memory_total !== undefined
            ? `${formatBytes(usage.memory_used)} / ${formatBytes(usage.memory_total)}`
            : "-")
      },
      { key: "磁盘读速率", value: usage.DiskRead === undefined ? "-" : formatRate(usage.DiskRead) },
      { key: "磁盘写速率", value: usage.DiskWrite === undefined ? "-" : formatRate(usage.DiskWrite) },
      { key: "上行速率", value: usage.NetOut === undefined ? "-" : formatRate(usage.NetOut) },
      { key: "下行速率", value: usage.NetIn === undefined ? "-" : formatRate(usage.NetIn) }
    ];

    const chargeType = String(plan.charge_type || d.charge_type || "").toLowerCase();
    const hasTrafficBase = Number(plan.traffic_base_gb || d.traffic_base_gb || 0) > 0;
    const hasTrafficPrice = !!((plan.traffic_price || d.traffic_price) && typeof (plan.traffic_price || d.traffic_price) === "object" && Object.keys(plan.traffic_price || d.traffic_price).length);
    const isTrafficMetered = chargeType.includes("traffic") || hasTrafficBase || hasTrafficPrice;
    const trafficBytes = d.TrafficBytes ?? d.traffic_bytes ?? d.TrafficLeft ?? d.traffic_left;
    const serverInfo = {
      id: String(d.ID || id),
      tag: d.Tag && String(d.Tag).trim() ? String(d.Tag) : "未设定",
      status: d.Status || "-",
      node: node.ChineseName || d.Zone || node.Region || "-",
      expireAt: gameExpireAt,
      showTraffic: isTrafficMetered,
      trafficLeft: trafficBytes !== undefined ? formatBytes(trafficBytes) : "-"
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
    rgpu: ["cpu", "memory", "mem", "disk", "bandwidth", "os", "image", "traffic", "port"],
    rca: ["runtime", "cpu", "memory", "disk", "domain", "php", "region"],
    rgs: ["cpu", "memory", "mem", "disk", "bandwidth", "os", "image", "traffic", "port"],
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
        <div class="m-header-main">
          <h1>雨云 App</h1>
          <p>{{ title }}</p>
        </div>
        <button class="m-header-account" @click="goAccount">
          <img :src="avatar" alt="account" class="m-header-account-avatar" />
          <span>{{ isAuthed ? '已登录' : '去登录' }}</span>
        </button>
      </header>

      <main :class="mainClass"><slot /></main>

      <nav class="m-tabbar">
        <button :class="tabClass('/home')" @click="go('/home')"><i class="fa-solid fa-house"></i><span>主页</span></button>
        <button :class="tabClass('/promo')" @click="go('/promo')"><i class="fa-solid fa-bullhorn"></i><span>推广中心</span></button>
        <button :class="tabClass(isAuthed ? '/me' : '/login')" @click="go(isAuthed ? '/me' : '/login')"><i class="fa-solid fa-user"></i><span>我的</span></button>
      </nav>
    </div>
  `,
  props: ["title"],
  setup() {
    const router = useRouter();
    const route = useRoute();
    const isAuthed = computed(() => isAuthenticated());
    const touchState = { active: false, startX: 0, startY: 0, deltaX: 0, deltaY: 0 };
    const isTabRootPath = (path) => {
      const p = String(path || "/");
      return p === "/" || p === "/home" || p === "/promo" || p === "/me" || p === "/login";
    };
    const tabClass = (path) => ["tab-item", route.path.startsWith(path) ? "active" : ""];
    // Tab 页面切换不进入 history，避免返回键在三个 Tab 之间来回切换。
    const go = (path) => router.replace(path);
    const goAccount = () => go(isAuthed.value ? "/me" : "/login");
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
    const avatar = computed(() => {
      const profile = store.userProfile || {};
      return normalizeAssetUrl(
        pickFirstFieldDeep(profile, ["IconUrl", "iconUrl", "icon_url", "avatar", "avatar_url", "headimgurl", "head_img", "face"]) ||
        AVATAR
      );
    });
    return { go, goAccount, tabClass, mainClass, logo: BRAND_LOGO, onTouchStart, onTouchMove, onTouchEnd, isAuthed, avatar };
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
          <button class="entry" v-for="item in productEntries" :key="item.kind" @click="openEntry(item)">
            <div class="entry-head">
              <i :class="item.icon"></i>
              <span>{{ item.label }}</span>
            </div>
            <div class="entry-meta">
              <em>{{ item.count }}</em>
              <small v-if="item.external">主站</small>
            </div>
          </button>
        </div>
      </section>
    </MobileShell>
  `,
  setup() {
    const router = useRouter();
    const summary = computed(() => store.summary);
    const overview = computed(() => (store.productOverview && typeof store.productOverview === "object" ? store.productOverview : {}));
    const profile = computed(() => store.userProfile || {});
    const rawData = computed(() => (store.rawSummary && store.rawSummary.data) ? store.rawSummary.data : {});
    const source = computed(() => store.summarySource || "--");
    function idsCount(kind) {
      const v = summary.value[kind];
      return Array.isArray(v) ? v.length : 0;
    }
    function overviewCount(kind) {
      const obj = overview.value && typeof overview.value === "object" ? overview.value[kind] : null;
      if (obj === null || obj === undefined) return 0;
      if (Array.isArray(obj)) return obj.length;
      if (typeof obj === "object") {
        const n = Number(obj.TotalCount ?? obj.total_count ?? obj.count ?? obj.total);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      }
      const n = Number(obj);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    const productEntries = computed(() => {
      const list = [
        { kind: "rcs", label: "云服务器", icon: "fa-solid fa-server", route: "/product/rcs", external: false, count: Math.max(idsCount("rcs"), overviewCount("rcs")) },
        { kind: "rgs", label: "游戏云", icon: "fa-solid fa-gamepad", route: "/product/rgs", external: false, count: Math.max(idsCount("rgs"), overviewCount("rgs")) },
        { kind: "rca", label: "云应用", icon: "fa-solid fa-cloud", route: "/product/rca", external: false, count: Math.max(idsCount("rca"), overviewCount("rca")) },
        { kind: "rgpu", label: "显卡云电脑", icon: "fa-solid fa-desktop", route: "/product/rgpu", external: false, count: Math.max(idsCount("rgpu"), overviewCount("rgpu")) },
        { kind: "ros", label: "对象存储", icon: "fa-solid fa-database", route: "https://app.rainyun.com/apps/ros/list", external: true, count: overviewCount("ros") },
        { kind: "rbm", label: "裸金属物理机", icon: "fa-solid fa-microchip", route: "https://app.rainyun.com/apps/rbm/list", external: true, count: overviewCount("rbm") },
        { kind: "domain", label: "域名服务", icon: "fa-solid fa-globe", route: "/product/domain", external: false, count: Math.max(idsCount("domain"), overviewCount("domain")) },
        { kind: "ssl_order", label: "SSL证书", icon: "fa-solid fa-key", route: "/product/ssl_order", external: false, count: Math.max(idsCount("ssl_order"), overviewCount("ssl")) },
        { kind: "rvh", label: "虚拟主机", icon: "fa-solid fa-hard-drive", route: "https://app.rainyun.com/apps/rvh/list", external: true, count: overviewCount("rvh") },
        { kind: "rshop", label: "软件商店", icon: "fa-solid fa-shop", route: "https://app.rainyun.com/apps/rshop/list", external: true, count: 0 }
      ];
      return list;
    });
    const productTotal = computed(() => productEntries.value.reduce((sum, item) => sum + Number(item.count || 0), 0));
    const tickets = computed(() => 0);
    const renew = computed(() => {
      const n = Number(store.renewDueCount);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
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
    const openEntry = (item) => {
      if (!item) return;
      if (item.external) {
        window.open(String(item.route || "https://app.rainyun.com/apps"), "_blank");
        return;
      }
      const k = String(item.kind || "");
      if (!k) return;
      goList(k);
    };
    const goTodo = (type) => router.push(`/todo/${type}`);
    const refresh = () => refreshSummary(true);
    const openNews = (url) => {
      const u = String(url || "").trim();
      if (!u) return;
      window.open(u, "_blank");
    };

    onMounted(() => refreshSummary(false));

    return { summary, source, productTotal, points, monthCost, balance, tickets, renew, coupons, syncing, lastSyncAt, activityNews, productEntries, openEntry, goList, goTodo, refresh, openNews };
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

    async function loadRenews() {
      await refreshSummary(false);
      const baseRows = Array.isArray(store.renewDueRows) ? store.renewDueRows.map((x) => ({ ...x })) : [];
      renewRows.value = baseRows;
      if (!baseRows.length) return;
      const pricedRows = await enrichRenewRowsWithPrice(false);
      renewRows.value = Array.isArray(pricedRows) ? pricedRows.map((x) => ({ ...x })) : [];
    }

    async function loadCoupons() {
      const productMap = { rcs: "云服务器", rca: "云应用", rgs: "游戏云", ros: "对象存储", rbm: "裸金属", rvh: "虚拟主机" };
      const sceneMap = { renew: "续费", create: "新购", upgrade: "升级" };
      const mapCouponRows = (items) => (Array.isArray(items) ? items : []).map((item) => {
        const rawType = String(item.type || "normal").toLowerCase();
        const used = Number(item.use_date || 0) > 0;
        const expired = Number(item.exp_date || 0) > 0 && (Number(item.exp_date) * 1000 < Date.now());
        const statusText = used ? "已使用" : (expired ? "已过期" : "可使用");
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

      if (Array.isArray(store.userCoupons) && store.userCoupons.length) {
        couponRows.value = mapCouponRows(store.userCoupons);
      }

      const items = await fetchCoupons({ force: false, preferCache: true });
      couponRows.value = mapCouponRows(items);
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
      const kindName = String(kind.value || "");
      const map = {
        rgpu: "https://app.rainyun.com/apps/rgpu/list",
        rcs: "https://app.rainyun.com/apps/rcs/list",
        rgs: "https://app.rainyun.com/apps/rgs/list",
        rca: "https://app.rainyun.com/apps/rca/list"
      };
      window.open(map[kindName] || "https://app.rainyun.com/", "_blank");
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
          <a-typography-title :heading="6" class="typo-title">{{ (kind === 'rcs' || kind === 'rgpu' || kind === 'rgs') ? '服务器信息' : (kind === 'rca' ? '应用信息' : '基础状态') }}</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">{{ detailPath || '--' }}</a-typography-text>
        </div>
        <div v-if="kind === 'rcs' || kind === 'rgpu' || kind === 'rgs' || kind === 'rca'" class="server-info-list">
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
          monitor: `/product/rcs/${productId}/monitor`,
          detailCandidates: [],
          monitorCandidates: []
        };
      }
      if (kindName === "rgpu") {
        return {
          detail: `/product/rcs/${productId}/`,
          monitor: `/product/rcs/${productId}/monitor`,
          detailCandidates: [],
          monitorCandidates: []
        };
      }
      if (kindName === "rgs") {
        return {
          detail: `/product/rgs/${productId}/`,
          monitor: `/product/rgs/${productId}/monitor`,
          detailCandidates: [`/product/rgs/game/${productId}/`, `/product/rgs/server/${productId}/`],
          monitorCandidates: [`/product/rgs/${productId}/metrics`, `/product/rgs/game/${productId}/monitor`]
        };
      }
      if (kindName === "rca") {
        return {
          detail: `/product/rca/project/${productId}/`,
          monitor: `/product/rca/project/${productId}/metrics`,
          detailCandidates: [],
          monitorCandidates: []
        };
      }
      if (kindName === "domain") {
        return {
          detail: `/product/domain/${productId}/`,
          monitor: "",
          detailCandidates: [],
          monitorCandidates: []
        };
      }
      if (kindName === "ssl_order") {
        return {
          detail: "",
          monitor: "",
          detailCandidates: [],
          monitorCandidates: []
        };
      }
      return { detail: "", monitor: "", detailCandidates: [], monitorCandidates: [] };
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
        let detailData = {};
        {
          const detailPaths = [endpoint.detail, ...(endpoint.detailCandidates || [])].filter(Boolean);
          let detailOk = false;
          for (const p of detailPaths) {
            try {
              const detailPayload = await apiGet(p);
              detailData = extractPayloadData(detailPayload);
              detailPath.value = p;
              detailOk = true;
              break;
            } catch {
              // continue
            }
          }
          if (!detailOk) throw new Error("详情接口请求失败");
        }
        let monitorData = {};
        if (endpoint.monitor) {
          try {
            const tryPaths = [
              endpoint.monitor,
              ...(endpoint.monitorCandidates || []),
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
        <div class="panel-title promo-kpi-title">
          <a-typography-title :heading="6" class="typo-title">长期经营概览</a-typography-title>
          <a-button class="line-btn sm" size="small" type="outline" @click="openDailyReport">每日收益分析</a-button>
        </div>
        <div><b>{{ promo.totalIncome }}</b><span>总收益(元)</span></div>
        <div><b>{{ promo.subUserAll }}</b><span>总客户数</span></div>
        <div><b>{{ promo.totalStockAll }}</b><span>累计进货</span></div>
        <div><b>{{ promo.totalPointsAll }}</b><span>累计积分</span></div>
        <div><b>{{ promo.incomePerUser }}</b><span>单客累计贡献(元)</span></div>
        <div><b>{{ promo.avgAllDaily }}</b><span>累计日均收益(元)</span></div>
        <div><b>{{ promo.activeDays }}</b><span>经营天数</span></div>
      </section>

      <section class="panel kpi-grid">
        <div class="panel-title promo-kpi-title">
          <a-typography-title :heading="6" class="typo-title">阶段趋势</a-typography-title>
          <a-typography-text class="panel-subtext" type="secondary">近周期指标</a-typography-text>
        </div>
        <div><b>{{ promo.monthIncome }}</b><span>本月收益(元)</span></div>
        <div><b>{{ promo.prevMonthIncome }}</b><span>上月收益(元)</span></div>
        <div><b>{{ promo.momRate }}</b><span>收益环比</span></div>
        <div><b>{{ promo.todayStock }}</b><span>今日进货</span></div>
        <div><b>{{ promo.monthStock }}</b><span>本月进货</span></div>
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

      <div v-if="showDailyReport" class="promo-report-mask" @click.self="closeDailyReport">
        <div class="promo-report-modal">
          <div class="promo-report-head">
            <h3>每日收益分析</h3>
            <button class="about-close" @click="closeDailyReport"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="promo-report-meta">
            <span>数据来源：<code>/user/</code></span>
            <span>分析时间：{{ dailyReport.generatedAt }}</span>
          </div>
          <div class="promo-report-kv">
            <div><b>{{ dailyReport.todayIncome }}</b><span>今日收益</span></div>
            <div><b>{{ dailyReport.yesterdayIncome }}</b><span>昨日收益</span></div>
            <div><b>{{ dailyReport.avgDaily }}</b><span>本月日均</span></div>
            <div><b>{{ dailyReport.avg7d }}</b><span>近7日日均</span></div>
            <div><b>{{ dailyReport.sum7d }}</b><span>近7日累计</span></div>
            <div><b>{{ dailyReport.forecastMonth }}</b><span>本月预测</span></div>
            <div><b>{{ dailyReport.trend }}</b><span>趋势判断</span></div>
            <div><b>{{ dailyReport.volatility }}</b><span>波动率</span></div>
            <div><b>{{ dailyReport.progress }}</b><span>月度进度</span></div>
          </div>
          <div class="promo-report-note">
            <div><b>数据可信度：</b>{{ dailyReport.confidence }}</div>
            <div><b>缓存覆盖：</b>{{ dailyReport.coverage }}（实测 {{ dailyReport.measuredDays }} 天，推算 {{ dailyReport.estimatedDays }} 天）</div>
          </div>
          <div class="promo-report-note">{{ dailyReport.note }}</div>
          <div class="promo-report-list">
            <div class="promo-report-row" v-for="row in dailyReport.rows" :key="row.date">
              <span>{{ row.date }}</span>
              <b>{{ row.income }}</b>
              <small>{{ row.tag }}</small>
            </div>
          </div>
          <div class="about-actions">
            <a-button class="line-btn" type="outline" @click="refreshDailyReport">重新分析</a-button>
            <a-button class="primary-btn" type="primary" @click="closeDailyReport">完成</a-button>
          </div>
        </div>
      </div>
    </MobileShell>
  `,
  setup() {
    const profile = computed(() => store.userProfile || {});
    const showDailyReport = ref(false);
    const dailyReport = ref({
      todayIncome: "-",
      yesterdayIncome: "-",
      avgDaily: "-",
      avg7d: "-",
      sum7d: "-",
      forecastMonth: "-",
      trend: "-",
      volatility: "-",
      progress: "-",
      confidence: "-",
      coverage: "-",
      measuredDays: 0,
      estimatedDays: 0,
      generatedAt: "-",
      note: "",
      rows: []
    });
    const promo = computed(() => {
      const p = profile.value;
      const vip = p.VIP && typeof p.VIP === "object" ? p.VIP : {};
      const incomeMetrics = extractPromoIncomeMetrics(p);
      const monthPoints = incomeMetrics.monthPoints;
      const totalPoints = incomeMetrics.totalPoints;
      const shareCode = String(pickFirstFieldDeep(p, ["ShareCode", "share_code", "invite_code", "code"]) || "-");
      const primaryCurrent = toNumberOrNull(pickFirstFieldDeep(p, ["StockQuarter", "stock_quarter", "quarter_stock"])) ?? 0;
      const secondaryCurrent = toNumberOrNull(pickFirstFieldDeep(p, ["SecondStockQuarter", "second_stock_quarter"])) ?? 0;
      const primaryTarget = toNumberOrNull(vip.StockRequire) ?? 0;
      const secondaryTarget = toNumberOrNull(vip.SecondStockRequire) ?? 0;
      const prevMonthIncome = incomeMetrics.prevMonthIncome;
      const currMonthIncomeRaw = incomeMetrics.monthIncome ?? 0;
      const todayIncomeRaw = incomeMetrics.todayIncome ?? 0;
      const totalIncomeRaw = incomeMetrics.totalIncome ?? 0;
      const totalStockRaw = toNumberOrNull(pickFirstFieldDeep(p, ["StockAll", "stock_all", "promotion_total_stock"])) ?? 0;
      const subUserAllRaw = toNumberOrNull(pickFirstFieldDeep(p, ["SubUserAll", "sub_user_all", "customer_total"])) ?? 0;
      const monthNewUserRaw = toNumberOrNull(pickFirstFieldDeep(p, ["SubUserMonthly", "sub_user_monthly", "customer_monthly"])) ?? 0;
      const totalPointsAllRaw = totalPoints ?? 0;
      const incomePerUserRaw = subUserAllRaw > 0 ? totalIncomeRaw / subUserAllRaw : null;
      const registerRaw = pickFirstFieldDeep(p, ["RegisterTime", "register_time", "RegisterDate", "register_date", "CreatedAt", "created_at", "CreateTime", "create_time", "RegTime", "reg_time"]);
      let activeDays = null;
      if (registerRaw !== null && registerRaw !== undefined && registerRaw !== "") {
        const n = Number(registerRaw);
        const d = Number.isFinite(n)
          ? new Date(n > 1000000000000 ? n : (n > 1000000000 ? n * 1000 : n))
          : new Date(String(registerRaw));
        if (!Number.isNaN(d.getTime())) {
          activeDays = Math.max(1, Math.floor((Date.now() - d.getTime()) / 86400000) + 1);
        }
      }
      const avgAllDailyRaw = activeDays ? (totalIncomeRaw / activeDays) : null;
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
        monthIncome: formatMoney(currMonthIncomeRaw).replace("¥ ", ""),
        monthIncomeRaw: currMonthIncomeRaw,
        totalIncome: formatMoney(totalIncomeRaw).replace("¥ ", ""),
        totalIncomeRaw,
        prevMonthIncome: formatMoney(prevMonthIncome).replace("¥ ", ""),
        prevMonthIncomeRaw: prevMonthIncome ?? 0,
        todayIncomeRaw,
        momRate: momRate === null ? "-" : `${momRate >= 0 ? "+" : ""}${formatFixed2(momRate)}%`,
        todayStock: formatCount(pickFirstFieldDeep(p, ["StockDaily", "today_stock", "today_purchase", "promotion_today_stock"])),
        monthStock: formatFixed2(pickFirstFieldDeep(p, ["StockMonthly", "month_stock", "month_purchase", "promotion_month_stock"])),
        subUserAll: formatCount(subUserAllRaw),
        monthNewUser: formatCount(monthNewUserRaw),
        totalStockAll: formatFixed2(totalStockRaw),
        totalPointsAll: formatCount(totalPointsAllRaw),
        incomePerUser: incomePerUserRaw === null ? "-" : formatFixed2(incomePerUserRaw),
        avgAllDaily: avgAllDailyRaw === null ? "-" : formatFixed2(avgAllDailyRaw),
        activeDays: activeDays === null ? "-" : formatCount(activeDays),
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
    function buildDailyIncomeReport() {
      const now = new Date();
      const monthIncome = Math.max(0, Number(promo.value.monthIncomeRaw || 0));
      const prevMonthIncome = Math.max(0, Number(promo.value.prevMonthIncomeRaw || 0));
      const todayIncome = Math.max(0, Number(promo.value.todayIncomeRaw || 0));
      const dayIndex = Math.max(1, now.getDate());
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const avgDaily = monthIncome / dayIndex;
      const forecastMonth = avgDaily * daysInMonth;
      const comparedAvg = prevMonthIncome > 0 ? prevMonthIncome / daysInMonth : 0;
      const trendValue = comparedAvg > 0 ? ((avgDaily - comparedAvg) / comparedAvg) * 100 : null;
      const trend = trendValue === null ? "样本不足" : `${trendValue >= 0 ? "增长" : "回落"} ${formatFixed2(Math.abs(trendValue))}%`;

      const beforeTodayDays = Math.max(1, dayIndex - 1);
      const estBeforeToday = Math.max(0, (monthIncome - todayIncome) / beforeTodayDays);
      const series = readPromoDailySeries();
      const totalByDay = new Map(series.map((x) => [x.day, x.totalIncome]));
      const rows = [];
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const isToday = i === 0;
        const dayKey = toDayKey(d);
        const prevDay = toDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
        const dateText = `${d.getMonth() + 1}/${d.getDate()}`;
        const currTotal = totalByDay.get(dayKey);
        const prevTotal = totalByDay.get(prevDay);
        let incomeValue = 0;
        let tag = "推算";
        if (isToday) {
          incomeValue = todayIncome;
          tag = "实时";
        } else if (Number.isFinite(currTotal) && Number.isFinite(prevTotal)) {
          incomeValue = Math.max(0, Number(currTotal) - Number(prevTotal));
          tag = "缓存实测";
        } else if (Number.isFinite(currTotal) && !Number.isFinite(prevTotal)) {
          incomeValue = Math.max(0, Number(currTotal));
          tag = "缓存首日";
        } else {
          incomeValue = estBeforeToday;
          tag = "推算";
        }
        rows.push({
          date: dateText,
          value: Number(incomeValue),
          income: `¥ ${formatFixed2(incomeValue)}`,
          tag
        });
      }

      const historyRows = rows.filter((x) => x.tag !== "实时");
      const measuredRows = historyRows.filter((x) => x.tag === "缓存实测" || x.tag === "缓存首日");
      const estimatedRows = historyRows.filter((x) => x.tag === "推算");
      const yRow = rows[rows.length - 2] || null;
      const sum7dValue = rows.reduce((sum, x) => sum + Number(x.value || 0), 0);
      const avg7dValue = sum7dValue / Math.max(1, rows.length);
      const historyVals = historyRows.map((x) => Number(x.value || 0));
      const meanHist = historyVals.reduce((sum, x) => sum + x, 0) / Math.max(1, historyVals.length);
      const variance = historyVals.reduce((sum, x) => sum + ((x - meanHist) ** 2), 0) / Math.max(1, historyVals.length);
      const std = Math.sqrt(Math.max(0, variance));
      const volatility = meanHist > 0 ? (std / meanHist) * 100 : 0;
      const progress = daysInMonth > 0 ? (dayIndex / daysInMonth) * 100 : 0;
      const coverageStart = series.length ? series[0].day : "";
      const coverageEnd = series.length ? series[series.length - 1].day : "";
      const coverage = coverageStart && coverageEnd ? `${coverageStart} ~ ${coverageEnd}` : "暂无";
      const confidenceRate = historyRows.length > 0 ? (measuredRows.length / historyRows.length) : 0;
      let confidence = "低";
      if (confidenceRate >= 0.8) confidence = "高";
      else if (confidenceRate >= 0.4) confidence = "中";

      const hasRealRows = rows.some((x) => x.tag === "缓存实测" || x.tag === "缓存首日");
      dailyReport.value = {
        todayIncome: `¥ ${formatFixed2(todayIncome)}`,
        yesterdayIncome: yRow ? `¥ ${formatFixed2(yRow.value || 0)}` : "-",
        avgDaily: `¥ ${formatFixed2(avgDaily)}`,
        avg7d: `¥ ${formatFixed2(avg7dValue)}`,
        sum7d: `¥ ${formatFixed2(sum7dValue)}`,
        forecastMonth: `¥ ${formatFixed2(forecastMonth)}`,
        trend,
        volatility: `${formatFixed2(volatility)}%`,
        progress: `${formatFixed2(progress)}%`,
        confidence,
        coverage,
        measuredDays: measuredRows.length,
        estimatedDays: estimatedRows.length,
        generatedAt: now.toLocaleString(),
        note: hasRealRows
          ? "说明：已启用本地请求缓存，历史日收益优先使用缓存实测差值；缺失日期回退推算。"
          : "说明：当前暂无足够历史缓存，近7天收益暂按本月累计收益推算，后续会逐步变为实测。",
        rows
      };
    }
    function openDailyReport() {
      buildDailyIncomeReport();
      showDailyReport.value = true;
    }
    function refreshDailyReport() {
      buildDailyIncomeReport();
      toast("分析已更新");
    }
    function closeDailyReport() {
      showDailyReport.value = false;
    }
    onMounted(() => refreshSummary(false));
    return { avatar, promo, copyLink, openLink, shareLink, showDailyReport, dailyReport, openDailyReport, refreshDailyReport, closeDailyReport };
  }
};

const LoginPage = {
  components: { MobileShell },
  template: `
    <MobileShell title="登录">
      <section class="panel login-hero">
        <a-typography-title :heading="5" class="typo-title">API Key 登录</a-typography-title>
        <a-typography-text class="panel-subtext" type="secondary">仅需输入 API Key 即可完成登录。</a-typography-text>
      </section>

      <section class="panel login-panel">
        <div class="form-grid">
          <label>API Key
            <a-input v-model="form.apiKey" placeholder="请输入 API Key" />
          </label>
        </div>
        <div class="btn-row">
          <a-button class="primary-btn" type="primary" :loading="loading" @click="submitLogin">保存并同步</a-button>
        </div>
      </section>
    </MobileShell>
  `,
  setup() {
    const router = useRouter();
    const loading = ref(false);
    const form = reactive({
      apiKey: store.auth.apiKey || ""
    });

    async function submitLogin() {
      const apiKey = String(form.apiKey || "").trim();
      if (!apiKey) {
        toast("请填写 API Key");
        return;
      }
      const baseUrl = normalizeBaseUrl(store.auth.baseUrl || "https://api.v2.rainyun.com");
      loading.value = true;
      try {
        await validateAuth(baseUrl, apiKey, "");
        saveAuth({
          baseUrl,
          apiKey,
          devToken: "",
          authMode: "apiKey",
          account: ""
        });
        await refreshSummary(true);
        toast("登录成功");
        router.replace("/home");
      } catch (e) {
        toast(`登录失败：${String(e || "")}`);
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => {
      if (isAuthenticated()) router.replace("/home");
    });

    return { form, loading, submitLogin };
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
        <div><b>{{ summary.rgs.length }}</b><span>游戏云</span></div>
        <div><b>{{ summary.rca.length }}</b><span>云应用</span></div>
        <div><b>{{ summary.domain.length }}</b><span>域名</span></div>
        <div><b>{{ summary.ssl_order.length }}</b><span>证书</span></div>
      </section>

      <section class="panel">
        <div class="panel-title"><a-typography-title :heading="6" class="typo-title">账号中心</a-typography-title></div>
        <div class="kv"><span>认证方式</span><b>{{ authInfo.modeText }}</b></div>
        <div class="kv"><span>认证标识</span><b>{{ authInfo.masked }}</b></div>
        <div class="btn-row">
          <a-button class="primary-btn" type="primary" @click="goLogin">编辑 API Key</a-button>
          <a-button class="line-btn" type="outline" @click="logout">退出登录</a-button>
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
          <div class="about-hero">
            <img :src="brandLogo" alt="logo" />
            <div class="about-hero-main">
              <b>RainYun APP</b>
              <p>新一代云服务提供商</p>
              <div class="about-hero-meta">
                <span>v{{ appVersion }}</span>
                <span>API Key 模式</span>
              </div>
            </div>
          </div>
          <section class="about-section">
            <h4>技术栈</h4>
            <div class="about-tech-tags">
              <a-tag size="small" color="arcoblue">Vue 3</a-tag>
              <a-tag size="small" color="cyan">Vue Router 4</a-tag>
              <a-tag size="small" color="blue">Arco Design Vue</a-tag>
              <a-tag size="small" color="green">Vite 5</a-tag>
              <a-tag size="small" color="purple">Capacitor 7</a-tag>
            </div>
          </section>
          <section class="about-section">
            <h4>说明</h4>
            <p>本 App 基于 RainYun API 开发，与雨云官方客户端并非同一产品。</p>
            <p>API Key 仅用于你与 RainYun API 的请求交互，不会上传至开发者服务器。</p>
          </section>
          <div class="about-modal-actions">
            <a-button class="primary-btn" type="primary" @click="closeAbout">我知道了</a-button>
          </div>
        </div>
      </div>

    </MobileShell>
  `,
  setup() {
    const summary = computed(() => store.summary);
    const router = useRouter();
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

    const authInfo = computed(() => {
      const raw = String(store.auth.apiKey || "");
      const masked = raw ? `${raw.slice(0, 3)}***${raw.slice(-3)}` : "-";
      return { modeText: "API Key", masked };
    });
    const goLogin = () => router.push("/login");
    const logout = () => {
      saveAuth({ baseUrl: store.auth.baseUrl, apiKey: "", devToken: "", authMode: "apiKey", account: "" });
      store.userProfile = null;
      store.rawSummary = null;
      store.summary = { domain: [], rca: [], rcs: [], rgpu: [], rgs: [], ssl_order: [] };
      toast("已退出登录");
      router.replace("/login");
    };

    function openAbout() {
      showAboutModal.value = true;
    }

    function closeAbout() {
      showAboutModal.value = false;
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
        const notes = formatUpdateNotesForDialog(info.notes);
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
      authInfo,
      userCard,
      avatarUrl,
      showAboutModal,
      appVersion: APP_VERSION,
      brandLogo: BRAND_LOGO,
      goLogin,
      logout,
      openAbout,
      closeAbout,
      checkUpdate
    };
  }
};

const routes = [
  { path: "/", redirect: "/home" },
  { path: "/login", component: LoginPage },
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
      <transition :css="false" @enter="onBootEnter" @leave="onBootLeave">
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
        <transition :css="false" @enter="onPageEnter" @leave="onPageLeave">
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
    let bootStartAt = Date.now();
    let bootClosing = false;
    const bootExpectedMs = ref(BOOT_EXPECTED_FALLBACK_MS);

    const prefersReducedMotion = () => {
      if (reducedMotion.value) return true;
      if (typeof window === "undefined" || !window.matchMedia) return false;
      return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    };

    const parseCssPx = (v) => {
      const n = Number.parseFloat(String(v || "0"));
      return Number.isFinite(n) ? n : 0;
    };

    const readNavShift = () => {
      if (typeof document === "undefined") return { x: 0, y: 0 };
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        x: parseCssPx(rootStyle.getPropertyValue("--nav-shift-x")),
        y: parseCssPx(rootStyle.getPropertyValue("--nav-shift-y"))
      };
    };

    const onBootEnter = (el, done) => {
      if (prefersReducedMotion()) {
        el.style.opacity = "1";
        el.style.transform = "none";
        done();
        return;
      }
      animate(
        el,
        [{ opacity: 0, transform: "translate3d(0, 10px, 0) scale(0.992)" }, { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }],
        { duration: 0.32, easing: "cubic-bezier(.22,1,.36,1)" }
      ).finished.then(done).catch(done);
    };

    const onBootLeave = (el, done) => {
      if (prefersReducedMotion()) {
        done();
        return;
      }
      animate(
        el,
        [{ opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }, { opacity: 0, transform: "translate3d(0, -8px, 0) scale(0.996)" }],
        { duration: 0.24, easing: "ease-out" }
      ).finished.then(done).catch(done);
    };

    const onPageEnter = (el, done) => {
      if (prefersReducedMotion()) {
        el.style.opacity = "1";
        el.style.transform = "none";
        done();
        return;
      }
      const shift = readNavShift();
      animate(
        el,
        [
          { opacity: 0.01, transform: `translate3d(${shift.x}px, ${shift.y}px, 0) scale(0.986)` },
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
        ],
        { duration: 0.3, easing: "cubic-bezier(.22,1,.36,1)" }
      ).finished.then(done).catch(done);
    };

    const onPageLeave = (el, done) => {
      if (prefersReducedMotion()) {
        done();
        return;
      }
      const shift = readNavShift();
      animate(
        el,
        [
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
          { opacity: 0.01, transform: `translate3d(${(-0.45 * shift.x).toFixed(2)}px, ${(-0.45 * shift.y).toFixed(2)}px, 0) scale(0.994)` }
        ],
        { duration: 0.14, easing: "ease-out" }
      ).finished.then(done).catch(done);
    };

    const tryCloseBoot = () => {
      if (!minBootElapsed.value || loading.value || bootClosing) return;
      bootClosing = true;
      bootProgress.value = Math.max(bootProgress.value, 97);
      setTimeout(() => {
        bootProgress.value = 100;
      }, 40);
      setTimeout(() => {
        bootVisible.value = false;
        writeBootMetrics(Date.now() - bootStartAt);
      }, 220);
    };

    const tickBootProgress = () => {
      if (!bootVisible.value) return;
      if (bootClosing) return;
      const elapsed = Date.now() - bootStartAt;
      const expected = clamp(Number(bootExpectedMs.value) || BOOT_EXPECTED_FALLBACK_MS, BOOT_EXPECTED_MIN_MS, BOOT_EXPECTED_MAX_MS);
      const ratio = clamp(elapsed / expected, 0, 1);
      const eased = 1 - ((1 - ratio) ** 2.2);
      const cap = minBootElapsed.value && !loading.value ? 100 : 96;
      const base = 4;
      const target = clamp(base + (cap - base) * eased, base, cap);
      const next = Math.min(cap, Math.max(bootProgress.value + 0.8, target));
      if (next > bootProgress.value) {
        bootProgress.value = Number(next.toFixed(2));
      }
    };

    onMounted(() => {
      bootStartAt = Date.now();
      bootExpectedMs.value = readBootMetrics().emaMs || BOOT_EXPECTED_FALLBACK_MS;
      if (typeof window !== "undefined" && window.matchMedia) {
        const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
        reducedMotion.value = Boolean(mql.matches);
        if (reducedMotion.value) {
          bootMode.value = "progress";
        }
      }
      progressTimer = setInterval(tickBootProgress, 80);
      setTimeout(() => {
        minBootElapsed.value = true;
        tryCloseBoot();
      }, BOOT_MIN_VISIBLE_MS);
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

    return { loading, bootVisible, bootProgress, bootMode, logo: BRAND_LOGO, onBootEnter, onBootLeave, onPageEnter, onPageLeave };
  }
};

router.beforeEach((to) => {
  if (!isAuthenticated() && to.path === "/me") {
    toast("请先登录");
    return "/login";
  }
  if (isAuthenticated() && to.path === "/login") {
    return "/home";
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
      return p === "/" || p === "/home" || p === "/promo" || p === "/me" || p === "/login";
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
