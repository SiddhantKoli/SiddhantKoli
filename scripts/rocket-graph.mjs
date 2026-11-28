#!/usr/bin/env node
/**
 * rocket-graph.mjs — animated GitHub contribution graph (v3.1: enhanced destruction & physics)
 *
 * Enhancements:
 *  - Real data fallback: automatically fetches public GitHub contributions if no token provided.
 *  - Physical destruction:
 *      * Asteroids break into 3–4 tumbling rock fragments with active SMIL translation, rotation & drift.
 *      * Level-4 heavy asteroids take two hits with a shield hit-flash & shake on the first.
 *      * Noticeable, punchy mechanical recoil nudge (-5.2px) on the rocket on every cannon blast.
 *  - Pilot personality:
 *      * Pre-firing anticipatory nose scanning toward upcoming clusters.
 *      * Barrel-roll acrobatic maneuvers through empty stretches.
 *      * High-thrust afterburner burst on final screen exit.
 *      * Dynamic engine & headlight auras that illuminate nearby asteroids.
 *  - Richer scene:
 *      * Second parallax landmark: derelict orbital station with blinking comms beacon.
 *      * Light-mode responsive variant via @media (prefers-color-scheme: light).
 *      * Streak momentum boost through consecutive commit runs.
 *  - Optimized SVG payload for smooth 60fps SMIL playback across Chromium, Safari, and Firefox.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ───────────────────────── config ─────────────────────────
const CFG = {
  cell: 16, gap: 4,
  padX: 26, padTop: 46, padBottom: 46,
  U: 2.5,
  bg: "#0b0f1a", bgTop: "#060913", bgBot: "#0f1729",
  bgLightTop: "#f8fafc", bgLightBot: "#e9edf5",
  dot: "#5b6b8c", dotLight: "#afb8c1",
  rock: { 1: "#4f8f6a", 2: "#2ea043", 3: "#3fb950", 4: "#56d364" },
  rockLight: { 1: "#9be9a8", 2: "#40c463", 3: "#30a14e", 4: "#216e39" },
  speed: 140,
  minFlight: 13, maxFlight: 36,
  pause: 1.6,
  regrow: 6,
  trail: [
    { tail: 155, w: 8,   color: "#3a7bff", opacity: 0.15, blur: true },
    { tail: 82,  w: 3.2, color: "#4cc9ff", opacity: 0.32 },
    { tail: 38,  w: 1.4, color: "#d8f8ff", opacity: 0.6 },
  ],
};

// ───────────────────────── args ─────────────────────────
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const OUT = arg("out", "dist/rocket-contributions.svg");

// ───────────────────────── data ─────────────────────────
const SAMPLE = {
  cols: 53,
  cells: [
    [0,19,1],[0,24,1],[0,25,2],[0,51,1],[0,52,1],
    [1,10,1],[1,24,1],[1,51,1],[1,52,2],
    [2,10,1],[2,14,1],[2,20,1],[2,24,1],[2,44,1],[2,50,1],[2,51,2],[2,52,1],
    [3,13,1],[3,14,1],[3,20,1],[3,37,1],[3,44,1],[3,47,1],[3,49,2],[3,50,2],[3,51,2],[3,52,2],
    [4,14,2],[4,18,1],[4,24,1],[4,27,2],[4,37,1],[4,49,2],[4,50,2],[4,51,2],[4,52,2],
    [5,12,1],[5,27,1],[5,49,2],[5,50,2],[5,51,2],[5,52,4],
    [6,49,2],[6,50,1],[6,51,1],
  ].map(([row, col, level]) => ({ row, col, level })),
};

async function fetchContributions(user, token) {
  if (token) {
    try {
      const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "rocket-graph" },
        body: JSON.stringify({ query, variables: { login: user } }),
      });
      if (res.ok) {
        const json = await res.json();
        if (!json.errors && json.data?.user?.contributionsCollection?.contributionCalendar) {
          const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
          const LV = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
          const cells = [];
          weeks.forEach((w, col) => w.contributionDays.forEach((d) => {
            const level = LV[d.contributionLevel] ?? 0;
            if (level > 0) cells.push({ col, row: d.weekday, level });
          }));
          return { cols: weeks.length, cells };
        }
      }
    } catch (e) {
      console.warn("GraphQL fetch failed, falling back to public contributions API:", e.message);
    }
  }

  // Public fallback without token
  console.log(`Fetching public contribution activity for @${user}...`);
  const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${user}`);
  if (!res.ok) throw new Error(`Could not fetch public activity for ${user} (${res.status})`);
  const d = await res.json();
  const sorted = d.contributions.sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-371);
  const startDay = new Date(recent[0].date).getDay();
  const cells = [];
  recent.forEach((item, idx) => {
    const totalDay = idx + startDay;
    const col = Math.floor(totalDay / 7);
    const row = totalDay % 7;
    const count = item.count;
    if (count > 0) {
      let level = item.level ?? 1;
      if (!item.level) {
        if (count >= 10) level = 4;
        else if (count >= 6) level = 3;
        else if (count >= 3) level = 2;
        else level = 1;
      }
      cells.push({ col, row, level });
    }
  });
  return { cols: 53, cells };
}

// ───────────────────────── helpers ─────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const f1 = (n) => String(Math.round(n * 10) / 10);
const f2 = (n) => String(Math.round(n * 100) / 100);
const f3 = (n) => String(Math.round(n * 1e3) / 1e3);
const f4 = (n) => String(Math.round(n * 1e4) / 1e4);
const smooth = (x) => x * x * (3 - 2 * x);
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = hex2rgb(a), B = hex2rgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function pixelsToPaths(rows, ox, oy, extra = 0.14) {
  const U = CFG.U, byColor = new Map();
  rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const col = row[c];
      if (!col) { c++; continue; }
      let e = c;
      while (e + 1 < row.length && row[e + 1] === col) e++;
      const w = (e - c + 1) * U + extra, h = U + extra;
      if (!byColor.has(col)) byColor.set(col, []);
      byColor.get(col).push(`M${f2((c - ox) * U)} ${f2((r - oy) * U)}h${f2(w)}v${f2(h)}h${f2(-w)}z`);
      c = e + 1;
    }
  });
  return [...byColor].map(([col, d]) => `<path fill="${col}" d="${d.join("")}"/>`).join("");
}

// ───────────────────────── asteroid art ─────────────────────────
const ROCKS = {
  1: [[".hbb.", "hbbbs", "bbcbs", "bbbss", ".sss."],
      [".bbh.", "bbbbs", "hbbcs", "bbbbs", ".bss."]],
  2: [[".hhbb.", "hbbbbs", "bbcbbs", "bbbbcs", "sbbbss", ".ssss."],
      ["..hbb.", ".hbbbs", "hbbbcs", "bcbbbs", "bbbbss", ".sssb."]],
  3: [["..hhbb.", ".hbbbbs", "hbbcbbs", "bbbbbbs", "bcbbbcs", ".bbbbss", "..sssb."],
      [".hhbbb.", "hbbbbbs", "bbcbbbs", "bbbbbcs", "sbbcbbs", ".sbbbss", "..ssss."]],
  4: [["..hhhbb.", ".hbbbbbs", "hbbcbbbs", "bbbbbbcs", "bbcbbbbs", "sbbbbbss", ".ssbbsss", "..ssss.."],
      [".hhhbbb.", "hbbbbbbs", "hbbbcbbs", "bbcbbbbs", "bbbbbbcs", "bbbcbbss", ".sbbbsss", "..ssss.."]],
};

const PHASES = [
  { bob: 3.4, spin: 46, dir: 1,  bx: 1.0, by: 1.7, off: 0 },
  { bob: 4.1, spin: 38, dir: -1, bx: 0.8, by: 2.0, off: -1.3 },
  { bob: 5.0, spin: 62, dir: 1,  bx: 1.2, by: 1.4, off: -2.4 },
  { bob: 3.8, spin: 52, dir: -1, bx: 0.9, by: 1.9, off: -0.6 },
];
const EASE = 'keyTimes="0;.25;.5;.75;1" calcMode="spline" keySplines="' + Array(4).fill(".45 0 .55 1").join(";") + '"';

function rockSymbol(level, v, p) {
  const base = CFG.rock[level];
  const pal = { h: mix(base, "#ffffff", 0.42), b: base, s: mix(base, CFG.bg, 0.38), c: mix(base, CFG.bg, 0.64) };
  const sh = ROCKS[level][v];
  const rows = sh.map((str) => [...str].map((ch) => pal[ch] ?? null));
  const body = pixelsToPaths(rows, sh[0].length / 2, sh.length / 2);
  const P = PHASES[p];
  const bob = `<animateTransform attributeName="transform" type="translate" values="0 0;${P.bx} ${-P.by};0 0;${-P.bx} ${P.by};0 0" ${EASE} dur="${P.bob}s" begin="${P.off}s" repeatCount="indefinite"/>`;
  const spin = `<animateTransform attributeName="transform" type="rotate" from="0" to="${360 * P.dir}" dur="${P.spin}s" begin="${P.off * 7}s" repeatCount="indefinite"/>`;
  return `<g id="rk${level}${v}${p}"><g>${bob}<g>${spin}${body}</g></g></g>`;
}

// ───────────────────────── tumbling debris shard symbols ─────────────────────────
function fragmentSymbols() {
  let out = "";
  for (let lv = 1; lv <= 4; lv++) {
    const base = CFG.rock[lv];
    const hi = mix(base, "#ffffff", 0.48);
    const dark = mix(base, "#000000", 0.45);
    out += `<g id="fg${lv}_0"><polygon points="-2.5,-2 2.5,-1 1,2 -2,1.5" fill="${base}"/><polygon points="-2.5,-2 0.5,-1.5 -1,0.5 -2,1" fill="${hi}" opacity=".75"/></g>`;
    out += `<g id="fg${lv}_1"><polygon points="-3,-1 2.5,-2.5 3,1 -1.5,2.5" fill="${base}"/><polygon points="-2,-0.5 1,-1.5 2,0" fill="${hi}" opacity=".8"/><polygon points="0,0.5 2.5,0.8 1,2 -1,2" fill="${dark}" opacity=".6"/></g>`;
    out += `<g id="fg${lv}_2"><rect x="-2" y="-2" width="4" height="3.5" rx="0.6" fill="${base}"/><rect x="-1.8" y="-1.8" width="2" height="1.6" fill="${hi}" opacity=".75"/><rect x="0.2" y="0.2" width="1.6" height="1.1" fill="${dark}" opacity=".7"/></g>`;
    out += `<g id="fg${lv}_3"><polygon points="-1.8,-2 2,-0.5 0.5,2 -2,0.8" fill="${base}"/><polygon points="-1.5,-1.5 0.5,-0.5 -0.5,1" fill="${hi}" opacity=".8"/></g>`;
  }
  return out;
}

function sparkSymbol(level, k) {
  const rand = rng(900 + k * 31 + level * 7);
  const base = CFG.rock[level];
  const cols = ["#ffffff", mix(base, "#ffffff", 0.7), mix(base, "#9fe8ff", 0.5), "#ffe9a8"];
  let out = "";
  for (let i = 0; i < 8; i++) {
    const a = ((k * 17 + i * 45 + rand() * 20) * Math.PI) / 180, d = 4 + rand() * 6, s = rand() < 0.4 ? 2.4 : 1.6;
    out += `<rect x="${f2(Math.cos(a) * d - s / 2)}" y="${f2(Math.sin(a) * d - s / 2)}" width="${s}" height="${s}" fill="${pick(rand, cols)}"/>`;
  }
  return `<g id="sp${level}${k}">${out}</g>`;
}

// ───────────────────────── rocket art ─────────────────────────
const ROCKET = [
  "..ff",
  "..FFFf......GGGGGg",
  "..FFFHHHHHHHHHHHRR",
  ".NNnWWWWWWWWWWWWWWRR",
  ".NNnWWWWWbBBBWWWWWRRR",
  ".NNnWWWWWBPPBWWWWWWRRR",
  ".NNnSSSSSBBBBSSSSSrrr",
  ".NNnSSSSSSSSSSSSSSrr",
  "..ffDDDDDDDDDDDDrr",
  "..ffff......GGGGGg",
  "..ff",
];
const RW = Math.max(...ROCKET.map((r) => r.length));
for (let i = 0; i < ROCKET.length; i++) ROCKET[i] = ROCKET[i].padEnd(RW, ".");
const setCol = (col, chars) => chars.forEach((ch, k) => { const r = ROCKET[2 + k]; ROCKET[2 + k] = r.slice(0, col) + ch + r.slice(col + 1); });
setCol(7, ["R", "R", "R", "r", "r", "r"]);
setCol(14, ["Y", "Y", "Y", "y", "y", "y"]);
const RK = { F: "#ff5a6e", f: "#b8324c", H: "#ffffff", W: "#e6ecf7", S: "#aab6d0", D: "#7482a3",
             B: "#2fb4f0", b: "#c8f2ff", P: "#1c2740", N: "#4b566f", n: "#2d364d", R: "#ff4d63", r: "#b8324c",
             G: "#8a96b3", g: "#eef3ff", Y: "#ffd23f", y: "#c9962a" };
const TILTS = [-40, -27, -14, 0, 14, 27, 40];

function rotateGrid(rows, deg) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const diag = Math.hypot(w, h) + 2;
  const ow = w + 2 * Math.ceil((diag - w) / 2), oh = h + 2 * Math.ceil((diag - h) / 2);
  const th = (deg * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  const grid = [];
  for (let j = 0; j < oh; j++) {
    const row = [];
    for (let i = 0; i < ow; i++) {
      const votes = {}; let n = 0;
      for (const [ax, ay] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const dx = i + ax - ow / 2, dy = j + ay - oh / 2;
        const ch = rows[Math.floor(-dx * si + dy * co + h / 2)]?.[Math.floor(dx * co + dy * si + w / 2)];
        if (ch && ch !== ".") { votes[ch] = (votes[ch] || 0) + 1; n++; }
      }
      row.push(n >= 2 ? Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0] : ".");
    }
    grid.push(row);
  }
  return { grid, ow, oh };
}

function flameSymbol() {
  const layer = (L, h, col, op) =>
    `<rect x="${-25.5 - L[0]}" y="${-h / 2}" width="${L[0]}" height="${h}" fill="${col}" opacity="${op}">` +
    `<animate attributeName="x" values="${L.map((l) => -25.5 - l).join(";")}" dur=".3s" repeatCount="indefinite"/>` +
    `<animate attributeName="width" values="${L.join(";")}" dur=".3s" repeatCount="indefinite"/></rect>`;
  return `<g id="flame"><circle cx="-30" cy="0" r="13" fill="url(#eng)"><animate attributeName="r" values="12;17;13;18;12" dur=".3s" repeatCount="indefinite"/></circle>` +
    layer([18, 24, 20, 28, 18], 7.5, "#ff7a1a", 0.95) +
    layer([12, 17, 13, 19, 12], 4.5, "#ffd166", 1) +
    layer([7, 11, 8, 12, 7], 2.2, "#fff6d6", 1) +
    // afterburner diamond core
    `<path d="M-26 0 L-42 -3.5 L-48 0 L-42 3.5 Z" fill="#6be5ff" opacity=".8"><animate attributeName="opacity" values=".6;1;.6" dur=".15s" repeatCount="indefinite"/></path>` +
    `</g>`;
}

const BOLT_SYMBOLS =
  `<g id="bolt"><rect x="-9" y="-3" width="18" height="6" fill="#3ddcff" opacity=".35"/><rect x="-8" y="-1.5" width="16" height="3" fill="#aef3ff"/><rect x="-4" y="-.8" width="8" height="1.6" fill="#fff"/></g>` +
  `<g id="flash"><circle r="7" fill="url(#muz)"/><rect x="-6" y="-1" width="12" height="2" fill="#fff"/><rect x="-1" y="-5" width="2" height="10" fill="#fff"/></g>` +
  `<g id="hitShield"><circle r="12" fill="none" stroke="#6be5ff" stroke-width="2" stroke-dasharray="4 2"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur=".3s" repeatCount="indefinite"/><animate attributeName="r" values="8;15;10" dur=".2s" repeatCount="indefinite"/></circle></g>`;

// ───────────────────────── backdrop art ─────────────────────────
function starTile(rand, W, H, n, sizes, cols, alpha, twinkle, cls = "star") {
  let out = "";
  for (let i = 0; i < n; i++) {
    const s = pick(rand, sizes);
    const attrs = `x="${r1(rand() * W)}" y="${r1(rand() * H)}" width="${s}" height="${s}" fill="${pick(rand, cols)}" opacity="${alpha}" class="${cls}"`;
    out += i < twinkle
      ? `<rect ${attrs}><animate attributeName="opacity" values="${f2(alpha * 0.3)};${alpha};${f2(alpha * 0.3)}" dur="${(2 + rand() * 3.5).toFixed(1)}s" begin="${(-rand() * 5).toFixed(1)}s" repeatCount="indefinite"/></rect>`
      : `<rect ${attrs}/>`;
  }
  return out;
}

function nebulaTile(rand, W, H) {
  const grads = ["nebA", "nebB", "nebC"];
  let out = "";
  for (let i = 0; i < 7; i++) {
    const rx = 120 + rand() * 120, ry = 40 + rand() * 50;
    const x = 150 + rand() * (W - 300), y = 10 + rand() * (H - 20), rot = Math.round(-25 + rand() * 50);
    out += `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="url(#${grads[i % 3]})" transform="rotate(${rot} ${r1(x)} ${r1(y)})"/>`;
  }
  return out;
}

function planetPaths() {
  const R = 14, GW = 54, GH = 36, cx0 = GW / 2, cy0 = GH / 2;
  const L = [-0.55, -0.6, 0.58], ln = Math.hypot(...L), light = L.map((v) => v / ln);
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => (v + 0.5) / 16));
  const bandA = ["#221845", "#3a2a72", "#6646a6", "#a37ad6"], bandB = ["#2f1d4d", "#5a2f80", "#9a4f9c", "#da8cb2"];
  const ringLit = "#d6c6f0", ringDim = "#8f7cc0";
  const phi = (-16 * Math.PI) / 180, A = 24, B = 5.6;
  const rows = [];
  for (let j = 0; j < GH; j++) {
    const row = [];
    for (let i = 0; i < GW; i++) {
      const x = i + 0.5 - cx0, y = j + 0.5 - cy0;
      const xr = x * Math.cos(phi) - y * Math.sin(phi), yr = x * Math.sin(phi) + y * Math.cos(phi);
      const e = (xr / A) ** 2 + (yr / B) ** 2;
      const ringHit = e <= 1 && e >= 0.42 && !(e > 0.66 && e < 0.74);
      const ringCol = ((i + j) & 1) === 0 || e > 0.85 ? ringLit : ringDim;
      const d2 = x * x + y * y;
      let planet = null;
      if (d2 <= R * R) {
        const nz = Math.sqrt(1 - d2 / (R * R)), lum = Math.max(0, (x / R) * light[0] + (y / R) * light[1] + nz * light[2]);
        const band = Math.sin((y + 2 * Math.sin(x * 0.35)) * 0.62) > 0.1;
        const idx = clamp(Math.floor(lum * 3.2 + (bayer[j & 3][i & 3] - 0.5) * 0.9), 0, 3);
        planet = (band ? bandB : bandA)[idx];
      }
      row.push(ringHit && yr > 0 ? ringCol : planet ?? (ringHit ? mix(ringDim, "#000000", 0.45) : null));
    }
    rows.push(row);
  }
  return pixelsToPaths(rows, cx0, cy0);
}

function stationPaths() {
  const rows = [
    "....bbbb....",
    "...bBBBBb...",
    "..bbBBBBBbb.",
    "bbbbBBRBBbbbb",
    "BBBBBBBBBBBBB",
    "bpppbBBBpbppb",
    "bpppbBBBpbppb",
    "....bBBBb....",
    ".....bBb.....",
    ".....bBb.....",
    "....bbBbb....",
  ];
  const pal = { b: "#4a5568", B: "#718096", p: "#2b6cb0", R: "#fc8181" };
  const h = rows.length, w = rows[0].length;
  const mapped = rows.map((r) => [...r].map((c) => pal[c] ?? null));
  const body = pixelsToPaths(mapped, w / 2, h / 2, 0.2);
  const beacon = `<circle cx="0" cy="${f2(-h * CFG.U / 2 - 2)}" r="2" fill="#ff4d4d"><animate attributeName="opacity" values="0.15;1;0.15" dur="1.4s" repeatCount="indefinite"/></circle>`;
  const solarGlow = `<rect x="${f2(-w * CFG.U / 2)}" y="${f2(-2)}" width="${f2(w * CFG.U)}" height="8" fill="#63b3ed" opacity=".12"/>`;
  return `<g id="spaceStation">${solarGlow}${body}${beacon}</g>`;
}

function cometSymbol() {
  const dx = 0.92, dy = -0.39;
  let out = "";
  for (let k = 0; k < 9; k++) {
    const s = Math.max(0.8, 3 - k * 0.26);
    out += `<rect x="${f2(dx * k * 5.2 - s / 2)}" y="${f2(dy * k * 5.2 - s / 2)}" width="${f2(s)}" height="${f2(s)}" fill="${k === 0 ? "#ffffff" : "#bcd6ff"}" opacity="${f2(1 - k * 0.11)}"/>`;
  }
  return `<g id="comet">${out}</g>`;
}

// ───────────────────────── render ─────────────────────────
function render({ cols, cells }) {
  const { cell, gap, padX, padTop, padBottom, U } = CFG, pitch = cell + gap;
  const W = Math.round(padX * 2 + cols * pitch - gap), H = Math.round(padTop + 7 * pitch - gap + padBottom);
  const cx = (c) => padX + c * pitch + cell / 2, cy = (r) => padTop + r * pitch + cell / 2;
  const rand = rng(1337);

  // ── flight path & target navigation
  const rocks0 = cells.map((c) => ({ c, x: cx(c.col), y: cy(c.row) }));
  const STEP = 6, X0 = -70, X1 = W + 70;
  const yMin = cy(0) - 14, yMax = cy(6) + 14;
  const pts = [], dens = [];
  let yy = cy(3), vy = 0;

  for (let x = X0; x <= X1; x += STEP) {
    let sw = 0, sy = 0;
    for (const r of rocks0) {
      const dx = r.x - x;
      if (dx < -12 || dx > 280) continue;
      const w = dx < 0 ? 0.15 : 1 / (1 + (dx / 120) ** 2);
      sw += w; sy += w * r.y;
    }
    const wander = cy(3) + 26 * Math.sin(x / 150 + 1) + 12 * Math.sin(x / 57);
    const a = clamp(sw, 0, 1);
    const tgt = (sw > 0 ? a * (sy / sw) + (1 - a) * wander : wander) + 6 * Math.sin(x / 46) + 3 * Math.sin(x / 21 + 2);
    vy += 0.012 * (tgt - yy) - 0.17 * vy;
    vy = clamp(vy, -0.5 * STEP, 0.5 * STEP);
    yy = clamp(yy + vy, yMin, yMax);
    pts.push({ x: r1(x), y: r1(yy) });
    dens.push(sw);
  }

  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const N = pts.length, L = cum[N - 1];
  const posAt = (s) => {
    s = clamp(s, 0, L);
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const u = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * u, y: pts[lo].y + (pts[hi].y - pts[lo].y) * u };
  };
  const frac = (x) => { const u = clamp((x - X0) / STEP, 0, N - 1), i = Math.min(N - 2, Math.floor(u)); return [i, u - i]; };
  const yAtX = (x) => { const [i, f] = frac(x); return pts[i].y + (pts[i + 1].y - pts[i].y) * f; };
  const sAtX = (x) => { const [i, f] = frac(x); return cum[i] + (cum[i + 1] - cum[i]) * f; };

  // Streak detection: find consecutive runs of days
  const cellSet = new Set(cells.map((c) => `${c.col},${c.row}`));
  let maxStreak = 0, curStreak = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      if (cellSet.has(`${c},${r}`)) {
        curStreak++;
        if (curStreak > maxStreak) maxStreak = curStreak;
      } else {
        curStreak = 0;
      }
    }
  }

  // Speed profile with streak acceleration and exit afterburner boost
  const wrapA = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const th = pts.map((_, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)]; return Math.atan2(b.y - a.y, b.x - a.x); });
  let kap = pts.map((_, i) => { const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2); return Math.abs(wrapA(th[b] - th[a])) / Math.max(1e-3, cum[b] - cum[a]); });
  kap = kap.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 5); j <= Math.min(N - 1, i + 5); j++) { s += kap[j]; c++; } return s / c; });

  const streakBonus = Math.min(0.2, maxStreak * 0.02);
  const vrel = pts.map((_, i) => {
    const s = cum[i];
    const exitBoost = 1 + 0.75 * smooth(clamp((s - (L - 240)) / 240, 0, 1));
    return (1 - clamp(kap[i] * 45, 0, 0.4)) * (1.35 - 0.35 * smooth(clamp(s / 260, 0, 1))) * exitBoost * (1 - 0.5 * clamp(dens[i] / 6, 0, 1)) * (1 + streakBonus);
  });
  const trel = [0];
  for (let i = 1; i < N; i++) trel.push(trel[i - 1] + (cum[i] - cum[i - 1]) / ((vrel[i] + vrel[i - 1]) / 2));

  // Control points (≈ every 20px)
  const ctrl = [0];
  let nextS = 20;
  for (let i = 1; i < N - 1; i++) if (cum[i] >= nextS) { ctrl.push(i); nextS = cum[i] + 20; }
  ctrl.push(N - 1);
  const S = ctrl.map((i) => cum[i]);
  const F = clamp(trel[N - 1] / CFG.speed, CFG.minFlight, CFG.maxFlight);
  const Tm = ctrl.map((i) => (trel[i] * F) / trel[N - 1]);
  const vEnd = (S[S.length - 1] - S[S.length - 2]) / (Tm[Tm.length - 1] - Tm[Tm.length - 2]);
  const tailMax = Math.max(...CFG.trail.map((t) => t.tail));
  const T = F + Math.max(tailMax / vEnd, 3.2) + CFG.pause;
  const fT = (s) => f4(s / T);

  const tAtS = (s) => {
    s = clamp(s, 0, L);
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return Tm[lo] + ((Tm[hi] - Tm[lo]) * (s - S[lo])) / Math.max(1e-6, S[hi] - S[lo]);
  };
  const sAtT = (t) => {
    t = clamp(t, 0, F);
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Tm[m] <= t) lo = m; else hi = m; }
    return S[lo] + ((S[hi] - S[lo]) * (t - Tm[lo])) / Math.max(1e-6, Tm[hi] - Tm[lo]);
  };

  const keyPoints = [...S.map((s) => f4(s / L)), "1"].join(";");
  const keyTimes = [...Tm.map(fT), "1"].join(";");
  const d = "M" + pts[0].x + " " + pts[0].y + "L" + pts.slice(1).map((p) => `${p.x} ${p.y}`).join(" ");
  const motion = (begin) =>
    `<animateMotion dur="${f4(T)}s" begin="${f4(begin)}s" repeatCount="indefinite" calcMode="linear" keyPoints="${keyPoints}" keyTimes="${keyTimes}"><mpath xlink:href="#route"/></animateMotion>`;

  // ── gunnery: twin cannons, 2-hit level 4 rocks, anticipatory targeting
  const BOLT = 920, GAP = 0.09;
  const densAtX = (x) => dens[frac(x)[0]];
  const fireX = (r) => {
    let fx = r.x - 120;
    for (let k = 0; k < 3; k++) fx = r.x - (clamp(Math.abs(r.y - yAtX(fx)) / Math.tan(0.7) + 40, 70, 150) + clamp(densAtX(fx) * 5, 0, 60));
    return fx;
  };
  const byX = new Map();
  for (const r of rocks0) (byX.get(r.x) ?? byX.set(r.x, []).get(r.x)).push(r);
  const order = [];
  for (const x of [...byX.keys()].sort((p, q) => p - q)) {
    const group = byX.get(x), ya = yAtX(x - 140);
    group.sort((p, q) => p.y - q.y);
    if (Math.abs(ya - group[0].y) > Math.abs(ya - group[group.length - 1].y)) group.reverse();
    order.push(...group);
  }

  const hit = new Map(), shots = [];
  let slot = { t: -9, n: 2 }, side = 1;

  for (const r of order) {
    const isLevel4 = r.c.level === 4;
    const hitRounds = isLevel4 ? 2 : 1;
    const rockHits = [];

    for (let round = 0; round < hitRounds; round++) {
      const isFirstOfTwo = isLevel4 && round === 0;
      const leadDist = isFirstOfTwo ? 45 : 0;
      const want = tAtS(sAtX(fireX(r) - leadDist));
      const tmax = Math.max(0.15, tAtS(sAtX(r.x - 30)));
      let tf;
      if (slot.n < 2 && want <= slot.t + GAP) { slot.n++; tf = slot.t; }
      else { slot = { t: Math.max(0.12, want, slot.t + GAP), n: 1 }; tf = slot.t; }
      tf = Math.min(tf, tmax);

      const p = posAt(sAtT(tf));
      let a = Math.atan2(r.y - p.y, Math.max(8, r.x - p.x));
      side = -side;
      const ox = p.x + 24 * Math.cos(a) - side * 5 * Math.sin(a), oy = p.y + 24 * Math.sin(a) + side * 5 * Math.cos(a);
      const dist = Math.max(4, Math.hypot(r.x - ox, r.y - oy) - 6);
      a = Math.atan2(r.y - oy, r.x - ox);
      const sh = { tf, ox, oy, a, dist, h: tf + dist / BOLT + 0.02, isFirstOfTwo, level: r.c.level };
      shots.push(sh);
      rockHits.push(sh);
    }
    hit.set(r.c, rockHits);
  }

  // ── punchy recoil impulse calculation for the rocket
  shots.sort((a, b) => a.tf - b.tf);
  const recoilTimes = [0], recoilVals = ["0 0"];
  for (const sh of shots) {
    const t0 = Math.max(0.001, sh.tf);
    const tKick = sh.tf + 0.025;
    const tRecover = sh.tf + 0.09;
    const kx = r1(-5.2 * Math.cos(sh.a));
    const ky = r1(-5.2 * Math.sin(sh.a));
    recoilTimes.push(t0, tKick, tRecover);
    recoilVals.push("0 0", `${kx} ${ky}`, "0 0");
  }
  recoilTimes.push(T); recoilVals.push("0 0");

  const cleanRecoilTimes = [0], cleanRecoilVals = ["0 0"];
  for (let i = 1; i < recoilTimes.length; i++) {
    const prev = cleanRecoilTimes[cleanRecoilTimes.length - 1];
    if (recoilTimes[i] > prev + 0.008 && recoilTimes[i] < T) {
      cleanRecoilTimes.push(recoilTimes[i]);
      cleanRecoilVals.push(recoilVals[i]);
    }
  }
  cleanRecoilTimes.push(T); cleanRecoilVals.push("0 0");

  // ── empty stretch detection for barrel rolls
  const barrelRolls = [];
  let stretchStart = null;
  for (let i = 0; i < N; i++) {
    if (dens[i] < 0.25) {
      if (stretchStart === null) stretchStart = i;
    } else {
      if (stretchStart !== null) {
        const span = cum[i] - cum[stretchStart];
        if (span > 170 && cum[stretchStart] > 120 && cum[i] < L - 220) {
          const midS = (cum[stretchStart] + cum[i]) / 2;
          barrelRolls.push(tAtS(midS));
        }
        stretchStart = null;
      }
    }
  }

  // ── rocket tilt & anticipatory cluster scanning
  const angAt = (s) => { const a = posAt(s - 16), b = posAt(s + 16); return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; };
  let angs = S.map(angAt);
  angs = angs.map((_, j) => { const w = angs.slice(Math.max(0, j - 1), j + 2); return w.reduce((p, q) => p + q, 0) / w.length; });

  const scanAhead = (t) => {
    let targetShot = null, minDiff = 0.85;
    for (const sh of shots) {
      const diff = sh.tf - t;
      if (diff >= 0 && diff < minDiff) { minDiff = diff; targetShot = sh; }
    }
    return targetShot;
  };

  angs = angs.map((a, j) => {
    const t = Tm[j];
    const sh = scanAhead(t);
    if (!sh) return a;
    const shotAng = clamp((sh.a * 180) / Math.PI, -55, 55);
    const weight = smooth(clamp(1 - (sh.tf - t) / 0.85, 0, 1)) * 0.75;
    return a * (1 - weight) + shotAng * weight;
  });

  let cur = TILTS.indexOf(0);
  const seg = angs.map((a, j) => {
    const tgt = TILTS.reduce((best, fa, k) => (Math.abs(a - fa) < Math.abs(a - TILTS[best]) ? k : best), 0);
    if (tgt !== cur && Math.abs(a - TILTS[cur]) > 8) cur = tgt;
    return { t: Tm[j], f: cur };
  });

  const frames = TILTS.map((a, k) => {
    const { grid, ow, oh } = rotateGrid(ROCKET, a);
    const rows = grid.map((r) => r.map((ch) => (ch === "." ? null : RK[ch])));
    return `<g id="rf${k}"><use xlink:href="#flame" transform="rotate(${a})"/>${pixelsToPaths(rows, ow / 2, oh / 2)}</g>`;
  }).join("");

  const frameUse = TILTS.map((_, k) => {
    const kt = [], vals = [];
    let last = null;
    for (const { t, f } of seg) { const v = f === k ? 1 : 0; if (v !== last) { kt.push(t); vals.push(v); last = v; } }
    kt[0] = 0;
    if (vals.length === 1 && vals[0] === 0) return `<use xlink:href="#rf${k}" opacity="0"/>`;
    return `<use xlink:href="#rf${k}" opacity="${vals[0]}"><animate attributeName="opacity" calcMode="discrete" values="${vals.join(";")}" keyTimes="${kt.map(fT).join(";")}" dur="${f4(T)}s" repeatCount="indefinite"/></use>`;
  }).join("");

  // Barrel roll animation block
  let rollAnim = "";
  if (barrelRolls.length > 0) {
    const rTimes = [0], rRots = [0];
    for (const bt of barrelRolls) {
      rTimes.push(Math.max(0.01, bt - 0.05), bt, bt + 0.35, bt + 0.7);
      rRots.push(0, 0, 180, 360);
    }
    rTimes.push(T); rRots.push(360);
    rollAnim = `<animateTransform attributeName="transform" type="rotate" values="${rRots.map((r) => r % 360).join(";")}" keyTimes="${rTimes.map(fT).join(";")}" dur="${f4(T)}s" repeatCount="indefinite" additive="sum"/>`;
  }

  // Recoil + idle bob + pilot roll
  const recoilAnim = `<animateTransform attributeName="transform" type="translate" values="${cleanRecoilVals.join(";")}" keyTimes="${cleanRecoilTimes.map(fT).join(";")}" dur="${f4(T)}s" repeatCount="indefinite"/>`;
  const shipAura = `<circle cx="12" cy="0" r="54" fill="url(#shipAura)" opacity=".38"/><circle cx="-28" cy="0" r="38" fill="url(#engineAura)" opacity=".42"/>`;

  const rocket =
    `<g><g>${recoilAnim}<g><animateTransform attributeName="transform" type="translate" values="0 -.9;0 .9;0 -.9" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="1.1s" repeatCount="indefinite"/>${rollAnim}${shipAura}${frameUse}</g></g>${motion(0)}</g>`;

  // ── exhaust: embers that jitter and cool
  const NP = 12;
  let puffs = "";
  for (let j = 1; j <= NP; j++) {
    const u = (j - 1) / (NP - 1), lag = 0.09 + j * 0.058;
    const sz = 5.8 - 3.8 * u, op = 0.95 - 0.7 * u, jit = 0.4 + 3.2 * u;
    const col = u < 0.25 ? "#ffe3a3" : u < 0.55 ? "#ff9a40" : u < 0.8 ? "#d9663f" : "#8a93ab";
    const jv = Array.from({ length: 4 }, () => `${f2((rand() - 0.5) * 2 * jit)} ${f2((rand() - 0.5) * 2 * jit)}`);
    jv.push(jv[0]);
    puffs += `<g>${motion(lag - T)}<g><animateTransform attributeName="transform" type="translate" calcMode="discrete" values="${jv.join(";")}" dur="${(0.5 + rand() * 0.3).toFixed(2)}s" repeatCount="indefinite"/>` +
      `<rect x="${f2(-sz / 2)}" y="${f2(-sz / 2)}" width="${f2(sz)}" height="${f2(sz)}" fill="${col}" opacity="${f2(op)}"><animate attributeName="opacity" values="${f2(op)};${f2(op * 0.4)};${f2(op)};${f2(op * 0.7)};${f2(op)}" dur="${(0.4 + rand() * 0.25).toFixed(2)}s" repeatCount="indefinite"/></rect></g></g>`;
  }

  // ── trail
  const gapLen = Math.ceil(L + tailMax + 20);
  const trailLayer = (t) => {
    const vals = [...S.map((s) => Math.round(t.tail - s)), -Math.round(L), -Math.round(L)];
    const times = [...Tm.map(fT), fT(F + t.tail / vEnd), "1"];
    return `<use xlink:href="#route" stroke="${t.color}" stroke-width="${t.w}" stroke-opacity="${t.opacity}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${t.tail} ${gapLen}">` +
      `<animate attributeName="stroke-dashoffset" values="${vals.join(";")}" keyTimes="${times.join(";")}" dur="${f4(T)}s" repeatCount="indefinite"/></use>`;
  };
  const trail = `<g filter="url(#glow)">${CFG.trail.filter((t) => t.blur).map(trailLayer).join("")}</g>` + CFG.trail.filter((t) => !t.blur).map(trailLayer).join("");

  // ── asteroids: destruction, active tumbling debris, hit flash on level 4
  const pop = 0.16, grow = 0.55, burst = 0.52, e = 0.03;
  const needRock = new Set(), needSpark = new Set();
  let rocks = "", sparks = "", debris = "", hitEffects = "";

  // Debris shard trajectories
  const shardTrajectories = [
    { id: 0, dx: -15, dy: -11, rot: -180 },
    { id: 1, dx:  17, dy: -10, rot:  210 },
    { id: 2, dx: -11, dy:  15, rot:  150 },
    { id: 3, dx:  14, dy:  13, rot: -220 },
  ];

  for (const c of cells) {
    const hitList = hit.get(c);
    const isLevel4 = c.level === 4;
    const finalHit = hitList ? hitList[hitList.length - 1] : null;
    const h = finalHit?.h ?? 0.08;
    const lv = clamp(c.level, 1, 4);
    const hash = (Math.imul(c.col + 11, 73856093) ^ Math.imul(c.row + 5, 19349663)) >>> 0;
    const v = hash & 1, p = (hash >> 1) & 3, k = (hash >> 3) % 3;

    needRock.add(`${lv},${v},${p}`); needSpark.add(`${lv},${k}`);
    const x = r1(cx(c.col)), y = r1(cy(c.row));
    let r = h + CFG.regrow, kt, op, sc;

    if (r + grow < T - 0.05) {
      kt = [0, h, h + pop, r, r + grow, T]; op = [1, 1, 0, 0, 1, 1]; sc = [1, 1, 1.4, 0.35, 1, 1];
    } else {
      const r2 = Math.max(0.001, r - T);
      kt = [0, r2, r2 + grow, h, h + pop, T]; op = [0, 0, 1, 1, 0, 0]; sc = [0.35, 0.35, 1, 1, 1.4, 0.35];
    }
    const kts = kt.map(fT).join(";"), dur = `dur="${f4(T)}s" repeatCount="indefinite"`;

    // First hit effect on Level 4
    if (isLevel4 && hitList && hitList.length > 1) {
      const h1 = hitList[0].h;
      hitEffects += `<g transform="translate(${x} ${y})"><use xlink:href="#hitShield" opacity="0">` +
        `<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${fT(h1)};${fT(h1 + 0.02)};${fT(h1 + 0.18)};1" ${dur}/></use></g>`;
    }

    rocks += `<g transform="translate(${x} ${y})">` +
      `<use xlink:href="#halo" opacity="0"><animate attributeName="opacity" values="0;0;.9;.5;.16;0;0" keyTimes="0;${fT(h)};${fT(h + 0.08)};${fT(h + 0.9)};${fT(h + 2)};${fT(h + 3.2)};1" ${dur}/></use>` +
      `<use xlink:href="#rk${lv}${v}${p}"><animateTransform attributeName="transform" type="scale" values="${sc.join(";")}" keyTimes="${kts}" ${dur}/>` +
      `<animate attributeName="opacity" values="${op.join(";")}" keyTimes="${kts}" ${dur}/></use></g>`;

    sparks += `<g transform="translate(${x} ${y})"><use xlink:href="#sp${lv}${k}" opacity="0">` +
      `<animateTransform attributeName="transform" type="scale" values="0.5;0.5;2.6;2.6" keyTimes="0;${fT(h)};${fT(h + burst)};1" ${dur}/>` +
      `<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${fT(h)};${fT(h + e)};${fT(h + burst)};1" ${dur}/></use></g>`;

    // Active tumbling rock debris fragments (3 shards for lv 1-2, 4 shards for lv 3-4)
    const shardCount = lv >= 3 ? 4 : 3;
    const hEnd = h + 0.46;
    for (let sIdx = 0; sIdx < shardCount; sIdx++) {
      const s = shardTrajectories[sIdx];
      const jx = ((hash >> (sIdx * 3)) & 3) - 1.5;
      const jy = ((hash >> (sIdx * 3 + 1)) & 3) - 1.5;
      const tdx = f1(s.dx + jx);
      const tdy = f1(s.dy + jy);

      debris += `<g transform="translate(${x} ${y})">` +
        `<use xlink:href="#fg${lv}_${s.id}" opacity="0">` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;${tdx} ${tdy};${tdx} ${tdy}" keyTimes="0;${fT(h)};${fT(hEnd)};1" ${dur}/>` +
        `<animateTransform attributeName="transform" type="rotate" values="0;0;${s.rot};${s.rot}" keyTimes="0;${fT(h)};${fT(hEnd)};1" ${dur} additive="sum"/>` +
        `<animate attributeName="opacity" values="0;0;1;0.85;0;0" keyTimes="0;${fT(h)};${fT(h + 0.02)};${fT(h + 0.35)};${fT(hEnd)};1" ${dur}/>` +
        `</use></g>`;
    }
  }

  // ── laser bolts
  let bolts = "";
  for (const sh of shots) {
    const e = 0.012, tr = sh.dist / BOLT, dd = `dur="${f4(T)}s" repeatCount="indefinite"`;
    bolts += `<g transform="translate(${r1(sh.ox)} ${r1(sh.oy)}) rotate(${r1((sh.a * 180) / Math.PI)})">` +
      `<use xlink:href="#flash" opacity="0"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${fT(sh.tf)};${fT(sh.tf + e)};${fT(sh.tf + 0.1)};1" ${dd}/></use>` +
      `<use xlink:href="#bolt" opacity="0"><animateTransform attributeName="transform" type="translate" values="0 0;0 0;${r1(sh.dist)} 0;${r1(sh.dist)} 0" keyTimes="0;${fT(sh.tf)};${fT(sh.tf + tr)};1" ${dd}/>` +
      `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${fT(sh.tf)};${fT(sh.tf + e)};${fT(sh.tf + tr)};${fT(sh.tf + tr + e)};1" ${dd}/></use></g>`;
  }

  const symbols =
    [...needRock].map((s) => rockSymbol(...s.split(",").map(Number))).join("") +
    [...needSpark].map((s) => sparkSymbol(...s.split(",").map(Number))).join("") +
    fragmentSymbols();

  // ── background layers
  const lit = new Set(cells.map((c) => `${c.col},${c.row}`));
  let dots = "";
  for (let c = 0; c < cols; c++) for (let r = 0; r < 7; r++) {
    if (!lit.has(`${c},${r}`)) dots += `M${r1(cx(c) - 1.2)} ${r1(cy(r) - 1.2)}h2.4v2.4h-2.4z`;
  }
  const scroll = (id, dur) =>
    `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${-W} 0" dur="${dur}s" repeatCount="indefinite"/><use xlink:href="#${id}"/><use xlink:href="#${id}" x="${W}"/></g>`;
  const comet = (period, delay, x0, y0, run) => {
    const a = f4(1.25 / period), x1 = f2(x0 - run * 0.92), y1 = f2(y0 + run * 0.39);
    return `<g opacity="0"><animateTransform attributeName="transform" type="translate" values="${x0} ${y0};${x1} ${y1};${x1} ${y1}" keyTimes="0;${a};1" dur="${period}s" begin="${-delay}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.012;${f4(1.25 / period - 0.012)};${a};1" dur="${period}s" begin="${-delay}s" repeatCount="indefinite"/><use xlink:href="#comet"/></g>`;
  };

  const farStars = starTile(rand, W, H, Math.round(W / 9), [1, 1, 1.5], ["#8fa3c8", "#bcd6ff", "#ffffff"], 0.55, 0, "star-far");
  const midStars = starTile(rand, W, H, Math.round(W / 18), [1.5, 2], ["#ffffff", "#bcd6ff", "#fff1c1"], 0.75, 9, "star-mid");
  const nearStars = starTile(rand, W, H, Math.round(W / 40), [2, 2.5, 3], ["#ffffff", "#cfe0ff", "#ffe9b0"], 0.95, 12, "star-near");
  const planetX = Math.round(W - 145), planetY = Math.round(padTop + 6);
  const stationX = Math.round(W * 0.22), stationY = Math.round(H - 44);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<title>A pixel rocket flying through my GitHub contributions, blasting each commit as it passes</title>
<style>
  .bg-base { fill: url(#bgG); }
  .grid-dot { fill: ${CFG.dot}; opacity: .24; }
  @media (prefers-color-scheme: light) {
    .bg-base { fill: url(#bgLightG); }
    .grid-dot { fill: ${CFG.dotLight}; opacity: .55; }
    .star-far { fill: #8a99b5; opacity: .35; }
    .star-mid { fill: #637599; opacity: .5; }
    .star-near { fill: #485c82; opacity: .7; }
  }
</style>
<defs>
<linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CFG.bgTop}"/><stop offset="1" stop-color="${CFG.bgBot}"/></linearGradient>
<linearGradient id="bgLightG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CFG.bgLightTop}"/><stop offset="1" stop-color="${CFG.bgLightBot}"/></linearGradient>
<radialGradient id="nebA"><stop offset="0" stop-color="#7a4dff" stop-opacity=".26"/><stop offset="1" stop-color="#7a4dff" stop-opacity="0"/></radialGradient>
<radialGradient id="nebB"><stop offset="0" stop-color="#19c3c9" stop-opacity=".2"/><stop offset="1" stop-color="#19c3c9" stop-opacity="0"/></radialGradient>
<radialGradient id="nebC"><stop offset="0" stop-color="#e0489a" stop-opacity=".2"/><stop offset="1" stop-color="#e0489a" stop-opacity="0"/></radialGradient>
<radialGradient id="muz"><stop offset="0" stop-color="#bff4ff" stop-opacity=".9"/><stop offset="1" stop-color="#3ddcff" stop-opacity="0"/></radialGradient>
<radialGradient id="eng"><stop offset="0" stop-color="#ffb347" stop-opacity=".65"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
<radialGradient id="shipAura"><stop offset="0" stop-color="#6be5ff" stop-opacity=".24"/><stop offset="1" stop-color="#6be5ff" stop-opacity="0"/></radialGradient>
<radialGradient id="engineAura"><stop offset="0" stop-color="#ff9a40" stop-opacity=".3"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
<radialGradient id="haloG"><stop offset="0" stop-color="#8dffae" stop-opacity=".6"/><stop offset=".55" stop-color="#2ea043" stop-opacity=".25"/><stop offset="1" stop-color="#2ea043" stop-opacity="0"/></radialGradient>
<circle id="halo" r="22" fill="url(#haloG)"/>
<filter id="glow" filterUnits="userSpaceOnUse" x="-80" y="-80" width="${W + 160}" height="${H + 160}"><feGaussianBlur stdDeviation="3.5"/></filter>
<path id="route" fill="none" d="${d}"/>
<clipPath id="clip"><rect width="${W}" height="${H}" rx="10"/></clipPath>
<g id="nebula">${nebulaTile(rand, W, H)}</g>
<g id="starsFar">${farStars}</g>
<g id="starsMid">${midStars}</g>
<g id="starsNear">${nearStars}</g>
${stationPaths()}
${cometSymbol()}
${flameSymbol()}
${BOLT_SYMBOLS}
${symbols}
${frames}
</defs>
<g clip-path="url(#clip)">
<rect width="${W}" height="${H}" class="bg-base"/>
${scroll("nebula", 220)}
${scroll("starsFar", 190)}
<g transform="translate(${planetX} ${planetY})" opacity=".8"><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -2.5;0 0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="9s" repeatCount="indefinite"/>${planetPaths()}</g></g>
<g transform="translate(${stationX} ${stationY})" opacity=".75"><g><animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="7s" repeatCount="indefinite"/><use xlink:href="#spaceStation"/></g></g>
${scroll("starsMid", 110)}
${scroll("starsNear", 64)}
${comet(11.3, 3, Math.round(W * 0.78), 18, 300)}
${comet(17.9, 12, Math.round(W * 0.42), 6, 260)}
<path d="${dots}" class="grid-dot"/>
${rocks}
${hitEffects}
${debris}
${trail}
${puffs}
${rocket}
${bolts}
${sparks}
</g>
</svg>
`;
}

// ───────────────────────── main ─────────────────────────
async function main() {
  let data;
  if (flag("sample")) {
    data = SAMPLE;
  } else if (arg("data")) {
    data = JSON.parse(readFileSync(arg("data"), "utf8"));
  } else {
    const user = arg("user", process.env.GITHUB_USER || "SiddhantKoli");
    const token = process.env.GITHUB_TOKEN;
    data = await fetchContributions(user, token);
  }
  const svg = render(data);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg);
  console.log(`Wrote ${OUT} (${(svg.length / 1024).toFixed(1)} KB, ${data.cells.length} asteroids)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
