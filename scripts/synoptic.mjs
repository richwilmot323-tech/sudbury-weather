// Builds data/synoptic.json for the app's Pressure tab:
// GFS mean sea-level pressure, 6-hour precipitation (rain vs snow) and 250 mb wind
// on a 2.5° grid from the central Pacific to the western Atlantic, every 6 hours for 10 days,
// plus detected high/low pressure centers linked into tracks.
//
// Env: OUT (default data/synoptic.json), SLEEP_MS between API batches (default 12000)
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.OUT || "data/synoptic.json";
const SLEEP_MS = +(process.env.SLEEP_MS ?? 12000);
const LAT0 = 15, LAT1 = 62.5, LON0 = -150, LON1 = -40, D = 2.5;
const NLAT = Math.round((LAT1 - LAT0) / D) + 1, NLON = Math.round((LON1 - LON0) / D) + 1;
const FRAMES = 41, STEP_H = 6, BATCH = 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- fetch ---------- */
async function fetchBatch(pts) {
  const p = new URLSearchParams({
    latitude: pts.map(x => x[0]).join(","), longitude: pts.map(x => x[1]).join(","),
    hourly: "pressure_msl,precipitation,snowfall,wind_speed_250hPa,wind_direction_250hPa",
    models: "gfs_global", wind_speed_unit: "kn", forecast_days: "11", timezone: "GMT", cell_selection: "nearest",
  });
  for (let attempt = 0; attempt < 7; attempt++) {
    let wait = 10000 * (attempt + 1);
    try {
      const r = await fetch("https://api.open-meteo.com/v1/forecast?" + p, {
        headers: { "User-Agent": "sudbury-weather synoptic map" }, signal: AbortSignal.timeout(90000) });
      if (r.ok) { const j = await r.json(); return Array.isArray(j) ? j : [j]; }
      const msg = await r.text();
      console.warn(`batch HTTP ${r.status} (attempt ${attempt + 1}): ${msg.slice(0, 200)}`);
      if (r.status === 429) wait = 65000;
    } catch (e) {
      // network-level failures (connect timeouts, resets) are retried too
      console.warn(`batch network error (attempt ${attempt + 1}): ${e.cause?.code || e.name}: ${e.message}`);
    }
    await sleep(wait);
  }
  throw new Error("Open-Meteo batch failed after retries");
}

export async function fetchGrid() {
  const pts = [];
  for (let j = 0; j < NLAT; j++) for (let i = 0; i < NLON; i++) pts.push([LAT0 + j * D, LON0 + i * D]);
  const res = [];
  for (let k = 0; k < pts.length; k += BATCH) {
    const batch = pts.slice(k, k + BATCH);
    res.push(...await fetchBatch(batch));
    console.log(`fetched ${Math.min(k + BATCH, pts.length)}/${pts.length} points`);
    if (k + BATCH < pts.length) await sleep(SLEEP_MS);
  }
  return res;
}

/* ---------- grid helpers ---------- */
const idx = (j, i) => j * NLON + i;
function fillNulls(a) {
  for (let pass = 0; pass < 6 && a.some(v => v == null || !isFinite(v)); pass++) {
    const b = a.slice();
    for (let j = 0; j < NLAT; j++) for (let i = 0; i < NLON; i++) {
      if (a[idx(j, i)] != null && isFinite(a[idx(j, i)])) continue;
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = j + dj, ii = i + di;
        if (jj < 0 || ii < 0 || jj >= NLAT || ii >= NLON) continue;
        const v = a[idx(jj, ii)]; if (v != null && isFinite(v)) { s += v; n++; }
      }
      if (n) b[idx(j, i)] = s / n;
    }
    a = b;
  }
  return a.map(v => (v == null || !isFinite(v) ? 1013 : v));
}
function smooth(a) {
  const w = [[1, 2, 1], [2, 4, 2], [1, 2, 1]], b = new Array(a.length);
  for (let j = 0; j < NLAT; j++) for (let i = 0; i < NLON; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const jj = j + dj, ii = i + di;
      if (jj < 0 || ii < 0 || jj >= NLAT || ii >= NLON) continue;
      const k = w[dj + 1][di + 1]; s += a[idx(jj, ii)] * k; n += k;
    }
    b[idx(j, i)] = s / n;
  }
  return b;
}
const distDeg = (a, b) => {
  const dlat = a.lat - b.lat, dlon = (a.lon - b.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.hypot(dlat, dlon);
};

/* ---------- high / low detection ---------- */
export function findCenters(p) {
  const s = smooth(p), out = [];
  const R = 2, RING = 3;
  for (let j = R; j < NLAT - R; j++) for (let i = R; i < NLON - R; i++) {
    const v = s[idx(j, i)];
    let isMin = true, isMax = true;
    for (let dj = -R; dj <= R && (isMin || isMax); dj++) for (let di = -R; di <= R; di++) {
      if (!dj && !di) continue;
      const u = s[idx(j + dj, i + di)];
      if (u < v) isMin = false;
      if (u > v) isMax = false;
    }
    if (!isMin && !isMax) continue;
    // prominence: compare with the mean of a ring ~7.5° out (clipped to the grid)
    let rs = 0, rn = 0;
    for (let dj = -RING; dj <= RING; dj++) for (let di = -RING; di <= RING; di++) {
      if (Math.max(Math.abs(dj), Math.abs(di)) !== RING) continue;
      const jj = j + dj, ii = i + di;
      if (jj < 0 || ii < 0 || jj >= NLAT || ii >= NLON) continue;
      rs += s[idx(jj, ii)]; rn++;
    }
    const prom = rn ? (isMin ? rs / rn - v : v - rs / rn) : 0;
    if (prom < 2) continue;
    // sub-grid position by fitting a parabola in each direction
    const fit = (a, b, c) => { const den = a - 2 * b + c; return den ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0; };
    const ox = fit(s[idx(j, i - 1)], v, s[idx(j, i + 1)]), oy = fit(s[idx(j - 1, i)], v, s[idx(j + 1, i)]);
    // report the raw (unsmoothed) extreme pressure in the 3x3 around the center
    let raw = p[idx(j, i)];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const u = p[idx(j + dj, i + di)]; raw = isMin ? Math.min(raw, u) : Math.max(raw, u);
    }
    if (isMin && raw > 1018) continue;
    if (isMax && raw < 1012) continue;
    out.push({ type: isMin ? "L" : "H", lat: +(LAT0 + (j + oy) * D).toFixed(2), lon: +(LON0 + (i + ox) * D).toFixed(2), p: Math.round(raw), prom });
  }
  // keep the strongest of any same-type centers within 8°
  out.sort((a, b) => b.prom - a.prom);
  const kept = [];
  for (const c of out) if (!kept.some(k => k.type === c.type && distDeg(k, c) < 8)) kept.push(c);
  return kept.map(({ prom, ...c }) => c);
}

/* ---------- tracking ---------- */
export function track(framesCenters) {
  let next = 1;
  const tracks = {};
  let prev = [];
  framesCenters.forEach((cs, f) => {
    const pairs = [];
    cs.forEach((c, ci) => prev.forEach((pc, pi) => {
      if (pc.type !== c.type) return;
      const d = distDeg(pc, c);
      if (d < 8 && Math.abs(pc.p - c.p) <= 20) pairs.push({ ci, pi, d }); // ~550 mi per 6 h max
    }));
    pairs.sort((a, b) => a.d - b.d);
    const usedC = new Set(), usedP = new Set();
    pairs.forEach(({ ci, pi }) => {
      if (usedC.has(ci) || usedP.has(pi)) return;
      usedC.add(ci); usedP.add(pi); cs[ci].id = prev[pi].id;
    });
    cs.forEach(c => {
      if (!c.id) c.id = next++;
      (tracks[c.id] = tracks[c.id] || { type: c.type, pts: [] }).pts.push([f, c.lat, c.lon, c.p]);
    });
    prev = cs;
  });
  return tracks;
}

/* ---------- assemble ---------- */
export function build(res, now = new Date()) {
  const times = res[0].hourly.time; // "YYYY-MM-DDTHH:00" in GMT
  const tms = times.map(t => Date.parse(t + "Z"));
  const start = Math.floor(now.getTime() / (STEP_H * 3600e3)) * STEP_H * 3600e3;
  let t0 = tms.findIndex(t => t >= start);
  if (t0 < 0) throw new Error("no times at/after now");
  const frameIdx = [];
  for (let f = 0; f < FRAMES && t0 + f * STEP_H < tms.length; f++) frameIdx.push(t0 + f * STEP_H);

  const series = k => res.map(r => r.hourly[k] || []);
  const P = series("pressure_msl"), PR = series("precipitation"), SN = series("snowfall"),
        WS = series("wind_speed_250hPa"), WD = series("wind_direction_250hPa");

  const frames = [], centersByFrame = [];
  frameIdx.forEach((t, f) => {
    const p = fillNulls(P.map(a => a[t]));
    const rain = [], snow = [], u = [], v = [];
    for (let n = 0; n < res.length; n++) {
      let pr = 0, sw = 0;
      for (let h = Math.max(0, t - STEP_H + 1); h <= t; h++) {
        pr += PR[n][h] || 0;
        sw += (SN[n][h] || 0) * 10 / 7; // snowfall cm -> water mm (Open-Meteo uses 7 cm snow ≈ 10 mm water)
      }
      sw = Math.min(sw, pr);
      rain.push(Math.round((pr - sw) * 10)); snow.push(Math.round(sw * 10));
      const s = WS[n][t], d = WD[n][t];
      if (s == null || d == null) { u.push(0); v.push(0); }
      else { const r = d * Math.PI / 180; u.push(Math.round(-s * Math.sin(r))); v.push(Math.round(-s * Math.cos(r))); }
    }
    frames.push({ p: p.map(x => Math.round(x * 10)), r: rain, s: snow, u, v });
    centersByFrame.push(findCenters(p));
  });
  const tracks = track(centersByFrame);
  return {
    generated: new Date().toISOString(), model: "GFS (via Open-Meteo)",
    lat0: LAT0, lon0: LON0, d: D, nlat: NLAT, nlon: NLON, stepHours: STEP_H,
    times: frameIdx.map(t => new Date(tms[t]).toISOString()),
    frames,
    centers: centersByFrame.map(cs => cs.map(c => [c.id, c.type, c.lat, c.lon, c.p])),
    tracks,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await fetchGrid();
  if (res.length !== NLAT * NLON) throw new Error(`expected ${NLAT * NLON} points, got ${res.length}`);
  const out = build(res);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const n = out.centers.reduce((a, c) => a + c.length, 0);
  console.log(`wrote ${OUT}: ${out.frames.length} frames, ${n} centers, ${Object.keys(out.tracks).length} tracks, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}
