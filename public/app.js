// ---- Regions YouTube supports a trending chart for (common set) ----
const REGIONS = [
  ["US", "United States"], ["IN", "India"], ["GB", "United Kingdom"],
  ["CA", "Canada"], ["AU", "Australia"], ["DE", "Germany"],
  ["FR", "France"], ["JP", "Japan"], ["KR", "South Korea"],
  ["BR", "Brazil"], ["MX", "Mexico"], ["ES", "Spain"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["RU", "Russia"],
  ["ID", "Indonesia"], ["SA", "Saudi Arabia"], ["AE", "United Arab Emirates"],
  ["ZA", "South Africa"], ["NG", "Nigeria"], ["SG", "Singapore"],
];

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const heroTitle = document.getElementById("hero-title");
const themeToggle = document.getElementById("theme-toggle");
const regionBtn = document.getElementById("region-btn");
const regionMenu = document.getElementById("region-menu");
const regionCurrent = document.getElementById("region-current");
const catBtn = document.getElementById("cat-btn");
const catMenu = document.getElementById("cat-menu");
const catCurrent = document.getElementById("cat-current");
const catIcon = document.getElementById("cat-icon");
const sortBtn = document.getElementById("sort-btn");
const sortMenu = document.getElementById("sort-menu");
const sortCurrent = document.getElementById("sort-current");
const localToggle = document.getElementById("local-toggle");
const underToggle = document.getElementById("under-toggle");

const SORT_LABELS = { trending: "Trending", views: "Most viewed", newest: "Newest" };

const state = {
  region: localStorage.getItem("region") || "US",
  category: "0",
  sort: localStorage.getItem("sort") || "trending",
  localOnly: localStorage.getItem("localOnly") === "1",
  underdogs: localStorage.getItem("underdogs") === "1",
  items: [],
};
if (!SORT_LABELS[state.sort]) state.sort = "trending";

// Outperformance: views relative to the channel's own subscriber base.
const reachRatio = (v) => {
  const subs = v.channelSubs;
  if (!subs || subs <= 0) return 0;
  // Skip YouTube's auto-generated "… - Topic" music channels — not real creators.
  if (/-\s*Topic$/.test(v.snippet?.channelTitle || "")) return 0;
  return (+v.statistics?.viewCount || 0) / subs;
};

// ---- Rising creators (real Underdogs) config ----
const SUB_OPTS = [
  [5000, "Under 5K subs"], [10000, "Under 10K subs"], [25000, "Under 25K subs"],
  [50000, "Under 50K subs"], [100000, "Under 100K subs"],
];

const risingBar = document.getElementById("rising-bar");
const catPicker = document.querySelector(".cat-picker");
const sortPicker = document.querySelector(".sort-picker");

state.maxSubs = +localStorage.getItem("maxSubs") || 10000;
if (!SUB_OPTS.some((o) => o[0] === state.maxSubs)) state.maxSubs = 10000;
state.risingItems = [];
state.risingKey = null;

// ---- Theme ----
document.documentElement.setAttribute("data-theme", localStorage.getItem("theme") || "dark");
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
});

// ---- Helpers ----
const fmt = (n) => {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
};
const isoDuration = (iso) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || [];
  const h = +m[1] || 0, mn = +m[2] || 0, s = +m[3] || 0;
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(mn)}:${pad(s)}` : `${mn}:${pad(s)}`;
};
const timeAgo = (iso) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  const u = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [label, secs] of u) {
    const v = Math.floor(d / secs);
    if (v >= 1) return `${v} ${label}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const regionName = (code) => (REGIONS.find((r) => r[0] === code) || [code, code])[1];

// Pick the best available thumbnail (crisp). YouTube ids resolve to fixed sizes.
const thumbOf = (s, big) => {
  const t = s.thumbnails || {};
  const order = big
    ? [t.maxres, t.standard, t.high, t.medium, t.default]
    : [t.maxres, t.standard, t.high, t.medium, t.default];
  for (const x of order) if (x?.url) return x.url;
  return "";
};

function avatarHTML(channel, thumb) {
  if (thumb) return `<span class="av"><img loading="lazy" src="${esc(thumb)}" alt="${esc(channel)}"
    onerror="this.parentElement.textContent='${esc(channel.charAt(0).toUpperCase())}'" /></span>`;
  return `<span class="av">${esc(channel.charAt(0).toUpperCase())}</span>`;
}

// ---- Generic dropdown wiring ----
function wireMenu(btn, menu) {
  const open = () => { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); };
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return { open, close };
}

// ---- Region dropdown ----
const regionCtl = wireMenu(regionBtn, regionMenu);
function buildRegionMenu() {
  regionMenu.innerHTML = "";
  REGIONS.forEach(([code, name]) => {
    const b = document.createElement("button");
    b.className = "region-opt" + (code === state.region ? " is-active" : "");
    b.setAttribute("role", "option");
    b.innerHTML = `<i class="ph ph-map-pin"></i><span>${esc(name)}</span><span class="code">${code}</span>`;
    b.addEventListener("click", () => {
      state.region = code;
      localStorage.setItem("region", code);
      regionCurrent.textContent = name;
      regionCtl.close();
      buildRegionMenu();
      state.risingKey = null;
      if (state.underdogs) { loadCategories(code); loadRising(); }
      else loadCategories(code).then(load);
    });
    regionMenu.appendChild(b);
  });
}

// ---- Sort dropdown ----
const sortCtl = wireMenu(sortBtn, sortMenu);
sortCurrent.textContent = SORT_LABELS[state.sort];
sortMenu.querySelectorAll(".menu-opt").forEach((opt) => {
  opt.classList.toggle("is-active", opt.dataset.sort === state.sort);
  opt.addEventListener("click", () => {
    state.sort = opt.dataset.sort;
    localStorage.setItem("sort", state.sort);
    sortCurrent.textContent = SORT_LABELS[state.sort];
    sortMenu.querySelectorAll(".menu-opt").forEach((o) => o.classList.toggle("is-active", o === opt));
    sortCtl.close();
    renderVideos();
  });
});

// ---- Category dropdown (with per-category icons) ----
const CAT_ICONS = [
  [/^all/, "ph-squares-four"],
  [/film|animation/, "ph-film-slate"],
  [/auto|vehicle/, "ph-car-profile"],
  [/music/, "ph-music-notes"],
  [/pet|animal/, "ph-paw-print"],
  [/sport/, "ph-soccer-ball"],
  [/travel|event/, "ph-airplane-tilt"],
  [/gaming|game/, "ph-game-controller"],
  [/people|blog/, "ph-users-three"],
  [/comedy/, "ph-smiley"],
  [/entertainment/, "ph-popcorn"],
  [/news|politic/, "ph-newspaper"],
  [/howto|style/, "ph-sparkle"],
  [/education/, "ph-graduation-cap"],
  [/science|tech/, "ph-flask"],
  [/nonprofit|activism/, "ph-hand-heart"],
  [/movie/, "ph-film-reel"],
  [/show/, "ph-television-simple"],
  [/trailer/, "ph-monitor-play"],
];
function iconForCategory(name) {
  const n = (name || "").toLowerCase();
  for (const [re, icon] of CAT_ICONS) if (re.test(n)) return icon;
  return "ph-tag";
}

const catCtl = wireMenu(catBtn, catMenu);
async function loadCategories(region) {
  state.category = "0";
  catCurrent.textContent = "All categories";
  catIcon.className = "ph ph-squares-four";
  const cats = [["0", "All categories"]];
  try {
    const res = await fetch(`/api/categories?region=${region}`);
    const data = await res.json();
    (data.items || []).filter((c) => c.snippet?.assignable).forEach((c) => cats.push([c.id, c.snippet.title]));
  } catch (_) { /* optional */ }
  catMenu.innerHTML = "";
  cats.forEach(([id, name]) => {
    const icon = iconForCategory(name);
    const b = document.createElement("button");
    b.className = "cat-opt" + (id === "0" ? " is-active" : "");
    b.setAttribute("role", "option");
    b.innerHTML = `<i class="ph ${icon}"></i><span>${esc(name)}</span>`;
    b.addEventListener("click", () => {
      state.category = id;
      catCurrent.textContent = name;
      catIcon.className = `ph ${icon}`;
      catMenu.querySelectorAll(".cat-opt").forEach((o) => o.classList.remove("is-active"));
      b.classList.add("is-active");
      catCtl.close();
      load();
    });
    catMenu.appendChild(b);
  });
}

// ---- Toggles: Local Gems (filter) + Underdogs (re-rank) ----
function syncToggle(btn, on) {
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}
syncToggle(localToggle, state.localOnly);
syncToggle(underToggle, state.underdogs);
localToggle.addEventListener("click", () => {
  state.localOnly = !state.localOnly;
  localStorage.setItem("localOnly", state.localOnly ? "1" : "0");
  syncToggle(localToggle, state.localOnly);
  renderVideos();
});
underToggle.addEventListener("click", () => {
  state.underdogs = !state.underdogs;
  localStorage.setItem("underdogs", state.underdogs ? "1" : "0");
  syncToggle(underToggle, state.underdogs);
  applyMode();
});

// Switch chrome between Trending mode and Rising (Underdogs) mode.
function applyMode() {
  const on = state.underdogs;
  risingBar.hidden = !on;
  catPicker.style.display = on ? "none" : "";
  sortPicker.style.display = on ? "none" : "";
  localToggle.style.display = on ? "none" : "";
  if (on) loadRising(); else load();
}

// ---- Generic dropdown picker (used by rising filter bar) ----
function buildPicker(container, caption, options, current, onChange) {
  container.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "picker-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  const menu = document.createElement("div");
  menu.className = "menu"; menu.hidden = true; menu.setAttribute("role", "listbox");
  const cur = options.find((o) => o[0] === current) || options[0];
  btn.innerHTML = `<span class="rb-cap">${caption}</span><span class="rb-val">${esc(cur[1])}</span><i class="ph ph-caret-down chev"></i>`;
  options.forEach(([value, label]) => {
    const o = document.createElement("button");
    o.className = "menu-opt" + (value === current ? " is-active" : "");
    o.innerHTML = `<span class="opt-name">${esc(label)}</span>`;
    o.addEventListener("click", () => {
      menu.querySelectorAll(".menu-opt").forEach((x) => x.classList.remove("is-active"));
      o.classList.add("is-active");
      btn.querySelector(".rb-val").textContent = label;
      menu.hidden = true; btn.setAttribute("aria-expanded", "false");
      onChange(value);
    });
    menu.appendChild(o);
  });
  container.appendChild(btn);
  container.appendChild(menu);
  wireMenu(btn, menu);
}

buildPicker(document.getElementById("rb-subs"), "", SUB_OPTS, state.maxSubs, (v) => {
  state.maxSubs = v; localStorage.setItem("maxSubs", v); renderRising();
});

// ---- Trending view filter/sort ----
function visibleItems() {
  let items = state.items.slice();
  if (state.localOnly) items = items.filter((v) => !v.isGlobal);
  if (state.sort === "views") items.sort((a, b) => (+b.statistics?.viewCount || 0) - (+a.statistics?.viewCount || 0));
  else if (state.sort === "newest") items.sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));
  return items;
}

// ---- Rising view: hard sub-ceiling filter, ranked by reach ----
function filterRising() {
  return state.risingItems
    .filter((v) => v.channelSubs <= state.maxSubs)
    .sort((a, b) => reachRatio(b) - reachRatio(a));
}

function showSkeletons() {
  grid.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const c = document.createElement("div");
    c.className = "card skeleton";
    c.style.animationDelay = `${i * 0.03}s`;
    c.innerHTML = `<div class="thumb-wrap"></div>
      <div class="card-body"><div class="av"></div>
      <div class="sk-rows"><div class="sk-line"></div><div class="sk-line short"></div></div></div>`;
    grid.appendChild(c);
  }
}

function setStatus(msg, isError) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false; statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function buildCard(v, idx, underdog) {
  const s = v.snippet || {}, st = v.statistics || {}, cd = v.contentDetails || {};
  const thumb = thumbOf(s);
  const channel = s.channelTitle || "Unknown";
  const ratio = reachRatio(v);
  const showReach = underdog && ratio >= 1.5;
  const subsMeta = underdog && v.channelSubs ? `<span class="dot">·</span>${fmt(v.channelSubs)} subs` : "";
  const a = document.createElement("a");
  a.className = "card";
  a.href = `https://www.youtube.com/watch?v=${v.id}`;
  a.target = "_blank"; a.rel = "noopener";
  a.style.animationDelay = `${Math.min(idx, 16) * 0.03}s`;
  a.innerHTML = `
    <div class="thumb-wrap">
      ${underdog ? "" : `<span class="rank">${idx + 1}</span>`}
      ${showReach ? `<span class="reach"><i class="ph-fill ph-rocket-launch"></i>${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× reach</span>` : ""}
      <div class="thumb-fallback" style="display:none"><i class="ph ph-image-broken"></i></div>
      <img loading="lazy" src="${esc(thumb)}" alt="${esc(s.title || "")}"
           onload="this.style.opacity=1"
           onerror="this.style.display='none';this.previousElementSibling.style.display='grid'"
           style="opacity:0;transition:opacity .35s" />
      ${cd.duration ? `<span class="duration">${isoDuration(cd.duration)}</span>` : ""}
      <div class="play"><i class="ph-fill ph-play"></i></div>
    </div>
    <div class="card-body">
      ${avatarHTML(channel, v.channelThumb)}
      <div class="card-text">
        <div class="card-title">${esc(s.title || "Untitled")}</div>
        <div class="card-channel">${esc(channel)}</div>
        <div class="card-meta">${fmt(st.viewCount)} views${subsMeta}<span class="dot">·</span>${timeAgo(s.publishedAt)}</div>
      </div>
    </div>`;
  return a;
}

function renderVideos() {
  if (state.underdogs) return renderRising();
  const items = visibleItems();
  grid.innerHTML = "";
  if (!items.length) {
    setStatus(
      state.localOnly
        ? "Nothing uniquely local right now — every trending video here is also trending worldwide. Try turning off Local gems."
        : "No trending videos for this region or category.",
      false
    );
    return;
  }
  setStatus(null);
  items.forEach((v, idx) => grid.appendChild(buildCard(v, idx, false)));
}

function renderRising() {
  const items = filterRising();
  grid.innerHTML = "";
  if (!items.length) {
    const bigger = SUB_OPTS.find((o) => o[0] > state.maxSubs);
    setStatus(
      state.risingItems.length
        ? `No breakout videos from channels under ${fmt(state.maxSubs)} subs right now${bigger ? ` — try “Under ${fmt(bigger[0])} subs.”` : "."}`
        : "No rising creators found in this region right now. Try another region.",
      false
    );
    return;
  }
  setStatus(null);
  items.forEach((v, idx) => grid.appendChild(buildCard(v, idx, true)));
}

async function loadRising() {
  const key = state.region;
  heroTitle.textContent = regionName(state.region);
  setStatus(null);
  showSkeletons();
  if (state.risingKey === key && state.risingItems.length) { renderRising(); return; }
  try {
    const res = await fetch(`/api/rising?region=${state.region}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      grid.innerHTML = "";
      setStatus(`Could not load rising creators: ${data.error || res.statusText}`, true);
      return;
    }
    state.risingItems = data.items || [];
    state.risingKey = key;
    renderRising();
  } catch (e) {
    grid.innerHTML = "";
    setStatus(`Network error: ${e}`, true);
  }
}

// ---- Load ----
async function load() {
  heroTitle.textContent = regionName(state.region);
  setStatus(null);
  showSkeletons();
  try {
    const res = await fetch(`/api/trending?region=${state.region}&category=${state.category}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      grid.innerHTML = "";
      setStatus(`Could not load videos: ${data.error || res.statusText}`, true);
      return;
    }
    state.items = data.items || [];
    renderVideos();
  } catch (e) {
    grid.innerHTML = "";
    setStatus(`Network error: ${e}`, true);
  }
}

// ---- Boot ----
regionCurrent.textContent = regionName(state.region);
buildRegionMenu();
(async () => { await loadCategories(state.region); applyMode(); })();
