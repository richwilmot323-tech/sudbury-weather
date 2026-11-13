// Morning weather notification + bad-weather alerts, sent via ntfy.
// Runs the exact blending code from index.html so the message matches the app.
//
// Env:
//   NTFY_TOPIC   ntfy topic to publish to (required unless DRY_RUN)
//   NTFY_SERVER  default https://ntfy.sh
//   APP_URL      link opened when tapping the notification
//   WX_NAME / WX_LAT / WX_LON / WX_TZ   location (default Sudbury, MA)
//   STATE_FILE   JSON file remembering what was already sent (default .notify-state.json)
//   MODE         auto (default) | morning | check | test
//   MORNING_HOUR local hour at/after which the morning message goes out (default 6)
//   DRY_RUN=1    print instead of sending
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const LOC = {
  name: env.WX_NAME || "Sudbury, MA",
  lat: +(env.WX_LAT || 42.3834),
  lon: +(env.WX_LON || -71.4162),
  tz: env.WX_TZ || "America/New_York",
};
const APP_URL = env.APP_URL || "https://richwilmot323-tech.github.io/sudbury-weather/";
const STATE_FILE = env.STATE_FILE || path.join(here, "..", ".notify-state.json");
const DRY = !!env.DRY_RUN;
const MORNING_HOUR = +(env.MORNING_HOUR || 6);
const MODE = env.MODE || "auto";

/* ---------- load the app's blending code ---------- */
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const a = script.indexOf("/* ---------- config ---------- */");
const b = script.indexOf("/* ---------- render: main ---------- */");
if (a < 0 || b < 0) throw new Error("Could not find blend code in index.html");
const code = script.slice(a, b) + `
;globalThis.__api = {
  get STATE(){ return STATE; },
  setLoc(l){ LAT=l.lat; LON=l.lon; TZ=l.tz; PLACE=l; makeKeyFmt(); },
  loadAll, summary, winTime, windowAmt, sky, chanceWord, TYPE_LABEL, localKey, addDays,
  dayName, keyLabel, hourLabel, r0, inch, snowIn, rangeIn, num, classify
};`;
const UA = "(sudbury-weather notifier, github.com/richwilmot323-tech/sudbury-weather)";
const ctx = vm.createContext({
  fetch: (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), "User-Agent": UA } }),
  URLSearchParams, URL, console,
  document: { getElementById: () => ({ set textContent(v) {}, set innerHTML(v) {} }) },
  render() {},
});
new vm.Script(code).runInContext(ctx);
const W = ctx.__api;

/* ---------- helpers ---------- */
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; } };
const saveState = s => { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); };
const TAG = { rain: "cloud_with_rain", snow: "snowflake", mix: "cloud_with_snow", ice: "ice_cube", sleet: "cloud_with_snow", thunder: "cloud_with_lightning_and_rain" };
const deg = v => `${W.r0(v)}°`;
const short = LOC.name.split(",")[0];

function skyTag(d) {
  const c = d.cloud;
  return !W.num(c) ? "partly_sunny" : c < 25 ? "sunny" : c < 55 ? "sun_behind_small_cloud" : c < 80 ? "partly_sunny" : "cloud";
}
function headline(d) {
  if (W.num(d.pop) && d.pop >= 30 && d.type) return `${W.TYPE_LABEL[d.type]} ${W.chanceWord(d.pop)}`;
  return W.sky(d.cloud) || "Fair";
}
function precipLine(d) {
  const wins = d.windows.filter(w => w.peakProb >= 0.4);
  if (!wins.length || !W.num(d.pop) || d.pop < 30) {
    return W.num(d.pop) && d.pop >= 15 && d.type ? `Slight chance of ${W.TYPE_LABEL[d.type].toLowerCase()} (${W.r0(d.pop)}%).` : `Dry (${W.r0(d.pop)}% chance of precip).`;
  }
  const parts = wins.slice(0, 2).map(w => {
    const amt = W.windowAmt(w);
    return `${W.TYPE_LABEL[w.type]} ${W.winTime(w, d.date)}${amt ? ` (${amt})` : ""}`;
  });
  return `${parts.join("; ")}. ${W.r0(d.pop)}% chance overall.`;
}
function windLine(d) {
  if (!W.num(d.wind)) return "";
  const g = W.num(d.gust) && d.gust >= 25 ? `, gusts to ${W.r0(d.gust)}` : "";
  return `Wind to ${W.r0(d.wind)} mph${g}.`;
}
function notableTomorrow(d) {
  if (!d || !d.nSrc) return null;
  const today = W.STATE.daily[0];
  const bits = [];
  if (W.num(d.pop) && d.pop >= 50 && d.type) {
    const w = d.windows.find(x => x.keys.some(k => k.startsWith(d.date)));
    const amt = w ? W.windowAmt(w) : "";
    bits.push(`${W.TYPE_LABEL[d.type]} ${W.chanceWord(d.pop)}${w ? " " + W.winTime(w, d.date) : ""}${amt ? `, ${amt}` : ""}`);
  }
  if (W.num(d.snow) && d.snow >= 1 && !bits.length) bits.push(`${W.snowIn(d.snow)} of snow possible`);
  if (W.num(d.gust) && d.gust >= 40) bits.push(`gusts to ${W.r0(d.gust)} mph`);
  if (W.num(today.hi) && W.num(d.hi) && Math.abs(d.hi - today.hi) >= 12) bits.push(`${d.hi > today.hi ? "much warmer" : "much colder"}, high ${deg(d.hi)}`);
  return bits.length ? `Tomorrow: ${bits.join("; ")}.` : null;
}
function alertLines(alerts) {
  return alerts.map(a => {
    const p = a.properties;
    const ends = p.ends || p.expires;
    const until = ends ? ` until ${new Date(ends).toLocaleString("en-US", { timeZone: LOC.tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "")}` : "";
    return `⚠️ ${p.event}${until}`;
  });
}
function activeAlerts() {
  const f = (W.STATE.alerts && W.STATE.alerts.features) || [];
  return f.filter(a => a.properties && (!a.properties.status || a.properties.status === "Actual"));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send({ title, message, tags = [], priority = 3 }) {
  const body = {
    topic: env.NTFY_TOPIC, title, message, tags, priority, click: APP_URL,
    actions: [{ action: "view", label: "Open Blendcast", url: APP_URL }],
  };
  if (DRY) { console.log("\n=== WOULD SEND ===\n" + JSON.stringify({ title, message, tags, priority }, null, 2)); return; }
  if (!env.NTFY_TOPIC) throw new Error("NTFY_TOPIC not set");
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(env.NTFY_SERVER || "https://ntfy.sh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`ntfy HTTP ${r.status}: ${await r.text()}`);
      console.log("sent:", title); return;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.warn(`ntfy send failed (attempt ${attempt}): ${e.message}; retrying`); await sleep(15000 * attempt);
    }
  }
}

/* ---------- main ---------- */
W.setLoc(LOC);
// Weather services occasionally blip; retry the whole load a few times before giving up.
for (let attempt = 1; attempt <= 3; attempt++) {
  try { await W.loadAll(); } catch (e) { console.warn(`load attempt ${attempt} threw: ${e.message}`); }
  const st = W.STATE;
  const ok = st && st.daily && st.daily[0] && st.daily[0].nSrc && st.sources.length >= 2;
  if (ok) break;
  console.warn(`forecast load attempt ${attempt} incomplete${st ? ` (${st.sources.length} sources)` : ""}`);
  if (attempt < 3) await sleep(30000);
}
const S = W.STATE;
if (!S || !S.daily || !S.daily[0] || !S.daily[0].nSrc) {
  // Only fail loudly (which emails you) if the morning message is at risk; otherwise skip quietly and try next hour.
  const hourNow = +W.localKey(new Date()).slice(11, 13);
  const st = loadState(), day = W.localKey(new Date()).slice(0, 10);
  const morningMissing = !(st.days && st.days[day] && st.days[day].morningSent);
  if (MODE !== "test" && !(morningMissing && hourNow >= 10)) { console.warn("No forecast data this hour; skipping quietly, will retry next run."); process.exit(0); }
  throw new Error("No forecast data loaded");
}
console.log("sources:", S.status.map(s => `${s.name}:${s.ok ? "ok" : "FAIL"}`).join(", "));

const nowKey = W.localKey(new Date());
const today = nowKey.slice(0, 10);
const hour = +nowKey.slice(11, 13);
const localTime = hour + new Date().getUTCMinutes() / 60; // US time zones are whole-hour offsets
const state = loadState();
state.days = state.days || {};
const dayState = state.days[today] = state.days[today] || { types: [], snow: 0, gust: 0, alerts: [] };
// drop state older than a week
Object.keys(state.days).forEach(d => { if (d < W.addDays(today, -7)) delete state.days[d]; });

const d0 = S.daily[0], d1 = S.daily[1];
const alerts = activeAlerts();

function morningMessage() {
  const lines = [precipLine(d0), windLine(d0), ...alertLines(alerts)];
  const t = notableTomorrow(d1); if (t) lines.push(t);
  const tag = W.num(d0.pop) && d0.pop >= 30 && d0.type ? TAG[d0.type] : skyTag(d0);
  return {
    title: `${short} today: ${deg(d0.hi)} / ${deg(d0.lo)} · ${headline(d0)}`,
    message: lines.filter(Boolean).join("\n"),
    tags: [tag, ...(alerts.length ? ["warning"] : [])],
    priority: alerts.length ? 4 : 3,
  };
}
function recordMorning() {
  dayState.morningSent = true;
  // everything already covered by the morning message: today's windows and anything starting before 6 AM tomorrow
  dayState.types = [...new Set(S.windows.filter(w => w.peakProb >= 0.4 && w.end >= nowKey && w.start <= W.addDays(today, 1) + "T06").map(w => w.type))];
  dayState.snow = W.num(d0.snow) ? d0.snow : 0;
  dayState.gust = W.num(d0.gust) ? d0.gust : 0;
  dayState.alerts = alerts.map(a => a.properties.id || a.id);
}

if (MODE === "test") {
  const m = morningMessage();
  await send({ ...m, title: "✅ Weather alerts are set up", message: `You'll get this every morning around ${MORNING_HOUR} AM.\n\nRight now: ${m.title}\n${m.message}` });
} else {
  const sent = [];
  // 1) Morning briefing
  if ((MODE === "morning" || (MODE === "auto" && localTime >= MORNING_HOUR - 0.25)) && !dayState.morningSent) {
    await send(morningMessage()); recordMorning(); sent.push("morning");
  }
  // 2) Bad-weather alerts (only after the morning message, and outside quiet hours unless it's a warning)
  if ((MODE !== "morning" && dayState.morningSent) || MODE === "check") {
    const quiet = hour >= 22 || localTime < MORNING_HOUR - 0.25;
    // a) new NWS alerts
    for (const a of alerts) {
      const id = a.properties.id || a.id;
      if (dayState.alerts.includes(id)) continue;
      const p = a.properties;
      const isWarning = /Warning|Emergency/.test(p.event || "") || ["Extreme", "Severe"].includes(p.severity);
      if (quiet && !isWarning) continue;
      await send({
        title: `⚠️ ${p.event} for ${short}`,
        message: `${p.headline || ""}\n\n${(p.description || "").replace(/\s+/g, " ").slice(0, 400)}`.trim(),
        tags: ["warning"], priority: isWarning ? 5 : 4,
      });
      dayState.alerts.push(id); sent.push("alert:" + p.event);
    }
    // b) forecast changed: new precip type / big snow / damaging wind not in this morning's message
    if (!quiet) {
      const upcoming = S.windows.filter(w => w.peakProb >= 0.6 && w.end >= nowKey && w.start <= W.addDays(today, 1) + "T06");
      const newType = upcoming.find(w => !dayState.types.includes(w.type));
      const snowNow = upcoming.reduce((m, w) => Math.max(m, W.num(w.snow) ? w.snow : 0), 0);
      const gustNow = Math.max(...S.keys.filter(k => k >= nowKey && k.startsWith(today)).map(k => S.hourly[k].gust).filter(W.num), 0);
      const msgs = [];
      if (newType) msgs.push(`${W.TYPE_LABEL[newType.type]} now expected ${W.winTime(newType, today)}${W.windowAmt(newType) ? ` (${W.windowAmt(newType)})` : ""}.`);
      if (snowNow >= 2 && snowNow >= dayState.snow + 1.5) msgs.push(`Snow totals up to ${W.snowIn(snowNow)} now expected.`);
      if (gustNow >= 45 && gustNow >= dayState.gust + 8) msgs.push(`Gusts to ${W.r0(gustNow)} mph expected later today.`);
      if (msgs.length) {
        await send({
          title: `Forecast update for ${short}`,
          message: msgs.join("\n"),
          tags: [newType ? TAG[newType.type] : snowNow >= 2 ? "snowflake" : "dash", "warning"],
          priority: 4,
        });
        if (newType) dayState.types.push(newType.type);
        dayState.snow = Math.max(dayState.snow, snowNow);
        dayState.gust = Math.max(dayState.gust, gustNow);
        sent.push("update");
      }
    }
  }
  console.log(`local ${nowKey}: ${sent.length ? "sent " + sent.join(", ") : "nothing to send"}`);
}
saveState(state);
