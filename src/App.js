import { useState, useEffect, useRef, Fragment } from "react";
import { ref, onValue, set, update } from "firebase/database";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { db, auth } from "./firebase";
import { BRACKET_CONFIG, GAME_OPTIONS, MAX_POINTS, PLAY_IN_CONFIG, PLAY_IN_SLOTS } from "./bracketConfig";
import { buildLeaderboard, calcPoints, maxPossible, getEliminatedTeams } from "./scoring";
import { TeamLogo } from "./teamLogos";

// ─── Seed lookup (team name → playoff seed) built from R1 config ─────────────
const TEAM_SEEDS = {};
BRACKET_CONFIG.rounds[0].series.forEach(s => {
  if (s.topSeed    != null) TEAM_SEEDS[s.top]    = s.topSeed;
  if (s.bottomSeed != null) TEAM_SEEDS[s.bottom] = s.bottomSeed;
});
// Also register Play-In teams (seeds 9/10) so they render as real teams
// in the bracket when a participant's play-in picks place them in an R1 slot.
Object.values(PLAY_IN_CONFIG).forEach(conf => {
  TEAM_SEEDS[conf.seed9]  = 9;
  TEAM_SEEDS[conf.seed10] = 10;
});

// Return a mapping of team -> seed for display, taking into account any
// confirmed/predicted play-in winners. If `playInSeeds` is provided it will
// override the #9/#10 mapping and assign the promoted teams to #7 or #8.
function computeDisplaySeeds(playInSeeds) {
  const display = { ...TEAM_SEEDS };
  if (!playInSeeds) return display;
  // playInSeeds keys: E7, E8, W7, W8 -> team names (or null)
  ["E7","E8","W7","W8"].forEach(k => {
    const t = playInSeeds[k];
    if (!t) return;
    const seedNum = k.endsWith("7") ? 7 : 8;
    display[t] = seedNum; // override any existing 9/10 mapping
  });
  return display;
}

// Helper: return a seed string/number for a team, preferring any play-in
// overrides. Returns empty string when no seed known.
function seedFor(team, playInSeeds) {
  if (!team) return "";
  const display = computeDisplaySeeds(playInSeeds);
  return display[team] ?? "";
}

// ─── Play-In helpers ──────────────────────────────────────────────────────────

// Given a participant's play-in picks + admin results, returns the effective
// #7/#8 seeds for East and West.  Admin results override participant picks.
// Returns null for any seed not yet determined.
function resolveEffectiveSeeds(participantPicks, adminResults) {
  const eff = {};
  ["piE1","piE2","piE3","piW1","piW2","piW3"].forEach(k => {
    eff[k] = adminResults?.[k] || participantPicks?.[k] || null;
  });
  const out = {
    E7: eff.piE1 || null,
    E8: eff.piE3 || null,
    W7: eff.piW1 || null,
    W8: eff.piW3 || null,
  };
  // Warn if admin/participant data produced identical teams for 7 & 8 seeds
  if (out.E7 && out.E8 && out.E7 === out.E8) {
    console.warn("resolveEffectiveSeeds: East seeds 7 and 8 are the same team", out.E7);
  }
  if (out.W7 && out.W8 && out.W7 === out.W8) {
    console.warn("resolveEffectiveSeeds: West seeds 7 and 8 are the same team", out.W7);
  }
  return out;
}

// Applies play-in seed overrides to an R1 series.
// Returns the series unchanged if it's not one of the four play-in slots.
// "Play-In TBD" is inserted for any slot not yet determined.
const PI_SLOT_MAP = { s1:"E8", s2:"E7", s5:"W8", s6:"W7" };
function applyPlayInPatch(series, playInSeeds) {
  if (!playInSeeds) return series;
  const seedKey = PI_SLOT_MAP[series.id];
  if (!seedKey) return series;
  const team = playInSeeds[seedKey];
  return { ...series, bottom: team || "Play-In TBD" };
}

// Returns the two teams that will face off in Play-In Game 3 for a conference,
// derived from the winners/losers of Games 1 and 2.
function getGame3Teams(conf, picks, adminResults) {
  const cfg = PLAY_IN_CONFIG[conf];
  const prefix = conf === "East" ? "piE" : "piW";
  const g1Winner = adminResults?.[`${prefix}1`] || picks?.[`${prefix}1`] || null;
  const g2Winner = adminResults?.[`${prefix}2`] || picks?.[`${prefix}2`] || null;
  const g1Loser = g1Winner === cfg.seed7 ? cfg.seed8
                : g1Winner === cfg.seed8 ? cfg.seed7 : null;
  return {
    top:    g1Loser   || null,
    bottom: g2Winner  || null,
    ready:  !!(g1Loser && g2Winner),
  };
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#080c12; --surface:#0e1420; --surface2:#141b28; --surface3:#1b2435;
    --border:#1e2a3a; --border2:#243040; --gold:#c9a84c; --gold2:#f0c65a;
    --amber:#e8943a; --cyan:#2dd4bf; --red:#ef4444; --green:#22c55e;
    --text:#e8edf5; --text2:#b0bfd0; --text3:#728499;
  }
  body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; }
  .app { max-width:1380px; margin:0 auto; padding:0 16px 80px; }

  /* Header */
  .hdr { padding:28px 0 0; display:flex; align-items:flex-end; justify-content:space-between; }
  .hdr-title { font-family:'Bebas Neue',sans-serif; font-size:2.8rem; letter-spacing:3px; line-height:1; }
  .hdr-title span { color:var(--gold); }
  .hdr-sub { font-size:0.68rem; letter-spacing:3px; color:var(--text2); text-transform:uppercase; margin-top:4px; }
  .live-dot { width:7px; height:7px; border-radius:50%; background:var(--green); display:inline-block; margin-right:6px; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }


  /* Gold tint on native date/time picker icons */
  input[type="date"]::-webkit-calendar-picker-indicator,
  input[type="time"]::-webkit-calendar-picker-indicator {
    filter: invert(1) sepia(1) saturate(3) hue-rotate(358deg) brightness(0.85);
    cursor: pointer; opacity: 0.9;
  }
  /* Hide native Edge password reveal so our custom toggle is the only one */
  input[type="password"]::-ms-reveal { display: none; }
  /* Custom password eye toggle */
  .pw-wrap { position:relative; flex:1; }
  .pw-wrap input { width:100%; padding-right:36px; }
  .pw-eye { position:absolute; right:8px; top:50%; transform:translateY(-50%);
    background:none; border:none; cursor:pointer; padding:2px; line-height:1;
    color:var(--gold); opacity:0.8; transition:opacity 0.15s; }
  .pw-eye:hover { opacity:1; }

  /* ── Pool Stats: Selection Breakdown table ───────────────────────── */
  .sbt-wrap { overflow-x:auto; margin-bottom:28px; }
  .sbt { width:100%; border-collapse:collapse; font-size:0.72rem; }
  .sbt thead th { background:var(--surface3); color:var(--gold); font-family:'Bebas Neue',sans-serif;
    letter-spacing:1.5px; padding:7px 10px; border:1px solid var(--border2);
    text-align:center; white-space:nowrap; }
  .sbt thead th.sbt-lh { text-align:left; }
  .sbt tbody td { padding:5px 9px; border:1px solid var(--border); color:var(--text);
    background:var(--surface2); vertical-align:middle; }
  .sbt tbody tr:hover td { background:var(--surface3); }
  .sbt-conf-cell { writing-mode:vertical-rl; transform:rotate(180deg);
    font-family:'Bebas Neue',sans-serif; letter-spacing:3px; font-size:0.82rem;
    text-align:center; padding:0 8px !important; white-space:nowrap; }
  .sbt-conf-West { color:#fb923c !important; background:rgba(194,65,12,0.1) !important; }
  .sbt-conf-East { color:#7b9ff5 !important; background:rgba(59,91,219,0.1) !important; }
  .sbt-sep { border-top:2px solid var(--border2) !important; }
  .sbt-seed { text-align:center !important; color:var(--text3) !important;
    font-family:'JetBrains Mono',monospace; font-size:0.65rem; width:32px; }
  .sbt-num { text-align:right !important; color:var(--text2) !important;
    font-family:'JetBrains Mono',monospace; width:28px; padding-right:8px !important; }
  .sbt-pct-cell { min-width:115px; }
  .sbt-bar { height:14px; background:var(--surface); border-radius:2px; overflow:hidden; flex:1; min-width:30px; }
  .sbt-fill-West { height:100%; background:rgba(215,105,50,0.55); border-radius:2px; transition:width 0.4s; }
  .sbt-fill-East { height:100%; background:rgba(80,125,215,0.55); border-radius:2px; transition:width 0.4s; }
  .sbt-pct-num { font-family:'JetBrains Mono',monospace; font-size:0.64rem; color:var(--text2);
    min-width:40px; text-align:right; white-space:nowrap; }

  /* ── Play-In Tournament ─────────────────────────────────────────────── */
  .pi-banner { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;
    gap:10px; padding:10px 14px; border-radius:6px; margin-bottom:14px; }
  .pi-banner-incomplete { background:rgba(201,168,76,0.07); border:1px solid rgba(201,168,76,0.28); }
  .pi-banner-complete   { background:rgba(34,197,94,0.07);  border:1px solid rgba(34,197,94,0.3); }
  .pi-banner-admin      { background:rgba(45,212,191,0.07); border:1px solid rgba(45,212,191,0.25); }
  .pi-banner-title { font-family:'Bebas Neue',sans-serif; font-size:0.85rem; letter-spacing:2px; }
  .pi-banner-sub { font-size:0.7rem; color:var(--text3); margin-top:2px; }

  .pi-conf-label { font-family:'Bebas Neue',sans-serif; font-size:0.82rem; letter-spacing:3px;
    text-transform:uppercase; display:flex; align-items:center; gap:10px; margin:16px 0 10px; }
  .pi-conf-label::after { content:''; flex:1; height:1px; background:var(--border); }
  .pi-conf-East  { color:rgba(123,159,245,0.85); }
  .pi-conf-West  { color:rgba(251,146,60,0.85); }

  .pi-game { background:var(--surface2); border:1px solid var(--border); border-radius:8px;
    padding:11px 13px; margin-bottom:10px; }
  .pi-game-locked { opacity:0.4; pointer-events:none; }
  .pi-game-hdr { display:flex; align-items:center; gap:10px; margin-bottom:9px; }
  .pi-game-num { font-family:'Bebas Neue',sans-serif; font-size:0.75rem; letter-spacing:2px;
    color:var(--gold); background:rgba(201,168,76,0.12); border:1px solid rgba(201,168,76,0.25);
    border-radius:3px; padding:1px 7px; }
  .pi-game-desc { font-size:0.65rem; color:var(--text3); letter-spacing:0.5px; }
  .pi-game-settled { font-size:0.65rem; color:var(--green); font-family:'JetBrains Mono',monospace;
    margin-left:auto; }

  .pi-matchup { display:grid; grid-template-columns:1fr auto 1fr; gap:8px; align-items:center; }
  .pi-vs { font-size:0.65rem; color:var(--text3); text-align:center; font-weight:700; }

  .pi-team { display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px 6px 12px;
    background:var(--surface3); border:1px solid var(--border2); border-radius:7px; cursor:pointer;
    transition:all 0.15s; position:relative; }
  .pi-team:hover:not(:disabled) { border-color:var(--gold); }
  .pi-team:disabled { cursor:default; }
  .pi-team.pi-sel   { background:rgba(201,168,76,0.1); border-color:var(--gold); }
  .pi-team.pi-ok    { background:rgba(34,197,94,0.1);  border-color:var(--green); }
  .pi-team.pi-wrong { background:rgba(239,68,68,0.05); border-color:rgba(239,68,68,0.2);
    opacity:0.55; }
  .pi-team.pi-tbd-slot { pointer-events:none; opacity:0.3; min-height:70px;
    justify-content:center; border-style:dashed; }
  .pi-team-name { font-size:0.68rem; font-weight:600; text-align:center; line-height:1.2;
    color:var(--text2); max-width:80px; word-break:break-word; }
  .pi-team.pi-sel   .pi-team-name { color:var(--gold2); }
  .pi-team.pi-ok    .pi-team-name { color:var(--green); }
  .pi-seed { position:absolute; bottom:4px; right:6px; font-size:0.58rem;
    font-family:'JetBrains Mono',monospace; font-weight:800; color:var(--text3); opacity:0.6; }
  .pi-team.pi-sel  .pi-seed { color:var(--gold2); opacity:1; }
  .pi-team.pi-ok   .pi-seed { color:var(--green); opacity:1; }
  .pi-tbd-label { font-size:0.6rem; color:var(--text3); letter-spacing:0.5px; }

  /* Play-In TBD slot inside bracket matchup card */
  .bm-team-pi-tbd { justify-content:center; gap:4px; min-height:42px;
    border-style:dashed !important; border-color:rgba(201,168,76,0.3) !important;
    background:rgba(201,168,76,0.04) !important; cursor:pointer !important; }
  .bm-team-pi-tbd:hover { border-color:rgba(201,168,76,0.65) !important;
    background:rgba(201,168,76,0.1) !important; }
  .bm-team-pi-tbd-text { font-size:0.6rem; color:var(--gold); letter-spacing:0.8px;
    font-weight:700; opacity:0.7; }
  .bm-team-pi-tbd:hover .bm-team-pi-tbd-text { opacity:1; }

  /* Tabs */
  .tabs { display:flex; border-bottom:1px solid var(--border); margin:20px 0 28px; }
  .tab { padding:13px 22px; font-size:0.75rem; letter-spacing:2px; text-transform:uppercase; font-weight:600;
    color:var(--text2); cursor:pointer; border:none; background:none; border-bottom:2px solid transparent;
    transition:all 0.2s; position:relative; top:1px; }
  .tab:hover { color:var(--text); }
  .tab.active { color:var(--gold); border-bottom-color:var(--gold); }

  /* Entry toggle (dual-entry pick switcher) */
  .entry-toggle { display:flex; gap:0; margin-bottom:18px; border:1px solid var(--border);
    border-radius:8px; overflow:hidden; width:fit-content; }
  .entry-btn { padding:11px 34px; min-width:155px; text-align:center; background:transparent; border:none; cursor:pointer;
    color:var(--text2); font-size:0.82rem; font-weight:700; letter-spacing:1px;
    font-family:'Bebas Neue',sans-serif; transition:all 0.15s; white-space:nowrap; }
  .entry-btn:not(:last-child) { border-right:1px solid var(--border); }
  .entry-btn.active { background:var(--gold); color:#111; }
  .entry-btn .entry-check { margin-left:5px; font-size:0.65rem; }
  .entry-btn.active .entry-check { color:#111; }
  .entry-btn:disabled { opacity:0.45; cursor:default; }

  /* Legend */
  .legend { display:flex; gap:20px; flex-wrap:wrap; padding:11px 16px; background:var(--surface2);
    border:1px solid var(--border); border-radius:6px; margin-bottom:22px; }
  .legend span { font-size:0.75rem; color:var(--text2); }
  .legend strong { color:var(--gold); font-family:'JetBrains Mono',monospace; }

  /* Section label */
  .sec { font-family:'Bebas Neue',sans-serif; font-size:0.92rem; letter-spacing:3px; color:var(--text2);
    text-transform:uppercase; margin:24px 0 10px; display:flex; align-items:center; gap:10px; }
  .sec::after { content:''; flex:1; height:1px; background:var(--border); }

  /* Series grid */
  .series-grid { display:grid; gap:9px; }

  /* Series card */
  .sc { background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:13px 15px; transition:border-color 0.2s; }
  .sc:hover { border-color:var(--border2); }
  .sc.done { /* left border color set via inline style per conference */ }
  .sc-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
  .conf { font-size:0.6rem; letter-spacing:2px; padding:2px 7px; border-radius:2px; font-weight:700; text-transform:uppercase; }
  .conf-East  { background:rgba(59,91,219,0.15); color:#7b9ff5; border:1px solid rgba(59,91,219,0.3); }
  .conf-West  { background:rgba(194,65,12,0.15); color:#fb923c; border:1px solid rgba(194,65,12,0.3); }
  .conf-Finals{ background:rgba(201,168,76,0.15); color:var(--gold2); border:1px solid rgba(201,168,76,0.3); }
  .mult { font-size:0.63rem; color:var(--text3); font-family:'JetBrains Mono',monospace; }

  /* Teams */
  .teams { display:grid; grid-template-columns:1fr auto 1fr; gap:8px; align-items:center; margin-bottom:10px; }
  .tbtn { padding:14px 8px 18px; background:var(--surface3); border:1px solid var(--border2); border-radius:8px;
    color:var(--text2); cursor:pointer; transition:all 0.18s; text-align:center; font-weight:500;
    display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; position:relative; }
  .tbtn:hover:not(:disabled) { border-color:var(--gold); color:var(--gold); }
  .tbtn:hover:not(:disabled) .tbtn-logo { filter:drop-shadow(0 0 7px rgba(201,168,76,0.45)); }
  .tbtn.sel   { background:rgba(201,168,76,0.1); border-color:var(--gold); color:var(--gold2); }
  .tbtn.sel   .tbtn-logo { filter:drop-shadow(0 0 8px rgba(240,198,90,0.55)); }
  .tbtn.ok    { background:rgba(34,197,94,0.1); border-color:var(--green); color:var(--green); }
  .tbtn.ok    .tbtn-logo { filter:drop-shadow(0 0 8px rgba(34,197,94,0.5)); }
  .tbtn.wrong { background:rgba(239,68,68,0.05); border-color:rgba(239,68,68,0.18); color:var(--text3); }
  .tbtn.wrong .tbtn-logo { opacity:0.45; filter:grayscale(0.6); }
  .tbtn-logo  { transition:filter 0.18s, opacity 0.18s; flex-shrink:0; }
  .tbtn-name  { font-size:0.72rem; line-height:1.3; font-weight:600; letter-spacing:0.2px; }
  .tbtn:disabled { cursor:default; }
  .vs { color:var(--text3); font-size:0.68rem; text-align:center; font-weight:700; letter-spacing:1px; }

  /* Seed matchup badge (next to conf label) */
  .seed-vs { font-size:0.58rem; font-family:'JetBrains Mono',monospace; font-weight:700; letter-spacing:1.5px;
    padding:2px 7px; border-radius:2px; border:1px solid var(--border); background:rgba(255,255,255,0.02);
    color:var(--text3); white-space:nowrap; }
  .seed-vs-East { color:rgba(123,159,245,0.9); text-shadow:0 0 10px rgba(123,159,245,0.3); border-color:rgba(59,91,219,0.25); }
  .seed-vs-West { color:rgba(251,146,60,0.9);  text-shadow:0 0 10px rgba(251,146,60,0.3);  border-color:rgba(194,65,12,0.25); }
  .seed-vs-Finals { color:rgba(240,198,90,0.85); text-shadow:0 0 10px rgba(240,198,90,0.3); border-color:rgba(201,168,76,0.25); }

  /* Seed badge (bottom-right of team button) */
  .tbtn-seed { position:absolute; bottom:6px; right:8px; font-size:0.6rem; font-family:'JetBrains Mono',monospace;
    font-weight:800; color:var(--text3); line-height:1; opacity:0.55;
    transition:color 0.18s, opacity 0.18s, text-shadow 0.18s; letter-spacing:0; }
  .tbtn.sel   .tbtn-seed { color:var(--gold2); opacity:1; text-shadow:0 0 8px rgba(240,198,90,0.45); }
  .tbtn.ok    .tbtn-seed { color:var(--green); opacity:1; text-shadow:0 0 8px rgba(34,197,94,0.45); }
  .tbtn.wrong .tbtn-seed { opacity:0.2; }
  .tbtn:hover:not(:disabled) .tbtn-seed { color:var(--gold); opacity:1; }

  /* Games row */
  .gr { display:flex; gap:5px; align-items:center; }
  .gl { font-size:0.68rem; color:var(--text3); letter-spacing:1px; margin-right:3px; }
  .gbtn { width:34px; height:27px; background:var(--surface3); border:1px solid var(--border2); border-radius:3px;
    color:var(--text2); font-size:0.78rem; cursor:pointer; transition:all 0.15s; font-family:'JetBrains Mono',monospace; }
  .gbtn:hover { border-color:var(--gold); color:var(--gold); }
  .gbtn.sel  { background:rgba(201,168,76,0.12); border-color:var(--gold); color:var(--gold2); font-weight:600; }
  .gbtn.exact{ background:rgba(34,197,94,0.15); border-color:var(--green); color:var(--green); }
  .gbtn:disabled { cursor:default; }
  .ps { font-size:0.65rem; margin-left:auto; font-family:'JetBrains Mono',monospace; }
  .ps.ok { color:var(--cyan); }
  .ps.pending { color:var(--text3); }

  /* Form */
  .form { max-width:640px; background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:22px; }
  .fl { font-size:0.7rem; letter-spacing:2px; color:var(--text3); text-transform:uppercase; margin-bottom:6px; display:block; }
  .fi { width:100%; padding:10px 13px; background:var(--surface2); border:1px solid var(--border2);
    border-radius:4px; color:var(--text); font-size:0.88rem; font-family:'DM Sans',sans-serif; outline:none; transition:border-color 0.2s; }
  .fi:focus { border-color:var(--gold); }
  .fi::placeholder { color:var(--text3); }
  .g2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px; }
  @media(max-width:540px){ .g2{grid-template-columns:1fr;} }

  /* Buttons */
  .btn { padding:11px 22px; border:none; border-radius:4px; cursor:pointer; font-weight:700;
    font-size:0.8rem; letter-spacing:1.5px; text-transform:uppercase; transition:all 0.2s; font-family:'DM Sans',sans-serif; }
  .btn-gold { background:linear-gradient(135deg,var(--gold),var(--amber)); color:#080c12; }
  .btn-gold:hover { filter:brightness(1.1); transform:translateY(-1px); }
  .btn-ghost { background:transparent; border:1px solid var(--border2); color:var(--text2); }
  .btn-ghost:hover { border-color:var(--gold); color:var(--gold); }
  .btn-danger { background:transparent; border:1px solid rgba(239,68,68,0.3); color:var(--red); }
  .btn-danger:hover { background:rgba(239,68,68,0.1); }
  .btn:disabled { opacity:0.35; cursor:not-allowed; transform:none !important; filter:none !important; }

  /* Leaderboard */
  .lb { display:grid; gap:8px; }
  .lbr { display:grid; grid-template-columns:36px 1fr auto auto auto auto; gap:10px; align-items:center;
    background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:12px 16px; transition:border-color 0.2s; }
  .lbr:hover { border-color:var(--border2); }
  .lbr.me { border-color:rgba(148,163,184,0.7) !important; background:rgba(148,163,184,0.06); }
  .rank { font-family:'Bebas Neue',sans-serif; font-size:1.35rem; color:var(--text3); }
  .me .rank { color:#b4c4d4; }
  .lbn { font-weight:600; font-size:0.88rem; }
  .lbn-you { font-size:0.68rem; color:#94a3b8; font-weight:500; letter-spacing:0.3px; margin-left:5px; }
  .pb { height:3px; background:var(--border); border-radius:2px; margin-top:5px; overflow:hidden; }
  .pbf { height:100%; background:linear-gradient(90deg,var(--gold),var(--amber)); border-radius:2px; transition:width 0.6s; }
  .lbr.me .pbf { background:linear-gradient(90deg,#8fa8bc,#b4c4d4); }
  .pts { font-family:'Bebas Neue',sans-serif; font-size:1.5rem; color:var(--gold); line-height:1; }
  .ptsl { font-size:0.6rem; color:var(--text3); letter-spacing:1px; }
  .lbmeta { font-size:0.7rem; color:var(--text3); text-align:right; line-height:1.7; }
  .lb-stat { text-align:center; padding:0 6px; }
  .lb-stat-val { font-family:'Bebas Neue',sans-serif; font-size:1.75rem; line-height:1; }
  .lb-stat-lbl { font-size:0.52rem; color:var(--text3); letter-spacing:1.5px; text-transform:uppercase; margin-top:2px; white-space:nowrap; }
  .lbr-finals { display:flex; flex-direction:column; align-items:center; gap:3px; padding:0 4px; }
  .lbr-finals-lbl { font-size:0.52rem; letter-spacing:1.5px; color:var(--text3); text-transform:uppercase;
    font-family:'JetBrains Mono',monospace; white-space:nowrap; }
  .lbr-finals-team { font-size:0.7rem; font-weight:700; color:var(--gold2); text-align:center;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:90px; }

  /* Stats */
  .sg { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; margin-bottom:22px; }
  .sc2 { background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:16px; }
  .sv { font-family:'Bebas Neue',sans-serif; font-size:2.1rem; color:var(--gold); line-height:1; }
  .sl { font-size:0.68rem; color:var(--text3); letter-spacing:2px; text-transform:uppercase; margin-top:4px; }
  .pr { display:grid; grid-template-columns:1fr 80px auto; gap:10px; align-items:center;
    padding:9px 13px; background:var(--surface2); border:1px solid var(--border); border-radius:4px; font-size:0.8rem; margin-bottom:6px; }
  .pbw { height:4px; background:var(--border); border-radius:2px; }
  .pbi { height:100%; background:var(--cyan); border-radius:2px; }
  .pct { font-family:'JetBrains Mono',monospace; color:var(--cyan); font-size:0.75rem; }

  /* Picks lock banner */
  .alert-locked { background:rgba(239,68,68,0.07); border:1px solid rgba(239,68,68,0.35); color:var(--red); }

  /* Clickable leaderboard rows */
  .lbr.clickable { cursor:pointer; }
  .lbr.clickable:hover { border-color:var(--gold) !important; background:rgba(201,168,76,0.05); }
  .lbr-view { font-size:0.6rem; letter-spacing:1.5px; color:var(--text3); text-transform:uppercase;
    font-family:'JetBrains Mono',monospace; margin-top:4px; transition:color 0.15s; }
  .lbr.clickable:hover .lbr-view { color:var(--gold); }

  /* Picks overlay */
  .ov-backdrop { position:fixed; inset:0; background:rgba(4,7,13,0.88); z-index:200;
    display:flex; align-items:flex-start; justify-content:center;
    padding:32px 16px 48px; overflow-y:auto; backdrop-filter:blur(4px);
    animation:ov-fade 0.2s ease; }
  @keyframes ov-fade { from{opacity:0} to{opacity:1} }
  .ov-modal { background:var(--surface); border:1px solid var(--border2); border-radius:12px;
    width:100%; max-width:720px; display:flex; flex-direction:column;
    animation:ov-rise 0.25s ease; flex-shrink:0; }
  @keyframes ov-rise { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
  .ov-hdr { display:flex; align-items:center; justify-content:space-between; gap:16px;
    padding:20px 22px; border-bottom:1px solid var(--border); }
  .ov-hdr-left { min-width:0; }
  .ov-title { font-family:'Bebas Neue',sans-serif; font-size:1.5rem; letter-spacing:3px;
    color:var(--text); line-height:1; }
  .ov-sub { font-size:0.68rem; color:var(--text3); letter-spacing:1.5px; margin-top:5px; text-transform:uppercase; }
  .ov-close { width:34px; height:34px; flex-shrink:0; background:var(--surface2);
    border:1px solid var(--border2); border-radius:7px; color:var(--text2);
    cursor:pointer; font-size:1.1rem; display:flex; align-items:center; justify-content:center;
    transition:all 0.15s; line-height:1; }
  .ov-close:hover { border-color:var(--gold); color:var(--gold); }
  .ov-body { padding:20px 22px 28px; }
  .ov-score-row { display:flex; gap:20px; flex-wrap:wrap; padding:12px 16px;
    background:var(--surface2); border:1px solid var(--border); border-radius:6px; margin-bottom:20px; }
  .ov-score-item { text-align:center; }
  .ov-score-val { font-family:'Bebas Neue',sans-serif; font-size:1.6rem; color:var(--gold); line-height:1; }
  .ov-score-lbl { font-size:0.6rem; color:var(--text3); letter-spacing:1.5px; text-transform:uppercase; margin-top:2px; }

  /* Lock toggle card (admin) */
  .lock-card { display:flex; align-items:center; justify-content:space-between; gap:16px;
    padding:16px 20px; border-radius:8px; margin-bottom:20px; border:1px solid; transition:all 0.3s; }
  .lock-card.unlocked { background:rgba(34,197,94,0.05); border-color:rgba(34,197,94,0.3); }
  .lock-card.locked   { background:rgba(239,68,68,0.06); border-color:rgba(239,68,68,0.35); }
  .lock-info { flex:1; min-width:0; }
  .lock-title { font-family:'Bebas Neue',sans-serif; font-size:1rem; letter-spacing:2px; }
  .lock-card.unlocked .lock-title { color:var(--green); }
  .lock-card.locked   .lock-title { color:var(--red); }
  .lock-desc { font-size:0.7rem; color:var(--text3); margin-top:3px; letter-spacing:0.5px; }
  .toggle-wrap { display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .toggle-lbl { font-size:0.65rem; letter-spacing:1.5px; color:var(--text3); text-transform:uppercase; font-family:'JetBrains Mono',monospace; }
  .toggle { position:relative; display:inline-block; width:50px; height:27px; cursor:pointer; flex-shrink:0; }
  .toggle input { opacity:0; width:0; height:0; position:absolute; }
  .toggle-track { position:absolute; inset:0; background:var(--surface3); border:1px solid var(--border2); border-radius:14px; transition:all 0.25s; }
  .toggle input:checked + .toggle-track { background:rgba(239,68,68,0.22); border-color:rgba(239,68,68,0.55); }
  .toggle-thumb { position:absolute; top:3px; left:3px; width:19px; height:19px; background:var(--text3); border-radius:50%; transition:all 0.25s; box-shadow:0 1px 4px rgba(0,0,0,0.4); }
  .toggle input:checked ~ .toggle-thumb { transform:translateX(23px); background:var(--red); box-shadow:0 0 8px rgba(239,68,68,0.5); }

  /* Admin gate */
  .admin-gate { max-width:360px; margin:60px auto 0; background:var(--surface); border:1px solid var(--border);
    border-radius:10px; padding:36px 28px; text-align:center; }
  .admin-gate-icon { font-size:2.2rem; margin-bottom:14px; line-height:1; }
  .admin-gate-title { font-family:'Bebas Neue',sans-serif; font-size:1.5rem; letter-spacing:3px;
    color:var(--text); margin-bottom:6px; }
  .admin-gate-sub { font-size:0.72rem; color:var(--text3); letter-spacing:1px; margin-bottom:24px; }
  .admin-gate-row { display:flex; gap:8px; }
  .admin-gate-err { font-size:0.72rem; color:var(--red); margin-top:10px; letter-spacing:0.5px; min-height:18px; }

  /* Admin */
  .asc { background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:14px 16px; margin-bottom:8px; }
  .arow { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px; }
  .al { font-size:0.7rem; color:var(--text3); letter-spacing:1px; min-width:70px; }
  .sel { padding:7px 11px; background:var(--surface3); border:1px solid var(--border2);
    border-radius:4px; color:var(--text); font-size:0.83rem; font-family:'DM Sans',sans-serif; cursor:pointer; outline:none; }
  .sel:focus { border-color:var(--gold); }

  /* Alerts */
  .alert { padding:10px 14px; border-radius:4px; font-size:0.8rem; margin-bottom:16px; }
  .alert-warn { background:rgba(201,168,76,0.08); border:1px solid rgba(201,168,76,0.3); color:var(--gold); }
  .alert-info { background:rgba(45,212,191,0.06); border:1px solid rgba(45,212,191,0.25); color:var(--cyan); }
  .alert-success { background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.3); color:var(--green); }

  /* Toast */
  .toast { position:fixed; bottom:24px; right:24px; background:var(--surface3); border:1px solid var(--green);
    color:var(--green); padding:11px 18px; border-radius:6px; font-size:0.8rem; font-weight:600;
    letter-spacing:1px; animation:su 0.3s ease; z-index:1000; }
  @keyframes su { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

  /* Misc */
  .empty { text-align:center; padding:44px 20px; color:var(--text3); }
  .empty h3 { font-family:'Bebas Neue',sans-serif; font-size:1.4rem; letter-spacing:2px; color:var(--text2); margin-bottom:8px; }
  .row { display:flex; align-items:center; }
  .between { justify-content:space-between; }
  .wrap { flex-wrap:wrap; }
  .gap8 { gap:8px; }
  .gap14 { gap:14px; }
  .mb8 { margin-bottom:8px; }
  .mb16 { margin-bottom:16px; }
  .mt8 { margin-top:8px; }
  .mt16 { margin-top:16px; }
  .xs { font-size:0.7rem; }
  .sm { font-size:0.8rem; }
  .muted { color:var(--text3); }
  .gold { color:var(--gold); }
  .green { color:var(--green); }
  .cyan { color:var(--cyan); }
  .mono { font-family:'JetBrains Mono',monospace; }
  .loader { text-align:center; padding:60px 20px; color:var(--text3); font-family:'Bebas Neue',sans-serif;
    font-size:1.2rem; letter-spacing:3px; animation:pulse 1.5s infinite; }

  /* ─── Vertical Bracket Layout ────────────────────────────────────────────── */
  /* The bracket is a horizontal grid per conference block.
     Each conference = [R1 col] [connector] [R2 col] [connector] [CF col] [connector] [Finals col]
     Conferences stack vertically with a gap between them. */

  .bracket-outer { display:flex; flex-direction:column; gap:40px; padding:8px 0 20px; overflow-x:auto; }
  .bracket-outer::-webkit-scrollbar { height:6px; }
  .bracket-outer::-webkit-scrollbar-track { background:var(--surface); }
  .bracket-outer::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }

  /* Conference section label */
  .brk-conf-label { font-family:'Bebas Neue',sans-serif; font-size:0.85rem; letter-spacing:3px;
    color:var(--text2); text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:10px; }
  .brk-conf-label::after { content:''; flex:1; height:1px; background:var(--border); }

  /* One conference bracket row: columns for rounds + connectors */
  .brk-conf { display:grid; min-width:860px;
    grid-template-columns: 220px 36px 220px 36px 220px 36px 220px;
    align-items:stretch; gap:0; }

  /* Round header above each column */
  .brk-round-hdr { font-family:'Bebas Neue',sans-serif; font-size:0.85rem; letter-spacing:2.5px;
    color:var(--text); text-transform:uppercase; text-align:center; padding:0 0 8px;
    white-space:nowrap; }
  .brk-hdr-pts { display:block; font-family:'JetBrains Mono',monospace; font-size:0.68rem; letter-spacing:1px;
    color:var(--gold2); margin-top:2px; font-weight:600; }

  /* Round column: stacks matchup cells vertically */
  .brk-round-col { display:flex; flex-direction:column; gap:0; }

  /* Each matchup slot — flex child in the round column */
  .brk-slot { display:flex; align-items:center; justify-content:flex-start; }

  /* Connector column between rounds */
  .brk-conn-col { position:relative; display:flex; flex-direction:column; }

  /* Each connector cell spans the combined height of two source slots */
  .brk-conn-cell { position:relative; flex:1; }

  /* The actual connector lines inside a cell */
  .brk-conn-cell::before,
  .brk-conn-cell::after { content:''; position:absolute; border-color:var(--border2); border-style:solid; border-width:0; }
  /* Top arm: from center of top source card down to mid-point */
  .brk-conn-cell::before { left:0; right:50%; top:25%; bottom:50%; border-left-width:1px; border-top-width:1px; }
  /* Bottom arm: from mid-point up to center of bottom source card */
  .brk-conn-cell::after  { left:0; right:50%; top:50%; bottom:25%; border-left-width:1px; border-bottom-width:1px; }
  /* Horizontal out-line from midpoint to next column */
  .brk-conn-cell .brk-conn-out { position:absolute; top:calc(50% - 0.5px); height:1px;
    left:50%; right:0; background:var(--border2); }


  /* ─── Bracket Matchup Card ───────────────────────────────────────────────── */
  .bm { width:100%; background:var(--surface2); border:1px solid var(--border); border-radius:8px;
    overflow:hidden; transition:border-color 0.2s; flex-shrink:0; }
  .bm:hover { border-color:var(--border2); }
  .bm.done { /* left border color set via inline style per conference */ }

  .bm-hdr { display:flex; align-items:center; justify-content:space-between; padding:5px 10px;
    background:var(--surface3); border-bottom:1px solid var(--border); }

  /* Ghost picks — eliminated upstream picks shown in the NEXT matchup card */
  /* topGhost appears ABOVE the top team button; bottomGhost BELOW the bottom team, above games */
  .bm-ghost-top { display:flex; align-items:center; gap:6px; padding:4px 10px;
    background:rgba(239,68,68,0.04); border-bottom:1px solid rgba(239,68,68,0.12); }
  .bm-ghost-bottom { display:flex; align-items:center; gap:6px; padding:4px 10px;
    background:rgba(239,68,68,0.04); border-top:1px solid rgba(239,68,68,0.12); }
  .bm-ghost-name { font-size:0.62rem; color:rgba(239,68,68,0.7); text-decoration:line-through;
    font-weight:600; font-family:'JetBrains Mono',monospace; line-height:1.2; }
  .bm-ghost-arrow { font-size:0.52rem; color:var(--text3); letter-spacing:0.2px; white-space:nowrap; }

  /* ─── Info Button & Panel ─────────────────────────────────────────────── */
  .info-btn { display:inline-flex; align-items:center; gap:5px; padding:5px 12px;
    background:rgba(255,255,255,0.03); border:1px solid var(--border2); border-radius:20px;
    color:var(--text3); font-size:0.65rem; letter-spacing:1.2px; text-transform:uppercase;
    font-weight:600; font-family:'DM Sans',sans-serif; cursor:pointer; transition:all 0.2s;
    flex-shrink:0; }
  .info-btn:hover { border-color:var(--gold); color:var(--gold); background:rgba(201,168,76,0.05); }
  .info-btn-icon { font-style:normal; font-size:0.78rem; line-height:1; }

  .info-backdrop { position:fixed; inset:0; background:rgba(4,7,13,0.42); z-index:300;
    display:flex; align-items:flex-start; justify-content:flex-end;
    padding:64px 20px 40px; backdrop-filter:blur(3px); animation:ov-fade 0.18s ease; }
  .info-panel { width:370px; max-height:calc(100vh - 104px); overflow-y:auto;
    background:var(--surface); border:1px solid var(--border2); border-radius:12px;
    box-shadow:0 20px 60px rgba(0,0,0,0.5); animation:ov-rise 0.2s ease; flex-shrink:0; }
  .info-panel::-webkit-scrollbar { width:4px; }
  .info-panel::-webkit-scrollbar-track { background:transparent; }
  .info-panel::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .info-hdr { display:flex; align-items:center; justify-content:space-between;
    padding:14px 18px; border-bottom:1px solid var(--border);
    position:sticky; top:0; background:var(--surface); z-index:1; }
  .info-title { font-family:'Bebas Neue',sans-serif; font-size:1.05rem; letter-spacing:3px; color:var(--text); }
  .info-close { width:28px; height:28px; background:var(--surface2); border:1px solid var(--border2);
    border-radius:6px; color:var(--text2); cursor:pointer; font-size:0.9rem;
    display:flex; align-items:center; justify-content:center; transition:all 0.15s; flex-shrink:0; }
  .info-close:hover { border-color:var(--gold); color:var(--gold); }
  .info-body { padding:14px 18px 20px; }
  .info-section { margin-bottom:16px; }
  .info-section:last-child { margin-bottom:0; }
  .info-sec-title { font-family:'Bebas Neue',sans-serif; font-size:0.7rem; letter-spacing:2.5px;
    color:var(--text3); text-transform:uppercase; margin-bottom:8px; padding-bottom:5px;
    border-bottom:1px solid var(--border); }
  .info-row { display:flex; gap:8px; align-items:flex-start; margin-bottom:6px; }
  .info-row:last-child { margin-bottom:0; }
  .info-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; margin-top:5px; }
  .info-text { font-size:0.77rem; color:var(--text2); line-height:1.55; }
  .info-text strong { color:var(--text); }
  .info-legend-row { display:flex; align-items:center; gap:8px; padding:4px 8px; border-radius:4px;
    background:var(--surface2); margin-bottom:4px; }
  .info-legend-swatch { width:10px; height:10px; border-radius:2px; flex-shrink:0; }
  .info-legend-text { font-size:0.72rem; color:var(--text2); }
  .bm-conf { font-size:0.55rem; letter-spacing:1.5px; font-weight:700; text-transform:uppercase; }
  .bm-conf.East { color:#7b9ff5; }
  .bm-conf.West { color:#fb923c; }
  .bm-conf.Finals { color:var(--gold2); }
  .bm-result { font-size:0.55rem; font-family:'JetBrains Mono',monospace; letter-spacing:0.3px; }

  /* Team button rows */
  .bm-team { display:flex; align-items:center; gap:8px; padding:9px 10px; cursor:pointer;
    border:none; background:none; width:100%; text-align:left; color:var(--text2);
    transition:all 0.15s; border-bottom:1px solid var(--border); position:relative; }
  .bm-team:last-of-type { border-bottom:none; }
  .bm-team:hover:not(:disabled) { background:rgba(201,168,76,0.06); color:var(--gold); }
  .bm-team:disabled { cursor:default; }
  .bm-team-tbd { pointer-events:none; opacity:0.12; min-height:44px; }  /* blank TBD slot — upstream pick not yet made */
  .bm-team.sel   { background:rgba(201,168,76,0.1); color:var(--gold2); }
  .bm-team.ok    { background:rgba(34,197,94,0.1); color:var(--green); }
  .bm-team.wrong { background:rgba(239,68,68,0.11); color:rgba(239,68,68,0.72); text-decoration:line-through; }
  .bm-team.wrong .bm-logo { opacity:0.5; filter:grayscale(0.35) saturate(0.6); }
  /* Loser that you did NOT pick — fade out with strikethrough, not red */
  .bm-team.loser-not-picked { background:transparent; color:rgba(255,255,255,0.2); text-decoration:line-through; }
  .bm-team.loser-not-picked .bm-logo { opacity:0.18; filter:grayscale(1); }
  .bm-team.loser-not-picked .bm-seed { opacity:0.15; }
  /* Actual winner that you did NOT pick (you got the series wrong) — teal highlight */
  .bm-team.winner-missed { background:rgba(45,212,191,0.07); color:rgba(45,212,191,0.65); }
  .bm-team.winner-missed .bm-logo { opacity:0.65; filter:drop-shadow(0 0 4px rgba(45,212,191,0.25)); }
  .bm-team.winner-missed .bm-seed { color:rgba(45,212,191,0.5); opacity:1; }
  .bm-team.sel .bm-logo { filter:drop-shadow(0 0 5px rgba(240,198,90,0.5)); }
  .bm-team.ok  .bm-logo { filter:drop-shadow(0 0 5px rgba(34,197,94,0.4)); }
  .bm-logo { flex-shrink:0; transition:filter 0.15s, opacity 0.15s; }
  .bm-name { font-size:0.75rem; font-weight:600; line-height:1.2; flex:1; min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bm-seed { font-size:0.58rem; font-family:'JetBrains Mono',monospace; font-weight:800;
    color:var(--text3); opacity:0.7; flex-shrink:0; }
  .bm-team.sel .bm-seed { color:var(--gold2); opacity:1; }
  .bm-team.ok  .bm-seed { color:var(--green); opacity:1; }
  .bm-team.wrong .bm-seed { color:rgba(239,68,68,0.55); opacity:1; }

  /* Games row */
  .bm-games { display:flex; align-items:center; gap:4px; padding:7px 10px; background:var(--surface3); }
  .bm-gl { font-size:0.56rem; color:var(--text3); letter-spacing:0.8px; margin-right:3px; }
  .bm-gbtn { width:36px; height:28px; background:var(--surface2); border:1px solid var(--border2); border-radius:4px;
    color:var(--text2); font-size:0.78rem; cursor:pointer; transition:all 0.12s;
    font-family:'JetBrains Mono',monospace; padding:0; font-weight:500; }
  .bm-gbtn:hover:not(:disabled) { border-color:var(--gold); color:var(--gold); }
  .bm-gbtn:disabled { cursor:default; }
  .bm-gbtn.sel        { background:rgba(201,168,76,0.12); border-color:var(--gold); color:var(--gold2); font-weight:600; }
  .bm-gbtn.exact      { background:rgba(34,197,94,0.15); border-color:var(--green); color:var(--green); }
  .bm-gbtn.wrong-games{ background:rgba(239,68,68,0.12); border-color:rgba(239,68,68,0.55); color:rgba(239,68,68,0.8); font-weight:600; }
  .bm-ps { font-size:0.52rem; margin-left:auto; font-family:'JetBrains Mono',monospace; }
  .bm-ps.ok { color:var(--gold2); }
  .bm-ps.pending { color:var(--text3); }

  /* Finals label */
  .brk-finals-label { display:flex; flex-direction:column; align-items:center;
    justify-content:center; padding-bottom:10px; }
  .brk-finals-icon { font-size:1.1rem; line-height:1; margin-bottom:2px; }

  /* ─── Scenario Tab ─────────────────────────────────────────────────────────── */
  .scenario-layout { display:flex; gap:24px; align-items:flex-start; }
  .scenario-lb-col { width:260px; flex-shrink:0; }
  .scenario-bracket-col { flex:1; min-width:0; }
  @media(max-width:860px) {
    .scenario-layout { flex-direction:column; }
    .scenario-lb-col { width:100%; }
  }
  .scenario-lb-row { display:grid; grid-template-columns:24px 1fr auto; align-items:center; gap:8px;
    padding:8px 12px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; }
  .scenario-lb-row + .scenario-lb-row { margin-top:5px; }
  .scenario-lb-row.me { border-color:rgba(201,168,76,0.5); background:rgba(201,168,76,0.04); }
  .scenario-rank { font-family:'Bebas Neue',sans-serif; font-size:1.05rem; color:var(--text3); }
  .scenario-lb-row.me .scenario-rank { color:var(--gold2); }
  .scenario-name { font-size:0.8rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .scenario-pts { font-family:'Bebas Neue',sans-serif; font-size:1.25rem; color:var(--gold); text-align:right; }

  /* ─── Print styles ────────────────────────────────────────────────────────── */
  @media print {
    @page { size: A4 landscape; margin: 8mm; }
    .tabs, .hdr, .legend, .form, .alert, .toast,
    .entry-toggle, .sec { display:none !important; }
    .app { padding:0; max-width:100%; }
    body { background:white !important; color:#111 !important; }
    :root { --bg:white; --surface:white; --surface2:#f5f5f5; --surface3:#eee;
      --border:#ccc; --border2:#bbb; --text:#111; --text2:#333; --text3:#666; }
    .bm, .sc { break-inside:avoid; }
    .bracket-print-wrapper { zoom: 0.6; }
  }

`;

// ─── Bracket Resolution ───────────────────────────────────────────────────────
// Maps each later-round series to the two earlier-round series whose winners
// feed into its top/bottom slot. Mirrors the structure in bracketConfig.js.

const FEEDS_FROM = {
  // Conference Semifinals ← First Round winners
  s9:  { top: "s1",  bottom: "s4"  },   // East: (1) vs (4/5)
  s10: { top: "s2",  bottom: "s3"  },   // East: (2) vs (3/6)
  s11: { top: "s5",  bottom: "s8"  },   // West: (1) vs (4/5)
  s12: { top: "s6",  bottom: "s7"  },   // West: (2) vs (3/6)
  // Conference Finals ← Semifinal winners
  s13: { top: "s9",  bottom: "s10" },   // East Final
  s14: { top: "s11", bottom: "s12" },   // West Final
  // NBA Finals ← Conference Final winners
  s15: { top: "s13", bottom: "s14" },
};

// Returns a copy of BRACKET_CONFIG.rounds with placeholder names replaced
// by the actual team names from the participant's current picks.
function resolveBracket(picks) {
  return BRACKET_CONFIG.rounds.map(round => ({
    ...round,
    series: round.series.map(series => {
      const feed = FEEDS_FROM[series.id];
      if (!feed) return series;
      return {
        ...series,
        top:    picks[feed.top]?.winner    || series.top,
        bottom: picks[feed.bottom]?.winner || series.bottom,
      };
    }),
  }));
}

// After any pick change, walks all downstream series and clears picks whose
// chosen team no longer appears in that slot (e.g. the user changed their R1
// pick so R2 now shows a different team). Runs up to 3 passes to cascade all
// the way from R2 → R3 → R4 in one call.
//
// playInSeeds (optional): { E7, E8, W7, W8 } — when provided, the four R1
// play-in slots are patched with the actual/predicted teams before validating,
// so a pick of e.g. "Chicago Bulls" in s1 is valid when CHI is the effective E8.
function cleanDownstreamPicks(picks, basePicks = {}, playInSeeds = null) {
  // First, perform any virtual substitutions for confirmed play-in winners so
  // old teams are replaced by their actual replacements before we start
  // clearing invalid downstream picks.  This allows the value to propagate
  // instead of being wiped out entirely.
  let cleaned = playInSeeds ? virtualSubstitutePicksForPlayIn(picks, playInSeeds) : { ...picks };

  for (let pass = 0; pass < 3; pass++) {
    // Merge admin-settled results (basePicks) so resolveBracket can substitute
    // real team names instead of BRACKET_CONFIG placeholders.
    const resolveSource = { ...basePicks, ...cleaned };
    const resolved = resolveBracket(resolveSource);
    for (const round of resolved) {
      for (const series of round.series) {
        // Never clear a pick for a series that admin has already settled.
        if (basePicks[series.id]) continue;
        // Apply play-in patch so play-in teams (e.g. CHI as E8 in s1) are
        // treated as valid rather than being erroneously cleared.
        const effectiveSeries = playInSeeds ? applyPlayInPatch(series, playInSeeds) : series;
        const pick = cleaned[series.id];
        if (pick?.winner && pick.winner !== effectiveSeries.top && pick.winner !== effectiveSeries.bottom) {
          // If the pick was one of the displaced play-in losers, substitute
          // it instead of dropping it (this shouldn't normally happen here
          // because we already ran virtualSubstitutePicksForPlayIn above, but
          // leave the check for safety).
          if (playInSeeds) {
            const subs = {};
            Object.entries(PI_SLOT_MAP).forEach(([sid, seedKey]) => {
              const actual = playInSeeds[seedKey];
              const orig = BRACKET_CONFIG.rounds[0].series.find(s => s.id === sid)?.bottom;
              if (orig && actual && pick.winner === orig) {
                subs[pick.winner] = actual;
              }
            });
            const replacement = subs[pick.winner];
            if (replacement) {
              cleaned = { ...cleaned, [series.id]: { ...pick, winner: replacement } };
              continue;
            }
          }
          cleaned = { ...cleaned, [series.id]: { ...pick, winner: undefined } };
        }
      }
    }
  }
  return cleaned;
}

// ─── Series Card ──────────────────────────────────────────────────────────────

function SeriesCard({ series, round, picks, onPick, readOnly, adminMode, results, onAdminSet }) {
  const pick    = picks?.[series.id] || {};
  const result  = getAdminResultForSeries(results, series.id);
  const settled = result?.winner != null;

  // Seed resolution — works for any round once teams are known
  const topSeed    = seedFor(series.top);
  const bottomSeed = seedFor(series.bottom);
  const showSeedVs = (topSeed !== "" && bottomSeed !== "");

  const pickWinner = (team) => { if (!readOnly && !adminMode) onPick(series.id, { ...pick, winner: team }); };
  const pickGames  = (g)    => { if (!readOnly && !adminMode) onPick(series.id, { ...pick, games: g }); };

  const confBorderColor = '#7d9ab0';  // muted blue-gray — consistent for all conferences

  const teamClass = (team) => {
    if (adminMode) return "";
    if (pick.winner !== team) return "";
    if (settled) return pick.winner === result.winner ? "ok" : "wrong";
    return "sel";
  };

  const gamesClass = (g) => {
    if (adminMode) return "";
    if (pick.games !== g) return "";
    if (settled && pick.winner === result.winner && pick.games === result.games) return "exact";
    return "sel";
  };

  const hasPick = pick.winner && pick.games;

  return (
    <div className={`sc ${settled ? "done" : ""}`} style={settled ? {border:`2px solid ${confBorderColor}`, boxShadow:`0 0 10px ${confBorderColor}33`} : {}}>
      <div className="sc-top">
        <div style={{display:"flex", alignItems:"center", gap:"7px"}}>
          <span className={`conf conf-${series.conference}`}>{series.conference}</span>
          {showSeedVs && (
            <span className={`seed-vs seed-vs-${series.conference}`}>{topSeed} vs {bottomSeed}</span>
          )}
        </div>
        <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
          <span className="mult">{round.winnerPoints}+{round.gamesPoints}pts</span>
          {settled && (
            <span className="xs mono green">✓ {result.winner} in {result.games}</span>
          )}
        </div>
      </div>

      {adminMode ? (
        <AdminControl series={series} result={result} onAdminSet={onAdminSet} />
      ) : (
        <>
          <div className="teams">
            <button className={`tbtn ${teamClass(series.top)}`}    onClick={() => pickWinner(series.top)}    disabled={readOnly}>
              <span className="tbtn-logo"><TeamLogo name={series.top}    size={46} state={teamClass(series.top)}    /></span>
              <span className="tbtn-name">{series.top}</span>
              {topSeed !== "" && <span className="tbtn-seed">#{topSeed}</span>}
            </button>
            <span className="vs">vs</span>
            <button className={`tbtn ${teamClass(series.bottom)}`} onClick={() => pickWinner(series.bottom)} disabled={readOnly}>
              <span className="tbtn-logo"><TeamLogo name={series.bottom} size={46} state={teamClass(series.bottom)} /></span>
              <span className="tbtn-name">{series.bottom}</span>
              {bottomSeed !== "" && <span className="tbtn-seed">#{bottomSeed}</span>}
            </button>
          </div>
          <div className="gr">
            <span className="gl">GAMES</span>
            {GAME_OPTIONS.map(g => (
              <button key={g} className={`gbtn ${gamesClass(g)}`} onClick={() => pickGames(g)} disabled={readOnly}>{g}</button>
            ))}
            <span className={`ps ${hasPick ? "ok" : "pending"}`}>
              {hasPick ? "✓ picked" : "incomplete"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function AdminControl({ series, result, onAdminSet }) {
  return (
    <div>
      <div className="xs muted mb8">{series.top} vs {series.bottom}</div>
      <div className="arow">
        <span className="al">Winner</span>
        <select className="sel" value={result?.winner || ""} onChange={e => onAdminSet(series.id, "winner", e.target.value)}>
          <option value="">— TBD —</option>
          <option value={series.top}>{series.top}</option>
          <option value={series.bottom}>{series.bottom}</option>
        </select>
        <span className="al" style={{marginLeft:8}}>Games</span>
        <select className="sel" value={result?.games || ""} onChange={e => onAdminSet(series.id, "games", Number(e.target.value))}>
          <option value="">—</option>
          {GAME_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {result?.winner && <span className="xs green mono">✓ Saved</span>}
      </div>
    </div>
  );
}

// Returns just the team nickname (last word of the full name)
// e.g. "Oklahoma City Thunder" → "Thunder", "New York Knicks" → "Knicks"
function shortTeamName(fullName) {
  if (!fullName) return "";
  const parts = fullName.trim().split(" ");
  return parts[parts.length - 1];
}

// ─── Bracket Matchup (compact card for bracket view) ─────────────────────

function BracketMatchup({ series, round, picks, onPick, readOnly, results, isFinals, eliminatedTeams, topGhost, bottomGhost, playInSeeds }) {
  const pick   = picks?.[series.id] || {};
  const result = getAdminResultForSeries(results, series.id);
  const settled = result?.winner != null;

  const topSeed    = seedFor(series.top, playInSeeds);
  const bottomSeed = seedFor(series.bottom, playInSeeds);

  // A slot is "real" when its team name is a known seeded (R1) team, or when the
  // series is already settled by admin results. Unresolved later-round slots whose
  // upstream pick hasn't been made yet keep a placeholder name (not in TEAM_SEEDS)
  // and should be shown as blank/non-interactive.
  const topIsReal    = (seedFor(series.top, playInSeeds) !== "") || settled;
  const bottomIsReal = (seedFor(series.bottom, playInSeeds) !== "") || settled;
  const bothReal     = topIsReal && bottomIsReal;

  const pickWinner = (team) => {
    if (!readOnly && bothReal) {
      // clicking the already-selected team deselects it (and clears games)
      const next = pick.winner === team ? { ...pick, winner: undefined, games: undefined } : { ...pick, winner: team };
      onPick?.(series.id, next);
    }
  };
  const pickGames = (g) => {
    if (!readOnly && bothReal) {
      // clicking the already-selected games count deselects it
      const next = pick.games === g ? { ...pick, games: undefined } : { ...pick, games: g };
      onPick?.(series.id, next);
    }
  };

  const teamClass = (team) => {
    if (settled) {
      const teamWon    = team === result.winner;
      const teamPicked = pick.winner === team;
      if ( teamWon &&  teamPicked) return "ok";             // ✓ correct pick → green
      if ( teamWon && !teamPicked) return "winner-missed";  // won, but you didn't pick them → teal
      if (!teamWon &&  teamPicked) return "wrong";          // your pick lost → red strikethrough
      return "loser-not-picked";                            // lost, not your pick → white fade strikethrough
    }
    // Unsettled: eliminated teams in future rounds shown red
    if (eliminatedTeams?.has(team)) return "wrong";
    if (pick.winner === team) return "sel";
    return "";
  };

  const gamesClass = (g) => {
    if (pick.games !== g) return "";
    if (!settled) {
      // Games pick dead if the winner pick is already eliminated
      if (eliminatedTeams?.has(pick.winner)) return "wrong-games";
      return "sel";
    }
    // Wrong winner → red games (total miss)
    if (pick.winner !== result.winner) return "wrong-games";
    // Correct winner + exact games → green
    if (pick.games === result.games) return "exact";
    // Correct winner + wrong games → red (missed the game count)
    return "wrong-games";
  };

  const hasPick = pick.winner && pick.games;
  const resultName = settled ? shortTeamName(result.winner) : "";
  const confBorderColor = '#7d9ab0';  // muted blue-gray — consistent for all conferences

  return (
    <div className={`bm ${settled ? "done" : ""}`} style={settled ? {border:`2px solid ${confBorderColor}`, boxShadow:`0 0 10px ${confBorderColor}33`} : {}}>
      <div className="bm-hdr" style={settled ? {background:'rgba(125,154,176,0.14)'} : {}}>
        <span className={`bm-conf ${series.conference}`}>{series.conference}</span>
        {settled && (
          <span className="bm-result" style={{color: confBorderColor}}>
            ✓ {resultName} in {result.games}
          </span>
        )}
      </div>
      {topGhost && (
        <div className="bm-ghost-top" title={`Your pick for this slot: ${topGhost} (eliminated)`}>
          <TeamLogo name={topGhost} size={13} state="wrong" />
          <span className="bm-ghost-name">{shortTeamName(topGhost)}</span>
          <span className="bm-ghost-arrow">← your pick (eliminated)</span>
        </div>
      )}
      {topIsReal ? (
        <button className={`bm-team ${teamClass(series.top)}`}
          onClick={() => pickWinner(series.top)} disabled={readOnly || !bothReal}>
          <span className="bm-logo"><TeamLogo name={series.top} size={26} state={teamClass(series.top)} /></span>
          <span className="bm-name">{series.top}</span>
          {topSeed != null && <span className="bm-seed">#{topSeed}</span>}
        </button>
      ) : (
        <button className="bm-team bm-team-tbd" disabled aria-label="TBD — pick upstream matchup first" />
      )}
      {bottomIsReal ? (
        <button className={`bm-team ${teamClass(series.bottom)}`}
          onClick={() => pickWinner(series.bottom)} disabled={readOnly || !bothReal}>
          <span className="bm-logo"><TeamLogo name={series.bottom} size={26} state={teamClass(series.bottom)} /></span>
          <span className="bm-name">{series.bottom}</span>
          {bottomSeed != null && <span className="bm-seed">#{bottomSeed}</span>}
        </button>
      ) : series.bottom === "Play-In TBD" ? (
        <button className="bm-team bm-team-pi-tbd" disabled aria-label="Play-In TBD — make Play-In picks first">
          <span style={{fontSize:'0.75rem'}}>🏀</span>
          <span className="bm-team-pi-tbd-text">PLAY-IN TBD</span>
        </button>
      ) : (
        <button className="bm-team bm-team-tbd" disabled aria-label="TBD — pick upstream matchup first" />
      )}
      {bottomGhost && (
        <div className="bm-ghost-bottom" title={`Your pick for this slot: ${bottomGhost} (eliminated)`}>
          <TeamLogo name={bottomGhost} size={13} state="wrong" />
          <span className="bm-ghost-name">{shortTeamName(bottomGhost)}</span>
          <span className="bm-ghost-arrow">← your pick (eliminated)</span>
        </div>
      )}
      <div className="bm-games"
        style={{...(settled ? {background:'rgba(125,154,176,0.10)'} : {}),
                ...(!bothReal && !settled ? {opacity:0.18, pointerEvents:'none'} : {})}}>
        <span className="bm-gl">G</span>
        {GAME_OPTIONS.map(g => (
          <button key={g} className={`bm-gbtn ${gamesClass(g)}`}
            onClick={() => pickGames(g)} disabled={readOnly || !bothReal}>{g}</button>
        ))}
        <span className={`bm-ps ${hasPick ? "ok" : "pending"}`}>{hasPick ? "✓" : "..."}</span>
      </div>
    </div>
  );
}

// ─── Bracket View (unified, absolute-positioned) ─────────────────────────────
//
// Single absolute-positioned canvas.
// East R1/R2/CF stacked on top, West R1/R2/CF below.
// Finals column on the far right, vertically centered between East CF and West CF.
// All connector lines drawn via SVG so they hit exactly the card vertical midpoints.

// Fixed bracket layout constants (height-related only; width is computed dynamically)
const BK = {
  CARD_H:       158,  // card height px — computed from CSS: hdr(25)+team*2(88)+div(1)+games(42)+borders(2)
  CARD_GAP:      24,  // vertical gap between sibling cards in same column
  CONF_GAP:      44,  // vertical gap between East and West conference blocks
  CONF_LABEL_H:  22,  // height reserved above each conference R1 block for "EAST"/"WEST" label
  COL_GAP:       24,  // horizontal connector zone width between card columns
  HDR_H:         54,  // round header row height above bracket
};

// Given an array of source-card top-px, return centered top-px for each parent (per consecutive pair)
function nextRoundTops(srcTops, cardH) {
  const out = [];
  for (let i = 0; i < srcTops.length; i += 2) {
    out.push((srcTops[i] + srcTops[i + 1] + cardH) / 2 - cardH / 2);
  }
  return out;
}

// Virtual-substitute picks for DISPLAY only: if admin/participant has confirmed
// a play-in team for a slot and the stored pick references a DIFFERENT team,
// replace that team with the actual play-in winner everywhere it appears in
// later rounds (only where it is no longer a valid team in that series).
// This does NOT modify stored data — it is only used when rendering the bracket.
function virtualSubstitutePicksForPlayIn(picks, playInSeeds) {
  if (!playInSeeds) return picks;
  let result = { ...picks };

  // Step 1: Fix R1 play-in slots and record which teams need substitution.
  // subs maps: wrongTeam → actualPlayInWinner
  const subs = {};
  Object.entries(PI_SLOT_MAP).forEach(([sid, seedKey]) => {
    const actualBottom = playInSeeds[seedKey];
    if (!actualBottom) return; // play-in result not yet known for this slot
    const r1Series = BRACKET_CONFIG.rounds[0].series.find(s => s.id === sid);
    if (!r1Series) return;
    const topTeam = r1Series.top;
    const pick = result[sid];
    if (pick?.winner && pick.winner !== topTeam && pick.winner !== actualBottom) {
      // Participant picked a team that is no longer in this slot — substitute
      subs[pick.winner] = actualBottom;
      result = { ...result, [sid]: { ...pick, winner: actualBottom } };
    }
  });

  if (Object.keys(subs).length === 0) return result;

  // Step 2: Walk later rounds in order (R2 → R3 → Finals), substituting the
  // old team with the new team ONLY where the old team is no longer available
  // in that series (it may still be valid via a different upstream slot).
  // Repeat up to 3 passes so that each level of the bracket gets corrected
  // using the already-fixed upstream level.
  for (let pass = 0; pass < 3; pass++) {
    // Resolve the bracket using the latest corrected picks to see what teams
    // are actually available in each later-round series.
    const resolved = resolveBracket(result);
    const seriesMap = {};
    resolved.forEach(round => round.series.forEach(s => { seriesMap[s.id] = s; }));

    let changed = false;
    const nextResult = { ...result };

    Object.entries(result).forEach(([sid, pick]) => {
      if (!pick?.winner) return;
      const newTeam = subs[pick.winner];
      if (!newTeam) return; // this team doesn't need substitution
      const series = seriesMap[sid];
      if (!series) return;
      // Only substitute if the old team is NOT present in this series.
      // If it's still present (came from a different play-in slot), leave it.
      if (series.top !== pick.winner && series.bottom !== pick.winner) {
        nextResult[sid] = { ...pick, winner: newTeam };
        changed = true;
      }
    });

    result = nextResult;
    if (!changed) break;
  }

  return result;
}

function BracketView({ picks, onPick, readOnly, results, scenarioMode, myPicksForScenario, onScenarioPick, playInSeeds }) {
  // Measure the container width so cards stretch to fill it
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(900);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0) setContainerW(w);
    });
    ro.observe(el);
    // Set immediately too
    setContainerW(el.getBoundingClientRect().width || 900);
    return () => ro.disconnect();
  }, []);

  // Card width fills container: 4 card cols + 3 connector gaps = totalW
  const CARD_W  = Math.max(160, Math.floor((containerW - 3 * BK.COL_GAP) / 4));
  const COL_GAP = BK.COL_GAP;
  const CARD_H  = BK.CARD_H;

  // Column left-edge X for card column index (0=R1, 1=R2, 2=CF, 3=Finals)
  const cx = (col) => col * (CARD_W + COL_GAP);
  // Spine X (vertical bracket line) between col and col+1
  const sx = (col) => cx(col) + CARD_W + COL_GAP / 2;

  // ── Vertical position calculations ────────────────────────────────────────
  const CL = BK.CONF_LABEL_H;  // space above each conference's R1 for label

  // East: R1 starts at CL (label above)
  const eR1 = Array.from({length:4}, (_,i) => CL + i * (CARD_H + BK.CARD_GAP));
  const eR2 = nextRoundTops(eR1, CARD_H);
  const eCF = nextRoundTops(eR2, CARD_H);

  const eastBlockH = CL + 4 * CARD_H + 3 * BK.CARD_GAP;

  // West: starts after east block + gap, then CL for west label
  const westStartY = eastBlockH + BK.CONF_GAP;
  const wR1 = Array.from({length:4}, (_,i) => westStartY + CL + i * (CARD_H + BK.CARD_GAP));
  const wR2 = nextRoundTops(wR1, CARD_H);
  const wCF = nextRoundTops(wR2, CARD_H);

  // Finals: vertically centered between East CF and West CF
  const finalsTop = (eCF[0] + CARD_H/2 + wCF[0] + CARD_H/2) / 2 - CARD_H / 2;

  const totalH = westStartY + CL + 4 * CARD_H + 3 * BK.CARD_GAP;
  const totalW = cx(3) + CARD_W;

  // ── Series/round lookup ───────────────────────────────────────────────────
  // In scenario mode, resolve team names using: admin results > scenario picks > my picks
  // In normal mode, apply a display-only virtual clean so that if admin has
  // finalized a play-in result, any stored picks referencing the wrong team are
  // stripped before resolveBracket propagates them into later rounds.
  const effectivePicks = (!scenarioMode && playInSeeds)
    ? virtualSubstitutePicksForPlayIn(picks || {}, playInSeeds)
    : (picks || {});
  const resolveSource = scenarioMode
    ? resolveForScenario(myPicksForScenario || {}, picks || {}, results)
    : effectivePicks;
  const resolvedRounds = resolveBracket(resolveSource);
  const seriesMap = {}, roundMap = {};
  resolvedRounds.forEach(round => round.series.forEach(s => {
    seriesMap[s.id] = s;
    roundMap[s.id]  = round;
  }));

  // ── Eliminated teams (computed once for this bracket render) ─────────────
  const eliminatedTeams = getEliminatedTeams(results);

  // ── Card renderer ─────────────────────────────────────────────────────────
  function renderCard(sid, topPx, col) {
    let series = seriesMap[sid];
    if (!series) return null;
    // Apply Play-In patches for affected R1 series (s1, s2, s5, s6)
    if (playInSeeds !== undefined) {
      series = applyPlayInPatch(series, playInSeeds);
    }
    const round = roundMap[sid];
    const rs = getAdminResultForSeries(results, sid);
    const merged = { ...series, winner: rs?.winner ?? null, games: rs?.games ?? null };

    if (scenarioMode) {
      const isSettled = rs?.winner != null;
      const scenarioPick = picks?.[sid] || {};

      // ── Ghost picks (only for unsettled series) ────────────────────────────
      // For each upstream series that feeds into this matchup's top/bottom slot,
      // check if the participant's upstream pick ≠ admin's actual upstream result.
      // If so, show that team as a ghost in THIS card — above top slot or below
      // bottom slot — to remind the participant their original pick was eliminated.
      let topGhost = null, bottomGhost = null;
      if (!isSettled && FEEDS_FROM[sid]) {
        const feed = FEEDS_FROM[sid];
        // Top slot: show ghost if the participant's upstream pick was eliminated
        // (either the upstream series settled with a different winner, OR the team
        //  is already in eliminatedTeams from an even earlier round — enabling
        //  multi-round propagation e.g. R1 loss shows ghost through R2, CF, Finals)
        const myTopPick = myPicksForScenario?.[feed.top]?.winner;
        if (myTopPick) {
          const topAdminResult = getAdminResultForSeries(results, feed.top);
          if ((topAdminResult?.winner && myTopPick !== topAdminResult.winner) ||
               eliminatedTeams.has(myTopPick)) {
            topGhost = myTopPick;
          }
        }
        // Bottom slot: same logic
        const myBottomPick = myPicksForScenario?.[feed.bottom]?.winner;
        if (myBottomPick) {
          const bottomAdminResult = getAdminResultForSeries(results, feed.bottom);
          if ((bottomAdminResult?.winner && myBottomPick !== bottomAdminResult.winner) ||
               eliminatedTeams.has(myBottomPick)) {
            bottomGhost = myBottomPick;
          }
        }
      }

      // Settled series: pass full myPicksForScenario so BracketMatchup can look up
      // `picks[sid]` and correctly compare it against the admin result (green/red/teal).
      // Unsettled series: pass only the scenario pick for this slot.
      const picksForCard = isSettled
        ? (myPicksForScenario || {})
        : { [sid]: scenarioPick };

      return (
        <div key={sid} style={{position:'absolute', top: topPx, left: cx(col), width: CARD_W}}>
          <BracketMatchup
            series={merged} round={round}
            picks={picksForCard}
            onPick={isSettled ? undefined : onScenarioPick}
            readOnly={isSettled}
            results={results}
            isFinals={sid === "s15"}
            eliminatedTeams={eliminatedTeams}
            topGhost={topGhost}
            bottomGhost={bottomGhost}
            playInSeeds={playInSeeds}
          />
        </div>
      );
    }

    return (
      <div key={sid} style={{position:'absolute', top: topPx, left: cx(col), width: CARD_W}}>
        <BracketMatchup
          series={merged} round={round} picks={picks || {}}
          onPick={onPick} readOnly={readOnly} results={results}
          isFinals={sid === "s15"}
          eliminatedTeams={eliminatedTeams}
          playInSeeds={playInSeeds}
        />
      </div>
    );
  }

  // ── SVG connectors between rounds ────────────────────────────────────────
  function Connectors({ srcTops, dstTops, srcCol }) {
    const srcRight = cx(srcCol) + CARD_W;
    const dstLeft  = cx(srcCol + 1);
    const spineX   = srcRight + COL_GAP / 2;
    return (
      <>
        {dstTops.map((dstTop, di) => {
          const s1m = srcTops[di*2]   + CARD_H/2;
          const s2m = srcTops[di*2+1] + CARD_H/2;
          const dm  = dstTop + CARD_H/2;
          return (
            <g key={di}>
              <line x1={srcRight} y1={s1m}   x2={spineX} y2={s1m}   stroke="var(--border2)" strokeWidth="1"/>
              <line x1={srcRight} y1={s2m}   x2={spineX} y2={s2m}   stroke="var(--border2)" strokeWidth="1"/>
              <line x1={spineX}   y1={s1m}   x2={spineX} y2={s2m}   stroke="var(--border2)" strokeWidth="1"/>
              <line x1={spineX}   y1={dm}    x2={dstLeft} y2={dm}   stroke="var(--border2)" strokeWidth="1"/>
            </g>
          );
        })}
      </>
    );
  }

  // Finals: spine connects East CF and West CF to Finals card
  function FinalsConnectors() {
    const srcRight = cx(2) + CARD_W;
    const dstLeft  = cx(3);
    const spineX   = srcRight + COL_GAP / 2;
    const eMid = eCF[0]    + CARD_H/2;
    const wMid = wCF[0]    + CARD_H/2;
    const fMid = finalsTop + CARD_H/2;
    return (
      <g>
        <line x1={srcRight} y1={eMid}  x2={spineX} y2={eMid}  stroke="var(--border2)" strokeWidth="1"/>
        <line x1={srcRight} y1={wMid}  x2={spineX} y2={wMid}  stroke="var(--border2)" strokeWidth="1"/>
        <line x1={spineX}   y1={eMid}  x2={spineX} y2={wMid}  stroke="var(--border2)" strokeWidth="1"/>
        <line x1={spineX}   y1={fMid}  x2={dstLeft} y2={fMid} stroke="var(--border2)" strokeWidth="1"/>
      </g>
    );
  }

  // ── Conference divider label ──────────────────────────────────────────────
  // Width is capped to the right edge of the CF column (col 2) so the
  // horizontal rule never bleeds under or behind the Finals column.
  function ConfLabel({ label, topY, color }) {
    const labelW = cx(2) + CARD_W;  // right edge of CF column
    return (
      <div style={{
        position:'absolute', top: topY, left: 0, width: labelW,
        display:'flex', alignItems:'center', gap:10, pointerEvents:'none',
        height: CL,
      }}>
        <span style={{
          fontFamily:"'Bebas Neue',sans-serif", fontSize:'0.72rem',
          letterSpacing:'3px', fontWeight:700, color, textTransform:'uppercase',
          whiteSpace:'nowrap', lineHeight:1,
        }}>{label}</span>
        <span style={{flex:1, height:1, background:'var(--border)', display:'block'}} />
      </div>
    );
  }

  // ── Round column headers ──────────────────────────────────────────────────
  const headers = [
    { col:0, label:"First Round",   pts:"10+5"  },
    { col:1, label:"Conf Semis",     pts:"20+5"  },
    { col:2, label:"Conf Finals",   pts:"30+10" },
    { col:3, label:"🏆 NBA Finals", pts:"40+10" },
  ];

  return (
    <div ref={containerRef} style={{width:'100%', paddingBottom:24}}>
      {containerW > 0 && (
        <div style={{position:'relative', width: totalW}}>

          {/* Round headers row */}
          <div style={{position:'relative', height: BK.HDR_H, marginBottom:10}}>
            {headers.map(h => (
              <div key={h.col} style={{
                position:'absolute', left: cx(h.col), width: CARD_W,
                height: BK.HDR_H, display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'flex-end', paddingBottom:4,
              }}>
                <div className="brk-round-hdr">{h.label}</div>
                <span className="brk-hdr-pts">{h.pts}pts</span>
              </div>
            ))}
          </div>

          {/* Bracket canvas */}
          <div style={{position:'relative', width: totalW, height: totalH}}>

            {/* Conference section labels — above their respective R1 blocks */}
            <ConfLabel label="Eastern Conference" topY={0}          color="rgba(123,159,245,0.75)" />
            <ConfLabel label="Western Conference" topY={westStartY} color="rgba(251,146,60,0.75)"  />

            {/* SVG connector lines — behind all cards */}
            <svg style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',
                         overflow:'visible',pointerEvents:'none'}}>
              <Connectors srcTops={eR1} dstTops={eR2} srcCol={0}/>
              <Connectors srcTops={eR2} dstTops={eCF} srcCol={1}/>
              <Connectors srcTops={wR1} dstTops={wR2} srcCol={0}/>
              <Connectors srcTops={wR2} dstTops={wCF} srcCol={1}/>
              <FinalsConnectors/>
            </svg>

            {/* East */}
            {["s1","s4","s2","s3"].map((sid,i) => renderCard(sid, eR1[i], 0))}
            {["s9","s10"].map((sid,i)            => renderCard(sid, eR2[i], 1))}
            {renderCard("s13", eCF[0], 2)}

            {/* West */}
            {["s5","s8","s6","s7"].map((sid,i) => renderCard(sid, wR1[i], 0))}
            {["s11","s12"].map((sid,i)           => renderCard(sid, wR2[i], 1))}
            {renderCard("s14", wCF[0], 2)}

            {/* Finals */}
            {renderCard("s15", finalsTop, 3)}

          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scenario Helpers ─────────────────────────────────────────────────────────
// Build a complete results structure from BRACKET_CONFIG, filling in winners from
// admin results first, then scenario picks for any unsettled series.
function buildScenarioResults(actualResults, scenarioPicks) {
  // Collect admin-set results by series ID.
  // Firebase may return rounds as a plain numeric-keyed object, so normalise.
  const adminResults = {};
  const roundsArr = Array.isArray(actualResults?.rounds)
    ? actualResults.rounds
    : Object.values(actualResults?.rounds || {});
  roundsArr.forEach(round => {
    const arr = Array.isArray(round.series) ? round.series : Object.values(round.series || {});
    arr.forEach(s => { if (s?.id && s?.winner) adminResults[s.id] = { winner: s.winner, games: s.games }; });
  });
  // Build complete structure from BRACKET_CONFIG (all 15 series present)
  return {
    ...actualResults,
    rounds: BRACKET_CONFIG.rounds.map(round => ({
      ...round,
      series: round.series.map(series => {
        const admin = adminResults[series.id];
        if (admin?.winner) return { ...series, ...admin };          // Admin result wins
        const sp = scenarioPicks?.[series.id];
        if (sp?.winner) return { ...series, winner: sp.winner, games: sp.games || null }; // Scenario pick
        return { ...series, winner: null, games: null };            // No result yet
      }),
    })),
  };
}

// ─── Scenario Resolution ──────────────────────────────────────────────────────
// Builds a "picks-like" object that determines which team names appear in each
// bracket slot for the scenario view.
// Priority order: admin results > scenario picks > blank (NOT myPicks).
// Unsettled slots with no scenario pick show generic placeholders so the user
// must pick manually (or use Auto-fill) — never pre-filled with participant picks.
// Used by BracketView (via resolveBracket) in scenario mode.
function resolveForScenario(myPicks, scenarioPicks, results) {
  const adminWinners = {};
  (Array.isArray(results?.rounds) ? results.rounds : Object.values(results?.rounds || {}))
    .forEach(round => {
      const arr = Array.isArray(round.series) ? round.series : Object.values(round.series || {});
      arr.forEach(s => { if (s?.id && s?.winner) adminWinners[s.id] = s.winner; });
    });
  const combined = {};
  BRACKET_CONFIG.rounds.forEach(round => {
    round.series.forEach(series => {
      const sid = series.id;
      if (adminWinners[sid]) {
        combined[sid] = { winner: adminWinners[sid] };
      } else if (scenarioPicks[sid]?.winner) {
        combined[sid] = scenarioPicks[sid];
      }
      // No myPicks fallback — unsettled slots remain blank placeholders
    });
  });
  return combined;
}

// ─── Admin Result Lookup ──────────────────────────────────────────────────────
// Safely finds an admin-set result for a given series ID, handling both array
// and object Firebase data shapes.  Returns the series object (with .winner /
// .games) if found, otherwise null.
function getAdminResultForSeries(results, sid) {
  // Firebase may return results.rounds as a plain numeric-keyed object instead of
  // a JS array, so we normalise with Object.values() when needed.
  const rounds = results?.rounds;
  if (!rounds) return null;
  const roundsArr = Array.isArray(rounds) ? rounds : Object.values(rounds);
  for (const round of roundsArr) {
    const arr = Array.isArray(round.series) ? round.series : Object.values(round.series || {});
    for (const s of arr) {
      if (s?.id === sid && s?.winner) return s;
    }
  }
  return null;
}

// ─── Play-In Modal ────────────────────────────────────────────────────────────
// Shown when user clicks the "🏀 Play-In" button in the Picks tab.
// Lets each entry independently pick winners for all 6 play-in games.
// Admin-set results override and lock individual game slots.

function PlayInModal({ activeEntry, playInPicks, playInPicks2, playInResults, onPick, onClose }) {
  const picks = activeEntry === 1 ? playInPicks : playInPicks2;

  function renderConference(conf) {
    const cfg   = PLAY_IN_CONFIG[conf];
    const pfx   = conf === "East" ? "piE" : "piW";
    const confColor = conf === "East" ? "rgba(123,159,245,0.85)" : "rgba(251,146,60,0.85)";

    // For each game: admin result takes precedence over participant pick
    const g1 = { id:`${pfx}1`, admin: playInResults?.[`${pfx}1`] || null, pick: picks[`${pfx}1`] || null };
    const g2 = { id:`${pfx}2`, admin: playInResults?.[`${pfx}2`] || null, pick: picks[`${pfx}2`] || null };
    const g3 = { id:`${pfx}3`, admin: playInResults?.[`${pfx}3`] || null, pick: picks[`${pfx}3`] || null };

    // G3 teams depend on G1/G2 effective results
    const g3Teams = getGame3Teams(conf, picks, playInResults);

    function renderGame(game, teams, label, desc, seedNums) {
      const settled     = !!game.admin;
      const effectiveW  = game.admin || game.pick;
      const canPick     = !settled && teams[0] && teams[1];

      return (
        <div className={`pi-game${!canPick && !settled && !(teams[0] && teams[1]) ? " pi-game-locked" : ""}`}>
          <div className="pi-game-hdr">
            <span className="pi-game-num">{label}</span>
            <span className="pi-game-desc">{desc}</span>
            {settled && <span className="pi-game-settled">✓ {shortTeamName(game.admin)}</span>}
          </div>

          {(teams[0] && teams[1]) ? (
            <div className="pi-matchup">
              {[0, 1].map(idx => {
                const tname = teams[idx];
                const seed  = seedNums ? seedNums[idx] : (TEAM_SEEDS[tname] ?? "");
                const isW   = effectiveW === tname;
                let cls = "";
                if (settled)        cls = isW ? "pi-ok" : "pi-wrong";
                else if (game.pick) cls = isW ? "pi-sel" : "";
                return (
                  <button key={tname}
                    className={`pi-team ${cls}`}
                    style={{gridColumn: idx === 0 ? '1' : '3'}}
                    onClick={() => canPick && onPick(game.id, tname)}
                    disabled={settled || !canPick}
                  >
                    <TeamLogo name={tname} size={32} state={settled ? (isW ? "ok" : "wrong") : (game.pick === tname ? "sel" : "")} />
                    <span className="pi-team-name">{tname}</span>
                    {seed !== "" && <span className="pi-seed">#{seed}</span>}
                  </button>
                );
              })}
              <span className="pi-vs" style={{gridColumn: '2'}}>vs</span>
            </div>
          ) : (
            <div className="pi-matchup">
              <div className="pi-team pi-tbd-slot"><span className="pi-tbd-label">TBD</span></div>
              <span className="pi-vs">vs</span>
              <div className="pi-team pi-tbd-slot"><span className="pi-tbd-label">TBD</span></div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={conf}>
        <div className={`pi-conf-label pi-conf-${conf}`} style={{color: confColor}}>
          {conf}ern Conference
        </div>

        {/* Game 1: seed7 vs seed8 → winner becomes #7 seed */}
        {renderGame(g1,
          [cfg.seed7, cfg.seed8],
          "Game 1",
          `Winner → ${conf[0]}7 Seed in Round 1`,
          [7, 8]
        )}

        {/* Game 2: seed9 vs seed10 → winner advances to Game 3 */}
        {renderGame(g2,
          [cfg.seed9, cfg.seed10],
          "Game 2",
          "Winner advances to Game 3 · Loser eliminated",
          [9, 10]
        )}

        {/* Game 3: loser(G1) vs winner(G2) → winner becomes #8 seed */}
        {renderGame(g3,
          [g3Teams.top, g3Teams.bottom],
          "Game 3",
          `Winner → ${conf[0]}8 Seed in Round 1  ·  complete Games 1 & 2 first`,
          null
        )}
      </div>
    );
  }

  const totalGames = 6;
  const donePicks  = ["piE1","piE2","piE3","piW1","piW2","piW3"].filter(k => playInResults?.[k] || picks[k]).length;

  return (
    <div className="ov-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ov-modal" style={{maxWidth:680}}>
        {/* Header */}
        <div className="ov-hdr">
          <div className="ov-hdr-left">
            <div className="ov-title">🏀 Play-In Tournament</div>
            <div className="ov-sub">
              Entry {activeEntry} picks · {donePicks}/{totalGames} games picked
              {playInResults && Object.keys(playInResults).length > 0 &&
                <span style={{color:'var(--cyan)', marginLeft:8}}>· Admin results locked for settled games</span>}
            </div>
          </div>
          <button className="ov-close" onClick={onClose}>✕</button>
        </div>

        <div className="ov-body" style={{paddingTop:14}}>
          <div style={{fontSize:'0.72rem', color:'var(--text3)', marginBottom:14, lineHeight:1.6}}>
            Pick winners for each play-in game. Your choices determine which teams appear in
            the <strong style={{color:'var(--text2)'}}>Round 1 #7 and #8 seed slots</strong> of your bracket.
            Games settled by the admin are locked automatically.
          </div>

          {renderConference("East")}
          {renderConference("West")}
        </div>
      </div>
    </div>
  );
}

// ─── Info Modal ───────────────────────────────────────────────────────────────

function InfoModal({ tab, onClose }) {
  const INFO = {
    picks: {
      title: "MY PICKS — HOW TO PLAY",
      sections: [
        {
          title: "Filling Out Your Bracket",
          items: [
            { dot:"var(--gold)",  text: <><strong>Click a team</strong> in each matchup to pick the winner, then select the number of games you think the series lasts.</> },
            { dot:"var(--gold)",  text: <>Work your way through <strong>all 4 rounds</strong> — First Round → Conf Semis → Conf Finals → NBA Finals. Later rounds unlock as you complete earlier ones.</> },
            { dot:"var(--cyan)",  text: <>You must pick <strong>all 15 series</strong> before you can submit. The counter at the bottom shows your progress.</> },
            { dot:"var(--green)", text: <>You can <strong>update picks any time</strong> before the deadline — just resubmit with the same name and your picks will be overwritten.</> },
            { dot:"var(--red)",   text: <>Once the admin <strong>locks picks</strong>, no new entries or changes are accepted.</> },
          ]
        },
        {
          title: "Two Entries Per Person",
          items: [
            { dot:"var(--gold)",  text: <>You may submit <strong>up to 2 entries</strong> — a second entry is completely optional. One entry is perfectly fine!</> },
            { dot:"var(--cyan)",  text: <>Use the <strong>Entry 1 / Entry 2 toggle</strong> (below the scoring banner) to switch between your two sets of picks. Each entry is scored independently on the leaderboard.</> },
            { dot:"var(--green)", text: <>To submit Entry 2: switch to the Entry 2 tab, make all 15 picks, then click <strong>Submit Entry 2</strong>. You can use a <strong>different name</strong> for Entry 2 if you'd like.</> },
            { dot:"var(--text3)", text: <>After submitting Entry 1, the app automatically switches you to Entry 2 to make it easy to fill out a second bracket. Both entries appear on the Leaderboard highlighted in silver — Entry 2 shows as <strong>Your Name (2)</strong> unless you gave it a custom name.</> },
          ]
        },
        {
          title: "Scoring System",
          items: [
            { dot:"var(--text3)", text: <><span style={{color:'var(--gold)',fontWeight:700}}>10 pts</span> — Round 1 winner correct &nbsp;·&nbsp; <span style={{color:'var(--gold)',fontWeight:700}}>+5 pts</span> if exact games</> },
            { dot:"var(--text3)", text: <><span style={{color:'var(--gold)',fontWeight:700}}>20 pts</span> — Conf Semis winner &nbsp;·&nbsp; <span style={{color:'var(--gold)',fontWeight:700}}>+5 pts</span> exact games</> },
            { dot:"var(--text3)", text: <><span style={{color:'var(--gold)',fontWeight:700}}>30 pts</span> — Conf Finals winner &nbsp;·&nbsp; <span style={{color:'var(--gold)',fontWeight:700}}>+10 pts</span> exact games</> },
            { dot:"var(--gold)",  text: <><span style={{color:'var(--gold)',fontWeight:700}}>40 pts</span> — NBA Finals winner &nbsp;·&nbsp; <span style={{color:'var(--gold)',fontWeight:700}}>+10 pts</span> exact games</> },
            { dot:"var(--text3)", text: <span style={{color:'var(--text3)',fontSize:'0.7rem'}}>Games bonus only awarded when you also picked the correct series winner.</span> },
          ]
        },
        {
          title: "Result Colour Guide",
          items: [
            { dot:"var(--green)",              text: <><strong style={{color:'var(--green)'}}>Green</strong> — You correctly picked this team to win ✓</> },
            { dot:"var(--cyan)",               text: <><strong style={{color:'var(--cyan)'}}>Teal</strong> — Actual winner — you didn't pick them</> },
            { dot:"var(--red)",                text: <><strong style={{color:'var(--red)'}}>Red / strikethrough</strong> — Your pick lost this series</> },
            { dot:"rgba(255,255,255,0.18)",    text: <><strong style={{color:'rgba(255,255,255,0.35)'}}>Faded / strikethrough</strong> — Loser you didn't pick</> },
            { dot:"rgba(239,68,68,0.7)",       text: <><strong style={{color:'rgba(239,68,68,0.8)'}}>Red game button</strong> — Games count was incorrect (or wrong winner)</> },
            { dot:"var(--green)",              text: <><strong style={{color:'var(--green)'}}>Green game button</strong> — Exact game count nailed it ✓</> },
          ]
        },
      ]
    },
    leaderboard: {
      title: "LEADERBOARD — HOW TO READ",
      sections: [
        {
          title: "Rankings",
          items: [
            { dot:"var(--gold)",  text: <>Sorted by <strong>total points</strong>, updated live as the admin enters results.</> },
            { dot:"var(--cyan)",  text: <>Your row is highlighted in <strong>silver</strong> — scroll to find yourself quickly.</> },
            { dot:"var(--text3)", text: <>Once picks are locked, <strong>tap any row</strong> to view that participant's full bracket overlay.</> },
          ]
        },
        {
          title: "Column Guide",
          items: [
            { dot:"var(--gold)",  text: <><strong style={{color:'var(--gold)'}}>PTS</strong> — Points earned so far from correct winner and games picks</> },
            { dot:"var(--cyan)",  text: <><strong style={{color:'var(--cyan)'}}>MAX PTS</strong> — Best-case total if all remaining picks come through</> },
            { dot:"var(--green)", text: <><strong style={{color:'var(--green)'}}>SERIES ✓</strong> — Count of series where you correctly predicted the winner</> },
            { dot:"var(--amber)", text: <><strong style={{color:'var(--amber)'}}>GAMES ✓</strong> — Count of series where you also nailed the exact game count</> },
            { dot:"var(--gold)",  text: <><strong>🏆 Finals Pick</strong> — Your predicted NBA Champion · Red strikethrough = team eliminated</> },
          ]
        },
        {
          title: "Progress Bar",
          items: [
            { dot:"var(--gold)",  text: <>The bar under each name shows your score as a <strong>percentage of the current leader</strong>. Silver bar = your own entry.</> },
          ]
        },
      ]
    },
    scenario: {
      title: "SCENARIO SIMULATOR",
      sections: [
        {
          title: "How It Works",
          items: [
            { dot:"var(--gold)",  text: <>Pick <strong>hypothetical outcomes</strong> for upcoming series to instantly see how projected standings would shift.</> },
            { dot:"var(--cyan)",  text: <>The <strong>Projected Standings</strong> panel (left) updates in real-time as you click teams and games.</> },
            { dot:"var(--text3)", text: <>Series already decided by the admin are <strong>locked</strong> — they reflect real results and cannot be changed in the simulator.</> },
            { dot:"var(--text3)", text: <>Unsettled slots start <strong>blank</strong>. Click through the bracket to fill them, or use Auto-fill.</> },
          ]
        },
        {
          title: "Buttons",
          items: [
            { dot:"var(--gold)", text: <><strong>↺ Auto-fill My Picks</strong> — Pre-fills remaining slots with your submitted picks (skips eliminated teams)</> },
            { dot:"var(--red)",  text: <><strong>✕ Clear Scenario</strong> — Resets all scenario picks back to blank</> },
          ]
        },
        {
          title: "Colour Guide — Settled Series",
          items: [
            { dot:"var(--green)",           text: <><strong style={{color:'var(--green)'}}>Green</strong> — You correctly picked this team to win ✓</> },
            { dot:"var(--cyan)",            text: <><strong style={{color:'var(--cyan)'}}>Teal</strong> — Actual winner — you didn't pick them</> },
            { dot:"var(--red)",             text: <><strong style={{color:'var(--red)'}}>Red / strikethrough</strong> — Your pick that lost</> },
            { dot:"rgba(255,255,255,0.18)", text: <><strong style={{color:'rgba(255,255,255,0.35)'}}>Faded</strong> — Loser you didn't pick</> },
            { dot:"rgba(239,68,68,0.7)",    text: <><strong style={{color:'rgba(239,68,68,0.8)'}}>Red game button</strong> — Games count was wrong</> },
          ]
        },
        {
          title: "Eliminated Pick Indicator",
          items: [
            { dot:"var(--red)", text: <>If a team you originally picked for a future round has been <strong>eliminated</strong>, their name appears in <strong style={{color:'var(--red)'}}>red strikethrough</strong> inside that matchup card as a reminder.</> },
          ]
        },
      ]
    },
    stats: {
      title: "POOL STATS — WHAT IT MEANS",
      sections: [
        {
          title: "Summary Cards",
          items: [
            { dot:"var(--gold)",  text: <><strong>Participants</strong> — Total number of entries submitted to the pool</> },
            { dot:"var(--cyan)",  text: <><strong>Series Complete</strong> — How many of the 15 series have results recorded</> },
            { dot:"var(--green)", text: <><strong>Top Score</strong> — The highest point total currently in the pool</> },
            { dot:"var(--text3)", text: <><strong>Avg Score</strong> — Average points per participant across all entries</> },
          ]
        },
        {
          title: "Pick Distribution",
          items: [
            { dot:"var(--text3)", text: <>For each <strong>completed series</strong>, see what percentage of participants picked each team to win.</> },
            { dot:"var(--green)", text: <>The <strong>green team name + ✓</strong> is the actual winner — so you can see if the pool was on the right side of history.</> },
            { dot:"var(--cyan)",  text: <>The cyan bar and percentage show how many participants chose that team. Use this to spot consensus picks vs. contrarian ones.</> },
          ]
        },
      ]
    },
  };

  const tabContent = INFO[tab] || INFO['picks'];

  return (
    <div className="info-backdrop" onClick={onClose}>
      <div className="info-panel" onClick={e => e.stopPropagation()}>
        <div className="info-hdr">
          <div className="info-title">{tabContent.title}</div>
          <button className="info-close" onClick={onClose}>✕</button>
        </div>
        <div className="info-body">
          {tabContent.sections.map((section, si) => (
            <div key={si} className="info-section">
              <div className="info-sec-title">{section.title}</div>
              {section.items.map((item, ii) => (
                <div key={ii} className="info-row">
                  <div className="info-dot" style={{background: item.dot}} />
                  <div className="info-text">{item.text}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

// Formats an ISO datetime string (e.g. "2026-04-18T20:00") for human display.
function formatDeadline(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch { return isoStr; }
}

export default function App() {
  const [tab,       setTab]       = useState("picks");
  const [results,   setResults]   = useState(null);       // from Firebase
  const [participants, setParticipants] = useState({});   // from Firebase
  const [myPicks,   setMyPicks]   = useState({});
  const [myPicks2,  setMyPicks2]  = useState({});       // Entry 2 picks (local edit)
  const [activeEntry, setActiveEntry] = useState(1);   // 1 or 2 — which entry the user is editing
  const [myName,    setMyName]    = useState(() => localStorage.getItem("pool_name") || "");
  const [myName2,   setMyName2]   = useState(() => localStorage.getItem("pool_name_2") || "");
  const [myEmail,   setMyEmail]   = useState("");
  const [myEmail2,  setMyEmail2]  = useState(() => localStorage.getItem("pool_email_2") || "");
  const [submitted, setSubmitted] = useState(() => localStorage.getItem("pool_submitted") === "1");
  const [submitted2, setSubmitted2] = useState(() => localStorage.getItem("pool_submitted_2") === "1");
  const [toast,       setToast]       = useState("");
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [submitError, setSubmitError] = useState("");   // inline persistent error under submit row
  const [adminAuthed,      setAdminAuthed]      = useState(false);
  const [adminEmail,       setAdminEmail]       = useState("");
  const [adminPass,        setAdminPass]        = useState("");
  const [adminLoginError,  setAdminLoginError]  = useState("");
  const [showAdminPass,    setShowAdminPass]    = useState(false);
  const [picksLocked,  setPicksLocked]  = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);  // participant whose picks are open in overlay
  const [scenarioPicks,  setScenarioPicks]  = useState({});  // local session-only scenario picks
  const [deadline,         setDeadline]         = useState("");  // ISO string from Firebase settings/deadline
  const [adminDeadlineDate, setAdminDeadlineDate] = useState(""); // date input for admin editor
  const [adminDeadlineTime, setAdminDeadlineTime] = useState(""); // time input for admin editor
  const [scenarioEntry,  setScenarioEntry]  = useState(1);   // 1 or 2 — which entry to compare in Scenario
  const [infoOpen,      setInfoOpen]      = useState(false); // info/how-to-play panel
  // ── Play-In state ──
  const [playInPicks,   setPlayInPicks]   = useState({});  // entry 1 play-in picks (local)
  const [playInPicks2,  setPlayInPicks2]  = useState({});  // entry 2 play-in picks (local)
  const [playInResults, setPlayInResults] = useState(null); // admin-set actual play-in results
  const [showPlayIn,    setShowPlayIn]    = useState(false); // play-in modal visibility

  // Whenever the admin updates results (including play-in) or the participant
  // changes their play-in picks, re-run pick-cleaning so downstream slots stay
  // consistent.  This handles cases where admin overwrites a play-in result and
  // the user never touches the bracket again.
  useEffect(() => {
    if (!results) return;
    // build flat results-as-picks for cleaning
    const resultsAsPicks = {};
    (Array.isArray(results?.rounds) ? results.rounds : Object.values(results?.rounds || {}))
      .flatMap(r => Array.isArray(r.series) ? r.series : Object.values(r.series || {}))
      .forEach(s => {
        if (s?.id && s?.winner) resultsAsPicks[s.id] = { winner: s.winner, games: s.games };
      });
    const piSeeds1 = resolveEffectiveSeeds(playInPicks  || {}, playInResults);
    const piSeeds2 = resolveEffectiveSeeds(playInPicks2 || {}, playInResults);
    setMyPicks(prev => cleanDownstreamPicks(virtualSubstitutePicksForPlayIn(prev, piSeeds1), resultsAsPicks, piSeeds1));
    setMyPicks2(prev => cleanDownstreamPicks(virtualSubstitutePicksForPlayIn(prev, piSeeds2), resultsAsPicks, piSeeds2));
  }, [results, playInResults, playInPicks, playInPicks2]);

  const toastTimer = useRef(null);

  // ── Firebase listeners ──
  useEffect(() => {
    // If Firebase is not configured (e.g. local dev without .env), use defaults immediately
    if (!db) {
      setResults(BRACKET_CONFIG);
      setLoading(false);
      return;
    }

    // Fallback: if Firebase doesn't respond within 3s, load with defaults
    const fallback = setTimeout(() => {
      setResults(prev => prev || BRACKET_CONFIG);
      setLoading(false);
    }, 3000);

    // Listen to results (admin sets these)
    const unsubResults = onValue(ref(db, "results"), snap => {
      clearTimeout(fallback);
      if (snap.exists()) setResults(snap.val());
      else setResults(BRACKET_CONFIG); // default: use bracket config as skeleton
      setLoading(false);
    });

    // Listen to all participants
    const unsubParticipants = onValue(ref(db, "participants"), snap => {
      setParticipants(snap.exists() ? snap.val() : {});
    });

    // Listen to picks lock state
    const unsubLock = onValue(ref(db, "settings/picksLocked"), snap => {
      setPicksLocked(snap.exists() ? snap.val() : false);
    });

    // Listen to submission deadline (set by admin)
    const unsubDeadline = onValue(ref(db, "settings/deadline"), snap => {
      const val = snap.exists() ? snap.val() : "";
      setDeadline(val);
      if (val) {
        const [d, t] = val.split("T");
        setAdminDeadlineDate(d || "");
        setAdminDeadlineTime(t?.slice(0, 5) || "");
      }
    });

    // Listen to admin-set play-in results
    const unsubPlayIn = onValue(ref(db, "settings/playInResults"), snap => {
      setPlayInResults(snap.exists() ? snap.val() : null);
    });

    // Track Firebase Auth state — keeps admin logged in across page refreshes
    const unsubAuth = auth
      ? onAuthStateChanged(auth, user => setAdminAuthed(!!user))
      : () => {};

    // Load my own saved picks (entry 1 and entry 2) + play-in picks
    const savedName = localStorage.getItem("pool_name");
    if (savedName) {
      const unsubMe = onValue(ref(db, `participants/${sanitize(savedName)}/picks`), snap => {
        if (snap.exists()) setMyPicks(snap.val());
      });
      const unsubMe2 = onValue(ref(db, `participants/${sanitize(savedName)}/picks2`), snap => {
        if (snap.exists()) setMyPicks2(snap.val());
      });
      const unsubPIP = onValue(ref(db, `participants/${sanitize(savedName)}/playInPicks`), snap => {
        if (snap.exists()) setPlayInPicks(snap.val());
      });
      const unsubPIP2 = onValue(ref(db, `participants/${sanitize(savedName)}/playInPicks2`), snap => {
        if (snap.exists()) setPlayInPicks2(snap.val());
      });
      return () => { unsubResults(); unsubParticipants(); unsubLock(); unsubDeadline(); unsubPlayIn(); unsubAuth(); unsubMe(); unsubMe2(); unsubPIP(); unsubPIP2(); };
    }

    return () => { unsubResults(); unsubParticipants(); unsubLock(); unsubDeadline(); unsubPlayIn(); unsubAuth(); };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  };

  // Sanitize name for use as Firebase key (no special chars)
  function sanitize(name) { return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"); }

  // ── Picks ──
  // activePicks = whichever entry the user is currently editing
  const activePicks    = activeEntry === 1 ? myPicks : myPicks2;
  const isSubmitted    = activeEntry === 1 ? submitted : submitted2;

  const handlePick = (seriesId, pick) => {
    // Compute current effective play-in seeds so cleanDownstreamPicks knows
    // which play-in teams are valid in s1/s2/s5/s6 and doesn't clear them.
    const piSrc   = activeEntry === 1 ? playInPicks : playInPicks2;
    const piSeeds = resolveEffectiveSeeds(piSrc, playInResults);
    if (activeEntry === 1) {
      setMyPicks(prev => {
        // Substitute any stale play-in teams with confirmed winners before
        // cleaning, so cleanDownstreamPicks replaces them rather than clearing them.
        const next = { ...prev, [seriesId]: pick };
        const substituted = piSeeds ? virtualSubstitutePicksForPlayIn(next, piSeeds) : next;
        return cleanDownstreamPicks(substituted, {}, piSeeds);
      });
    } else {
      setMyPicks2(prev => {
        const next = { ...prev, [seriesId]: pick };
        const substituted = piSeeds ? virtualSubstitutePicksForPlayIn(next, piSeeds) : next;
        return cleanDownstreamPicks(substituted, {}, piSeeds);
      });
    }
  };

  const totalSeries  = BRACKET_CONFIG.rounds.flatMap(r => r.series).length;
  const pickedCount  = Object.values(activePicks).filter(p => p.winner && p.games).length;
  const allPicked    = pickedCount === totalSeries;

  // Scenario tab: count series that have a decision — either admin-settled or user scenario-picked
  const scenarioPickedCount = BRACKET_CONFIG.rounds.flatMap(r => r.series).filter(s => {
    const rs = getAdminResultForSeries(results, s.id);
    if (rs?.winner) return true;  // admin result counts
    return !!(scenarioPicks[s.id]?.winner && scenarioPicks[s.id]?.games);
  }).length;
  const scenarioAllPicked = scenarioPickedCount === totalSeries;

  // ── Pool Stats: selection breakdown by round ──
  const allStatsEntries = Object.values(participants).flatMap(p => {
    const e = [];
    if (p.picks  && Object.keys(p.picks ).length > 0) e.push(p.picks);
    if (p.picks2 && Object.keys(p.picks2).length > 0) e.push(p.picks2);
    return e;
  });
  const statsTotalEntries = allStatsEntries.length;
  const statsTeams = [];
  BRACKET_CONFIG.rounds[0].series.forEach(s => {
    statsTeams.push({ team:s.top,    seed:s.topSeed,    conf:s.conference, r1Id:s.id });
    statsTeams.push({ team:s.bottom, seed:s.bottomSeed, conf:s.conference, r1Id:s.id });
  });
  const statsWest = statsTeams.filter(t => t.conf === "West").sort((a,b) => a.seed - b.seed);
  const statsEast = statsTeams.filter(t => t.conf === "East").sort((a,b) => a.seed - b.seed);
  const statsCount = (team, roundIdx, r1Id) => roundIdx === 0
    ? allStatsEntries.filter(p => p[r1Id]?.winner === team).length
    : allStatsEntries.filter(p => BRACKET_CONFIG.rounds[roundIdx].series.some(s => p[s.id]?.winner === team)).length;

  // ── Submit ──
  const handleSubmit = async () => {
    setSubmitError(""); // clear any lingering inline error on every attempt
    const activeEmail = activeEntry === 1 ? myEmail.trim() : (myEmail2.trim() || myEmail.trim());
    if (!myName.trim()) return showToast("Please enter your name first");
    if (!activeEmail)   return showToast("Please enter your email address");
    // Validate email format — shown inline so it stays visible
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(activeEmail)) {
      setSubmitError("Please enter a valid email address (e.g. you@email.com)");
      return;
    }
    if (!allPicked) return showToast(`Complete all ${totalSeries} picks first`);
    // Duplicate name guard — shown inline; checks ALL existing participant keys, not just prevKey
    if (activeEntry === 1) {
      const key    = sanitize(myName.trim());
      const prevKey = sanitize(localStorage.getItem("pool_name") || "");
      // Allow updating your own entry (prevKey matches) but block any other collision
      const takenByOther = key !== prevKey && !!participants[key];
      // Also catch display-name collisions: scan all participant names for an exact-match
      // (covers edge cases where sanitize() maps two different strings to the same key)
      const nameLower = myName.trim().toLowerCase();
      const takenByName = key !== prevKey && Object.values(participants).some(
        p => (p.name || "").trim().toLowerCase() === nameLower
      );
      if (takenByOther || takenByName) {
        setSubmitError(`"${myName.trim()}" is already taken — please choose a different name`);
        return;
      }
    }
    setSaving(true);
    try {
      const key = sanitize(myName);
      if (activeEntry === 1) {
        // Entry 1: use set() to create/overwrite the whole record, preserving any existing entry 2
        await set(ref(db, `participants/${key}`), {
          name:         myName.trim(),
          email:        myEmail.trim(),
          picks:        myPicks,
          playInPicks:  Object.keys(playInPicks).length > 0 ? playInPicks : null,
          submittedAt:  Date.now(),
          // Preserve entry 2 data if it already exists
          ...(participants[key]?.picks2        ? { picks2:        participants[key].picks2        } : {}),
          ...(participants[key]?.submittedAt2  ? { submittedAt2:  participants[key].submittedAt2  } : {}),
          ...(participants[key]?.name2         ? { name2:         participants[key].name2         } : {}),
          ...(participants[key]?.playInPicks2  ? { playInPicks2:  participants[key].playInPicks2  } : {}),
        });
        localStorage.setItem("pool_name",      myName.trim());
        localStorage.setItem("pool_submitted", "1");
        setSubmitted(true);
        // Stay on My Picks tab but switch to Entry 2 so user can fill it out
        setActiveEntry(2);
      } else {
        // Entry 2: use update() so we never overwrite entry 1 picks
        const name2Value  = myName2.trim()  || myName.trim();
        const email2Value = myEmail2.trim() || myEmail.trim();
        await update(ref(db), {
          [`participants/${key}/picks2`]:       myPicks2,
          [`participants/${key}/playInPicks2`]: Object.keys(playInPicks2).length > 0 ? playInPicks2 : null,
          [`participants/${key}/submittedAt2`]: Date.now(),
          [`participants/${key}/name2`]:        name2Value,
          [`participants/${key}/email2`]:       email2Value,
        });
        localStorage.setItem("pool_submitted_2", "1");
        localStorage.setItem("pool_name_2",  name2Value);
        localStorage.setItem("pool_email_2", myEmail2.trim());
        setSubmitted2(true);
      }
      setSubmitError(""); // clear any stale inline error on successful save
      showToast(activeEntry === 1 ? "🏆 Entry 1 submitted! Now fill out Entry 2 below." : "🏆 Entry 2 submitted!");
    } catch (e) {
      showToast("Error saving — check Firebase config");
      console.error(e);
    }
    setSaving(false);
  };

  // ── Admin: Firebase Auth login / logout ──
  const handleAdminLogin = async () => {
    setAdminLoginError("");
    if (!adminEmail.trim() || !adminPass.trim()) {
      setAdminLoginError("Please enter your email and password");
      return;
    }
    if (!auth) { setAdminLoginError("Firebase not configured"); return; }
    try {
      await signInWithEmailAndPassword(auth, adminEmail.trim(), adminPass.trim());
      setAdminEmail("");
      setAdminPass("");
    } catch (e) {
      console.error("Admin login error:", e.code, e.message);
      if (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password" || e.code === "auth/user-not-found") {
        setAdminLoginError("Incorrect email or password");
      } else if (e.code === "auth/unauthorized-domain") {
        setAdminLoginError("This domain is not authorized — add it in Firebase Console → Authentication → Settings → Authorized Domains");
      } else if (e.code === "auth/configuration-not-found" || e.code === "auth/invalid-api-key") {
        setAdminLoginError("Firebase Auth not configured — check your environment variables");
      } else {
        setAdminLoginError(`Login failed: ${e.code || e.message}`);
      }
      setAdminPass("");
    }
  };

  const handleAdminLogout = async () => {
    try {
      if (auth) await signOut(auth);
    } catch (e) { console.error(e); }
  };

  // ── Play-In: participant pick handler ──
  const handlePlayInPick = (gameId, winner) => {
    const doUpdate = (prev) => {
      const next = { ...prev, [gameId]: winner };
      // Deselect if picking the already-selected winner (toggle)
      if (prev[gameId] === winner) { delete next[gameId]; }
      // Clear Game 3 pick if Game 1 or Game 2 changes (G3 teams depend on them)
      const isEast = gameId.startsWith("piE");
      const g3Key  = isEast ? "piE3" : "piW3";
      if (gameId !== g3Key && (gameId.endsWith("1") || gameId.endsWith("2"))) {
        delete next[g3Key];
      }
      return next;
    };
    if (activeEntry === 1) setPlayInPicks(doUpdate);
    else                   setPlayInPicks2(doUpdate);
  };

  // ── Admin: save a play-in game result ──
  const handleAdminPlayIn = async (gameId, winner) => {
    try {
      if (winner) {
        await set(ref(db, `settings/playInResults/${gameId}`), winner);
      } else {
        // Clear the result
        await set(ref(db, `settings/playInResults/${gameId}`), null);
      }
      showToast("✓ Play-In result saved");
    } catch (e) {
      showToast("Error saving Play-In result");
      console.error(e);
    }
  };

  // ── Admin: picks lock toggle ──
  const handleToggleLock = async () => {
    try {
      await set(ref(db, "settings/picksLocked"), !picksLocked);
      showToast(picksLocked ? "✓ Picks unlocked" : "🔒 Picks locked");
    } catch (e) {
      showToast("Error updating lock state");
      console.error(e);
    }
  };

  // ── Admin: deadline save ──
  const handleSaveDeadline = async () => {
    if (!adminDeadlineDate) return showToast("Please select a deadline date");
    const isoStr = adminDeadlineTime
      ? `${adminDeadlineDate}T${adminDeadlineTime}`
      : adminDeadlineDate;
    try {
      await set(ref(db, "settings/deadline"), isoStr);
      showToast("📅 Deadline saved!");
    } catch (e) {
      showToast("Error saving deadline");
      console.error(e);
    }
  };

  // ── Scenario ──
  const handleScenarioPick = (seriesId, pick) => {
    // Normalise Firebase plain-object rounds to a real array once, then reuse.
    const roundsArr = Array.isArray(results?.rounds)
      ? results.rounds
      : Object.values(results?.rounds || {});
    // Don't allow changing admin-settled series in scenario
    const isSettled = roundsArr
      .flatMap(r => Array.isArray(r.series) ? r.series : Object.values(r.series || {}))
      .some(s => s?.id === seriesId && s?.winner != null);
    if (isSettled) return;
    // Build a basePicks map of all admin-settled results so cleanDownstreamPicks
    // can resolve real team names (instead of BRACKET_CONFIG placeholders) when
    // validating whether the new pick still belongs in its slot.
    const adminPicks = {};
    roundsArr.forEach(round => {
      const arr = Array.isArray(round.series) ? round.series : Object.values(round.series || {});
      arr.forEach(s => { if (s?.id && s?.winner) adminPicks[s.id] = { winner: s.winner }; });
    });
    setScenarioPicks(prev => cleanDownstreamPicks({ ...prev, [seriesId]: pick }, adminPicks));
  };
  const handleScenarioAutoFill = () => {
    const eliminated = getEliminatedTeams(results);
    // Use whichever entry is selected in the scenario toggle
    const srcPicks = scenarioEntry === 1 ? myPicks : myPicks2;
    const filled = {};
    Object.entries(srcPicks).forEach(([sid, pick]) => {
      if (pick?.winner && !eliminated.has(pick.winner)) filled[sid] = pick;
    });
    setScenarioPicks(filled);
  };
  const handleScenarioClear = () => setScenarioPicks({});

  // ── Admin: paid status toggle ──
  const handlePaidToggle = async (participantKey, currentPaid) => {
    try {
      const updates = {};
      updates[`participants/${participantKey}/paid`] = !currentPaid;
      await update(ref(db), updates);
    } catch (e) {
      showToast("Error updating payment status");
      console.error(e);
    }
  };

  // ── Admin: export participants CSV ──
  const handleExport = () => {
    const rows = [["Name", "Email", "Paid", "Points", "Submitted"]];
    leaderboard.forEach(p => {
      const paid = participants[p.id]?.paid ? "Yes" : "No";
      const submitted = p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : "";
      rows.push([p.name || "", p.email || "", paid, p.points, submitted]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "playoff-pool-entries.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Admin: set series result ──
  const handleAdminSet = async (seriesId, field, value) => {
    try {
      // Find round index and series index
      let roundIdx = -1, seriesIdx = -1;
      BRACKET_CONFIG.rounds.forEach((r, ri) => {
        r.series.forEach((s, si) => {
          if (s.id === seriesId) { roundIdx = ri; seriesIdx = si; }
        });
      });
      if (roundIdx === -1) return;

      // CRITICAL: Always save both the field being updated AND the id
      const updates = {};
      updates[`results/rounds/${roundIdx}/series/${seriesIdx}/${field}`] = value;
      updates[`results/rounds/${roundIdx}/series/${seriesIdx}/id`] = seriesId;
      
      await update(ref(db), updates);
      showToast("✓ Result saved");
    } catch (e) {
      showToast("Error saving result");
      console.error(e);
    }
  };

  // ── Leaderboard ──
  // Flatten participants to include both entries for multi-entry users.
  // Entry 2 rows use key "{key}__2" so buildLeaderboard scores them separately.
  const myKey       = sanitize(myName);
  const flatParticipants = {};
  Object.entries(participants).forEach(([key, p]) => {
    // Apply play-in substitutions so scoring reflects confirmed play-in winners
    // even when stored picks still reference the displaced team (e.g. "LA Lakers"
    // stored as W7 pick but actual W7 = "New Orleans Pelicans").
    const piSeeds1 = resolveEffectiveSeeds(p.playInPicks  || {}, playInResults);
    const piSeeds2 = resolveEffectiveSeeds(p.playInPicks2 || {}, playInResults);
    const subPicks1 = virtualSubstitutePicksForPlayIn(p.picks  || {}, piSeeds1);
    flatParticipants[key] = { ...p, picks: subPicks1 };
    if (p.picks2 && Object.keys(p.picks2).length > 0) {
      const subPicks2 = virtualSubstitutePicksForPlayIn(p.picks2, piSeeds2);
      flatParticipants[key + '__2'] = { ...p, picks: subPicks2 };
    }
  });
  const leaderboard = buildLeaderboard(flatParticipants, results);
  const topPts      = leaderboard[0]?.points || 1;
  const eliminatedTeams = getEliminatedTeams(results);

  // ── Pool stats ──
  const completedCount = (Array.isArray(results?.rounds) ? results.rounds : Object.values(results?.rounds || {}))
    .flatMap(r => Array.isArray(r.series) ? r.series : Object.values(r.series || {}))
    .filter(s => s?.winner).length;

  // ── Scenario ──
  const scenarioResults     = buildScenarioResults(results, scenarioPicks);
  const scenarioLeaderboard = buildLeaderboard(flatParticipants, scenarioResults);

  // ── Play-In: effective seeds for each context ──
  // Active participant (Picks tab): admin results override their own picks
  const activePlayInPicks  = activeEntry === 1 ? playInPicks  : playInPicks2;
  const activePlayInSeeds  = resolveEffectiveSeeds(activePlayInPicks, playInResults);
  // Are ALL 6 play-in games decided (picked or admin-settled)?
  const piAllGames = ["piE1","piE2","piE3","piW1","piW2","piW3"];
  const piDoneCount = piAllGames.filter(k => playInResults?.[k] || activePlayInPicks[k]).length;
  const piComplete  = piDoneCount === piAllGames.length;
  // Scenario tab: only use admin play-in results
  const scenarioPlayInSeeds = resolveEffectiveSeeds({}, playInResults);
  // Admin bracket display: use actual play-in results only
  const adminPlayInSeeds = resolveEffectiveSeeds({}, playInResults);

  // ── Admin: resolve bracket using actual results so later rounds show real team names ──
  const resultsAsPicks = {};
  (Array.isArray(results?.rounds) ? results.rounds : Object.values(results?.rounds || {}))
    .flatMap(r => Array.isArray(r.series) ? r.series : Object.values(r.series || {}))
    .forEach(s => {
      if (s?.id && s?.winner) resultsAsPicks[s.id] = { winner: s.winner, games: s.games };
    });
  const resolvedAdminRoundsRaw = resolveBracket(resultsAsPicks);
  // Apply play-in patches so admin sees correct #7/#8 teams in s1/s2/s5/s6
  const resolvedAdminRounds = resolvedAdminRoundsRaw.map(round => ({
    ...round,
    series: round.series.map(s => applyPlayInPatch(s, adminPlayInSeeds)),
  }));

  if (loading) return (
    <>
      <style>{css}</style>
      <div className="loader">Loading pool data…</div>
    </>
  );

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* ── Header ── */}
        <div className="hdr">
          <div>
            <div className="hdr-title">
              <img src="/basketball.png" alt="" aria-hidden="true"
                style={{width:'2.4rem',height:'2.4rem',marginRight:'16px',verticalAlign:'middle',objectFit:'contain',position:'relative',top:'-2px'}} />
              {BRACKET_CONFIG.sport} <span>Playoff</span> Pool
            </div>
            <div className="hdr-sub">2026 NBA Playoffs · Built & Run by <span style={{color:'var(--gold)', fontWeight:600}}>Nicholas Seikaly</span></div>
          </div>
          <div className="row gap8">
            <span className="live-dot" />
            <span className="xs">{Object.keys(participants).length} participants</span>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {[
            { id:"picks",       label:"My Picks" },
            { id:"leaderboard", label:`Leaderboard (${leaderboard.length})` },
            { id:"scenario",    label:"Scenario" },
            { id:"stats",       label:"Pool Stats" },
            { id:"admin",       label:"⚙ Admin" },
          ].map(t => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => { setTab(t.id); setInfoOpen(false); }}>{t.label}</button>
          ))}
          {/* Info / How-to-Play button — far right of tab bar, hidden on Admin */}
          {tab !== "admin" && (
            <button className="info-btn" style={{marginLeft:'auto', alignSelf:'center', marginBottom:2}} onClick={() => setInfoOpen(o => !o)}>
              <span className="info-btn-icon">ℹ</span> {tab === 'picks' ? 'How to Play' : 'Guide'}
            </button>
          )}
        </div>

        {/* ══ PICKS ══════════════════════════════════════════════════════════ */}
        {tab === "picks" && (
          <div>
            {/* Deadline banner — shown when admin has set a deadline */}
            {deadline && (
              <div style={{
                display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.28)',
                borderRadius:6, padding:'8px 14px', marginBottom:10,
              }}>
                <span style={{
                  fontFamily:"'Bebas Neue',sans-serif", fontSize:'0.82rem',
                  letterSpacing:'2px', color:'var(--gold)', whiteSpace:'nowrap',
                }}>📅 DEADLINE</span>
                <span style={{color:'white', fontSize:'0.78rem', fontWeight:500}}>
                  {formatDeadline(deadline)}
                </span>
              </div>
            )}
            <div className="legend">
              <div style={{display:'flex', gap:20, flexWrap:'wrap', width:'100%'}}>
                <span>R1: Winner <strong>10pts</strong> + Games <strong>5pts</strong></span>
                <span>Conf Semis: Winner <strong>20pts</strong> + Games <strong>5pts</strong></span>
                <span>Conf Finals: Winner <strong>30pts</strong> + Games <strong>10pts</strong></span>
                <span>Finals: Winner <strong>40pts</strong> + Games <strong>10pts</strong></span>
              </div>
              <div style={{display:'flex', gap:24, flexWrap:'wrap', width:'100%', marginTop:6, paddingTop:6, borderTop:'1px solid var(--border)'}}>
                <span>Max possible: <strong>{MAX_POINTS}pts</strong></span>
                <span style={{color:'var(--text3)', fontSize:'0.72rem'}}>Games pts only awarded if winner is correct</span>
              </div>
            </div>

            {/* Entry toggle — switch between Entry 1 and Entry 2.
                Once an entry is submitted, the pill shows the participant's display name. */}
            <div style={{marginBottom:20}}>
              <div className="entry-toggle">
                <button className={`entry-btn ${activeEntry === 1 ? "active" : ""}`}
                  onClick={() => setActiveEntry(1)}
                  disabled={picksLocked && !submitted}>
                  {submitted && myName.trim() ? myName.trim().slice(0,14) : "Entry 1"}
                  {submitted && <span className="entry-check">✓</span>}
                </button>
                <button className={`entry-btn ${activeEntry === 2 ? "active" : ""}`}
                  onClick={() => setActiveEntry(2)}
                  disabled={picksLocked && !submitted2}>
                  {submitted2 && (myName2.trim() || myName.trim())
                    ? (myName2.trim() || myName.trim()).slice(0,14)
                    : "Entry 2"}
                  {submitted2 && <span className="entry-check">✓</span>}
                </button>
              </div>
            </div>

            {picksLocked && (
              <div className="alert alert-locked mb16">
                🔒 Picks are locked — the pool deadline has passed. No new entries or changes are accepted.
              </div>
            )}

            {!picksLocked && isSubmitted && (
              <div className="alert alert-success mb16">
                ✓ Entry {activeEntry} submitted as <strong>
                  {activeEntry === 1 ? myName : (myName2.trim() || myName.trim())}
                </strong>. You can update and resubmit any time before the deadline.
              </div>
            )}

            {/* Play-In tournament banner */}
            {(() => {
              const adminSettled = playInResults && Object.keys(playInResults).length > 0;
              const bannerClass  = adminSettled ? "pi-banner pi-banner-admin"
                                 : piComplete   ? "pi-banner pi-banner-complete"
                                 :                "pi-banner pi-banner-incomplete";
              const titleColor   = adminSettled ? "var(--cyan)"
                                 : piComplete   ? "var(--green)"
                                 :                "var(--gold)";
              const btnLabel     = piComplete || adminSettled ? "✏ Edit Play-In Picks" : "📋 Make Play-In Picks";
              return (
                <div className={bannerClass}>
                  <div>
                    <div className="pi-banner-title" style={{color: titleColor}}>
                      🏀 PLAY-IN TOURNAMENT
                    </div>
                    <div className="pi-banner-sub">
                      {adminSettled
                        ? `Admin has locked play-in results · ${piDoneCount}/6 games settled`
                        : piComplete
                          ? `All ${piAllGames.length} play-in picks complete — R1 matchups unlocked`
                          : `${piDoneCount}/${piAllGames.length} play-in picks made — pick winners to unlock all R1 matchups`}
                    </div>
                  </div>
                  <button className={`btn ${piComplete || adminSettled ? "btn-ghost" : "btn-gold"}`}
                    style={{fontSize:'0.76rem', padding:'8px 18px', flexShrink:0}}
                    onClick={() => setShowPlayIn(true)}>
                    {btnLabel}
                  </button>
                </div>
              );
            })()}

            <div className="bracket-print-wrapper">
              <BracketView picks={activePicks} onPick={handlePick} readOnly={picksLocked} results={results} playInSeeds={activePlayInSeeds} />
            </div>

            {/* Submit */}
            <div className="sec" style={{marginTop:30}}>Submit Entry {activeEntry}</div>
            <div className="form">
              <div className="g2">
                <div>
                  <label className="fl">
                    Your Name{!(activeEntry === 1 ? myName.trim() : (myName2.trim() || myName.trim())) && <span style={{color:'var(--red)',fontWeight:700,marginLeft:3}}>*</span>}
                  </label>
                  <input className="fi" placeholder="e.g. Mike Jordan" maxLength={16}
                    value={activeEntry === 1 ? myName : myName2}
                    onChange={e => activeEntry === 1 ? setMyName(e.target.value) : setMyName2(e.target.value)}
                    disabled={(activeEntry === 1 ? submitted : false) || picksLocked} />
                </div>
                <div>
                  <label className="fl">
                    Email{!(activeEntry === 1 ? myEmail.trim() : (myEmail2.trim() || myEmail.trim())) && <span style={{color:'var(--red)',fontWeight:700,marginLeft:3}}>*</span>}
                  </label>
                  <input className="fi" type="email"
                    placeholder={activeEntry === 2 ? "different email (optional)" : "your@email.com"}
                    value={activeEntry === 1 ? myEmail : myEmail2}
                    onChange={e => activeEntry === 1 ? setMyEmail(e.target.value) : setMyEmail2(e.target.value)}
                    disabled={picksLocked} />
                </div>
              </div>
              <div className="row gap8 wrap">
                <button className="btn btn-gold" onClick={handleSubmit} disabled={!allPicked || !myName.trim() || !(activeEntry===1 ? myEmail.trim() : (myEmail2.trim()||myEmail.trim())) || saving || picksLocked}>
                  {saving ? "Saving…" : isSubmitted ? "Update Entry" : `Submit Entry ${activeEntry}`}
                </button>
                <button className="btn btn-ghost" onClick={() => window.print()} title="Print your picks bracket">
                  🖨 Print Picks
                </button>
                {picksLocked
                  ? <span className="xs" style={{color:"var(--red)"}}>🔒 Picks locked</span>
                  : <span style={{fontWeight:700, color: allPicked ? 'var(--green)' : 'var(--red)'}}>
                      {allPicked ? `✓ ${pickedCount}/${totalSeries} series picked` : `${pickedCount}/${totalSeries} series picked — ${totalSeries - pickedCount} to go`}
                    </span>
                }
              </div>
              {submitError && (
                <div style={{
                  color:'var(--red)', fontSize:'0.76rem', fontWeight:600,
                  marginTop:10, display:'flex', alignItems:'center', gap:5
                }}>
                  ⚠ {submitError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ LEADERBOARD ════════════════════════════════════════════════════ */}
        {tab === "leaderboard" && (
          <div>
            <div className="row between mb16">
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:"1rem", letterSpacing:"2px", color:"var(--text2)"}}>STANDINGS</div>
                <div className="xs muted mt8">{completedCount} of {totalSeries} series complete</div>
              </div>
            </div>

            {picksLocked && (
              <div className="alert alert-info mb16" style={{fontSize:"0.75rem"}}>
                🔒 Picks are locked — tap any entry to view their bracket.
              </div>
            )}

            {leaderboard.length === 0 ? (
              <div className="empty">
                <h3>No Picks Yet</h3>
                <p className="sm">Share the link — be the first to submit!</p>
              </div>
            ) : (
              <div className="lb">
                {leaderboard.map((p, i) => {
                  // Entry 2 rows have id ending in "__2"; derive the base key + isMe for both entries
                  const isEntry2 = p.id?.endsWith('__2');
                  const baseKey  = isEntry2 ? p.id.slice(0, -3) : p.id;
                  const isMe     = baseKey === myKey;
                  const rankClass = isMe ? "me" : "";
                  const displayName = isEntry2 ? (p.name2 || `${p.name} (2)`) : p.name;
                  const canView = picksLocked && p.picks && Object.keys(p.picks).length > 0;
                  const finalsWinner = picksLocked ? (p.picks?.s15?.winner || null) : null;
                  // Shorten long team names to just the nickname (last word)
                  // e.g. "Oklahoma City Thunder" → "Thunder", "New York Knicks" → "Knicks"
                  const shortName = (name) => shortTeamName(name) || "—";
                  return (
                    <div
                      key={p.id}
                      className={`lbr ${rankClass} ${canView ? "clickable" : ""}`}
                      style={{gridTemplateColumns: picksLocked ? '36px 1fr auto auto auto auto auto' : '36px 1fr auto auto auto auto'}}
                      onClick={canView ? () => setViewingEntry(p) : undefined}
                    >
                      <div className="rank">{i + 1}</div>
                      <div>
                        <div className="lbn">
                          {displayName} {isMe && <span className="lbn-you">( you )</span>}
                        </div>
                        <div className="pb">
                          <div className="pbf" style={{width:`${topPts ? (p.points/topPts)*100 : 0}%`}} />
                        </div>
                        {canView && <div className="lbr-view">tap to view picks →</div>}
                      </div>
                      <div className="lb-stat">
                        <div className="lb-stat-val" style={{color:'var(--gold)'}}>{p.points}</div>
                        <div className="lb-stat-lbl">PTS</div>
                      </div>
                      <div className="lb-stat">
                        <div className="lb-stat-val" style={{color:'var(--cyan)', fontSize:'1.4rem'}}>{p.maxPts}</div>
                        <div className="lb-stat-lbl">MAX PTS</div>
                      </div>
                      <div className="lb-stat">
                        <div className="lb-stat-val" style={{color:'var(--green)', fontSize:'1.4rem'}}>{p.correct}</div>
                        <div className="lb-stat-lbl">SERIES ✓</div>
                      </div>
                      <div className="lb-stat">
                        <div className="lb-stat-val" style={{color:'var(--amber)', fontSize:'1.4rem'}}>{p.correctGames}</div>
                        <div className="lb-stat-lbl">GAMES ✓</div>
                      </div>
                      {picksLocked && (
                        <div className="lbr-finals">
                          <div className="lbr-finals-lbl">🏆 Finals Pick</div>
                          {finalsWinner
                            ? (() => {
                                const finalsEliminated = eliminatedTeams.has(finalsWinner);
                                return (
                                  <>
                                    <TeamLogo name={finalsWinner} size={28} state={finalsEliminated ? "wrong" : ""} />
                                    <div className="lbr-finals-team" style={{
                                      color: finalsEliminated ? 'var(--red)' : 'var(--gold2)',
                                      textDecoration: finalsEliminated ? 'line-through' : 'none'
                                    }}>
                                      {shortName(finalsWinner)}
                                    </div>
                                  </>
                                );
                              })()
                            : <div className="lbr-finals-team" style={{color:'var(--text3)'}}>—</div>
                          }
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ SCENARIO ════════════════════════════════════════════════════════ */}
        {tab === "scenario" && (
          <div>
            {!picksLocked ? (
              <div className="empty">
                <h3>Unlocks After Deadline</h3>
                <p className="sm">The Scenario Simulator becomes available once picks are locked by the admin.</p>
              </div>
            ) : (
              <>
                <div className="row between mb16 wrap gap8">
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:"1rem", letterSpacing:"2px", color:"var(--text2)"}}>
                      SCENARIO SIMULATOR
                    </div>
                    <div className="xs muted mt8">Pick hypothetical outcomes for remaining series · see how standings would shift</div>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8}}>
                    <div className="row gap8" style={{flexWrap:'wrap'}}>
                      <button className="btn btn-gold" style={{fontSize:"0.72rem"}} onClick={handleScenarioAutoFill}>↺ Auto-fill My Picks</button>
                      <button className="btn btn-danger" style={{fontSize:"0.72rem"}} onClick={handleScenarioClear}>✕ Clear Scenario</button>
                    </div>
                    {/* Scenario picks counter */}
                    <span style={{
                      fontWeight:700, fontSize:'0.78rem',
                      color: scenarioAllPicked ? 'var(--green)' : 'var(--red)',
                    }}>
                      {scenarioAllPicked
                        ? `✓ ${scenarioPickedCount}/${totalSeries} series picked`
                        : `${scenarioPickedCount}/${totalSeries} series picked — ${totalSeries - scenarioPickedCount} to go`}
                    </span>
                  </div>
                </div>

                {/* Entry toggle — selects which entry's picks are used as ghost reference + auto-fill source */}
                <div style={{marginBottom:20}}>
                  <div className="xs muted" style={{marginBottom:8, letterSpacing:'1px'}}>Viewing picks for:</div>
                  <div className="entry-toggle">
                    <button className={`entry-btn ${scenarioEntry === 1 ? "active" : ""}`}
                      onClick={() => setScenarioEntry(1)}
                      disabled={!submitted}>
                      {submitted && myName.trim() ? myName.trim().slice(0,14) : "Entry 1"}
                      {submitted && <span className="entry-check">✓</span>}
                    </button>
                    <button className={`entry-btn ${scenarioEntry === 2 ? "active" : ""}`}
                      onClick={() => setScenarioEntry(2)}
                      disabled={!submitted2}>
                      {submitted2 && (myName2.trim() || myName.trim())
                        ? (myName2.trim() || myName.trim()).slice(0,14)
                        : "Entry 2"}
                      {submitted2 && <span className="entry-check">✓</span>}
                    </button>
                  </div>
                </div>

                <div className="scenario-layout">
                  {/* Left column: projected leaderboard */}
                  <div className="scenario-lb-col">
                    <div className="xs muted mb8" style={{letterSpacing:"1.5px", textTransform:"uppercase", borderBottom:"1px solid var(--border)", paddingBottom:6}}>
                      Projected Standings
                    </div>
                    <div style={{marginTop:8}}>
                      {scenarioLeaderboard.map((p, i) => {
                        const isEntry2Sc = p.id?.endsWith('__2');
                        const baseKeySc  = isEntry2Sc ? p.id.slice(0, -3) : p.id;
                        const isMe = baseKeySc === myKey;
                        const displayNameSc = isEntry2Sc ? (p.name2 || `${p.name} (2)`) : p.name;
                        const baseEntry = leaderboard.find(b => b.id === p.id);
                        const delta = p.points - (baseEntry?.points || 0);
                        return (
                          <div key={p.id} className={`scenario-lb-row ${isMe ? "me" : ""}`}>
                            <div className="scenario-rank">{i + 1}</div>
                            <div style={{minWidth:0}}>
                              <div className="scenario-name">
                                {displayNameSc}
                                {isMe && <span style={{color:'var(--gold)', marginLeft:4, fontSize:'0.62rem'}}>(you)</span>}
                              </div>
                              {delta !== 0 && (
                                <div style={{fontSize:'0.6rem', color: delta > 0 ? 'var(--green)' : 'var(--red)', fontFamily:"'JetBrains Mono',monospace", marginTop:1}}>
                                  {delta > 0 ? `+${delta}` : delta} pts
                                </div>
                              )}
                            </div>
                            <div className="scenario-pts">{p.points}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right column: scenario bracket */}
                  <div className="scenario-bracket-col">
                    <div className="xs muted mb8" style={{letterSpacing:"1.5px", textTransform:"uppercase", borderBottom:"1px solid var(--border)", paddingBottom:6}}>
                      Scenario Bracket — click to pick remaining series
                    </div>
                    <div style={{marginTop:8}}>
                      <BracketView
                        picks={scenarioPicks}
                        onPick={handleScenarioPick}
                        readOnly={false}
                        results={results}
                        scenarioMode={true}
                        myPicksForScenario={
                          scenarioEntry === 1
                            ? (Object.keys(myPicks).length  > 0 ? myPicks  : (participants[myKey]?.picks  || {}))
                            : (Object.keys(myPicks2).length > 0 ? myPicks2 : (participants[myKey]?.picks2 || {}))
                        }
                        onScenarioPick={handleScenarioPick}
                        playInSeeds={scenarioPlayInSeeds}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ STATS ══════════════════════════════════════════════════════════ */}
        {tab === "stats" && (
          <div>
            <div className="row between mb16">
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:"1rem", letterSpacing:"2px", color:"var(--text2)"}}>POOL STATS</div>
                <div className="xs muted mt8">{completedCount} of {totalSeries} series complete</div>
              </div>
            </div>
            <div className="sg">
              <div className="sc2"><div className="sv">{leaderboard.length}</div><div className="sl">Entries</div></div>
              <div className="sc2"><div className="sv">{completedCount}</div><div className="sl">Series Complete</div></div>
              <div className="sc2"><div className="sv">{leaderboard[0]?.points || 0}</div><div className="sl">Top Score</div></div>
              <div className="sc2">
                <div className="sv">
                  {leaderboard.length ? Math.round(leaderboard.reduce((a,p)=>a+p.points,0)/leaderboard.length) : 0}
                </div>
                <div className="sl">Avg Score</div>
              </div>
            </div>

            {picksLocked ? (
              <>
                {/* ── Selection Breakdown by Round table ── */}
                {statsTotalEntries > 0 && (
                  <div style={{marginBottom:28}}>
                    <div className="sec" style={{marginTop:4}}>Selection Breakdown — By Round</div>
                    <div style={{fontSize:'0.68rem', color:'var(--text3)', marginBottom:10}}>
                      Based on {statsTotalEntries} total {statsTotalEntries === 1 ? "entry" : "entries"}
                    </div>
                    <div className="sbt-wrap">
                      <table className="sbt">
                        <thead>
                          <tr>
                            <th colSpan={11} style={{textAlign:'center', fontSize:'0.82rem', letterSpacing:'3px', borderBottom:'2px solid var(--border2)', paddingTop:11, paddingBottom:11}}>
                              NBA PLAYOFFS SELECTION BREAKDOWN (BY ROUND)
                            </th>
                          </tr>
                          <tr>
                            <th style={{width:28}}></th>
                            <th className="sbt-lh" style={{width:36}}>SEED</th>
                            <th className="sbt-lh">TEAM</th>
                            <th colSpan={2}>1ST ROUND</th>
                            <th colSpan={2}>CONF SEMIS</th>
                            <th colSpan={2}>CONF FINALS</th>
                            <th colSpan={2}>NBA FINALS</th>
                          </tr>
                          <tr>
                            <th></th><th></th><th></th>
                            <th style={{width:28}}>#</th><th style={{minWidth:115}}>%</th>
                            <th style={{width:28}}>#</th><th style={{minWidth:115}}>%</th>
                            <th style={{width:28}}>#</th><th style={{minWidth:115}}>%</th>
                            <th style={{width:28}}>#</th><th style={{minWidth:115}}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[{conf:"East",teams:statsEast},{conf:"West",teams:statsWest}].map(({conf,teams}) =>
                            teams.map((t, idx) => {
                              const sep = conf === "West" && idx === 0;
                              const r = [0,1,2,3].map(ri => {
                                const count = statsCount(t.team, ri, t.r1Id);
                                const pct   = statsTotalEntries > 0 ? count / statsTotalEntries * 100 : 0;
                                return { count, pct };
                              });
                              return (
                                <tr key={t.team}>
                                  {idx === 0 && (
                                    <td rowSpan={teams.length} className={`sbt-conf-cell sbt-conf-${conf}`}>
                                      {conf.toUpperCase()}
                                    </td>
                                  )}
                                  <td className={`sbt-seed${sep?" sbt-sep":""}`}>{conf[0]}{t.seed}</td>
                                  <td className={sep?" sbt-sep":""} style={{whiteSpace:'nowrap'}}>{t.team}</td>
                                  {r.map(({count,pct}, ri) => (
                                    <Fragment key={ri}>
                                      <td className={`sbt-num${sep?" sbt-sep":""}`}>{count}</td>
                                      <td className={`sbt-pct-cell${sep?" sbt-sep":""}`}>
                                        <div style={{display:'flex', alignItems:'center', gap:5}}>
                                          <div className="sbt-bar">
                                            <div className={`sbt-fill-${conf}`} style={{width:`${pct}%`}} />
                                          </div>
                                          <span className="sbt-pct-num">{pct.toFixed(1)}%</span>
                                        </div>
                                      </td>
                                    </Fragment>
                                  ))}
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Per-series pick distribution (existing) ── */}
                {resolvedAdminRounds.map((round) => {
                // Only show series where both teams are known real teams (resolved from admin results)
                const resolvedSeries = round.series.filter(s =>
                  seedFor(s.top, adminPlayInSeeds) !== "" && seedFor(s.bottom, adminPlayInSeeds) !== ""
                );
                if (resolvedSeries.length === 0) return null;

                return (
                  <div key={round.id}>
                    <div className="sec">{round.name} — Pick Distribution</div>
                    {resolvedSeries.map((series) => {
                      const rs = getAdminResultForSeries(results, series.id);
                      const total   = allStatsEntries.length;
                      const pickTop = allStatsEntries.filter(picks => picks[series.id]?.winner === series.top).length;
                      const pickBot = allStatsEntries.filter(picks => picks[series.id]?.winner === series.bottom).length;
                      // My pick labels — Entry 1 (gold) and Entry 2 (cyan)
                      const myPick1Winner = myPicks?.[series.id]?.winner;
                      const myPick2Winner = myPicks2?.[series.id]?.winner;
                      const entry1Label   = myName.trim()  || "Entry 1";
                      const entry2Label   = myName2.trim() || (myName.trim() ? `${myName.trim()} (2)` : "Entry 2");

                      return (
                        <div key={series.id} style={{marginBottom:14}}>
                          {/* Matchup label */}
                          <div style={{display:'flex', alignItems:'center', gap:7, marginBottom:5}}>
                            <span className={`conf conf-${series.conference}`}>{series.conference}</span>
                            {series.topSeed != null && (
                              <span className="xs mono muted">{series.topSeed} vs {series.bottomSeed}</span>
                            )}
                          </div>
                          {[
                            { team: series.top, count: pickTop },
                            { team: series.bottom, count: pickBot }
                          ].map(({ team, count }) => {
                            const pct      = total ? Math.round((count / total) * 100) : 0;
                            const isWinner = rs?.winner === team;
                            const isPick1  = myPick1Winner === team && submitted;
                            const isPick2  = myPick2Winner === team && submitted2;
                            return (
                              <div key={team} className="pr">
                                <span style={{color: isWinner ? "var(--green)" : "var(--text2)"}}>
                                  {team} {isWinner && "✓"}
                                  {isPick1 && (
                                    <span style={{fontSize:'0.6rem', color:'var(--gold)', fontFamily:"'JetBrains Mono',monospace", marginLeft:5, fontWeight:600}}>
                                      ← {entry1Label}
                                    </span>
                                  )}
                                  {isPick2 && (
                                    <span style={{fontSize:'0.6rem', color:'var(--cyan)', fontFamily:"'JetBrains Mono',monospace", marginLeft: isPick1 ? 8 : 5, fontWeight:600}}>
                                      ← {entry2Label}
                                    </span>
                                  )}
                                </span>
                                <div className="pbw"><div className="pbi" style={{width:`${pct}%`}} /></div>
                                <span className="pct">{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              </>
            ) : (
              <div className="empty">
                <h3>POOL STATS AVAILABLE AFTER DEADLINE</h3>
                <p className="sm">Pool Stats populate once the deadline has passed and the admin has locked picks.</p>
              </div>
            )}

            {picksLocked && completedCount === 0 && (
              <div className="empty" style={{marginTop:0}}>
                <h3>No Results Yet</h3>
                <p className="sm">Winner data will appear as series complete</p>
              </div>
            )}
          </div>
        )}

        {/* ══ ADMIN ══════════════════════════════════════════════════════════ */}
        {tab === "admin" && !adminAuthed && (
          <div className="admin-gate">
            <div className="admin-gate-icon">🔒</div>
            <div className="admin-gate-title">Admin Access</div>
            <div className="admin-gate-sub">Sign in with your admin account</div>
            <input
              className="fi" type="email" placeholder="Email" style={{marginBottom:8}}
              value={adminEmail} onChange={e => { setAdminEmail(e.target.value); setAdminLoginError(""); }}
              onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
              autoFocus
            />
            <div className="admin-gate-row">
              <div className="pw-wrap">
                <input
                  className="fi" type={showAdminPass ? "text" : "password"} placeholder="Password"
                  value={adminPass} onChange={e => { setAdminPass(e.target.value); setAdminLoginError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
                />
                <button type="button" className="pw-eye" tabIndex={-1}
                  onClick={() => setShowAdminPass(v => !v)}
                  aria-label={showAdminPass ? "Hide password" : "Show password"}>
                  {showAdminPass
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              <button className="btn btn-gold" onClick={handleAdminLogin}>Sign In</button>
            </div>
            <div className="admin-gate-err">{adminLoginError}</div>
          </div>
        )}

        {tab === "admin" && adminAuthed && (
          <div>
            {/* Admin header row — signed-in indicator + sign out */}
            <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center',
              gap:10, marginBottom:14}}>
              <span style={{fontSize:'0.72rem', color:'var(--text3)', letterSpacing:'0.5px'}}>
                {auth?.currentUser?.email && `Signed in as ${auth.currentUser.email}`}
              </span>
              <button className="btn" style={{fontSize:'0.72rem', padding:'5px 14px'}}
                onClick={handleAdminLogout}>
                Sign Out
              </button>
            </div>
            {/* Lock toggle */}
            <div className={`lock-card ${picksLocked ? "locked" : "unlocked"}`}>
              <div className="lock-info">
                <div className="lock-title">{picksLocked ? "🔒 Picks Locked" : "✓ Picks Open"}</div>
                <div className="lock-desc">
                  {picksLocked
                    ? "Pool is closed — participants cannot enter or change picks."
                    : "Pool is open — participants can enter and update their picks."}
                </div>
              </div>
              <div className="toggle-wrap">
                <span className="toggle-lbl">{picksLocked ? "Locked" : "Open"}</span>
                <label className="toggle">
                  <input type="checkbox" checked={picksLocked} onChange={handleToggleLock} />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
              </div>
            </div>

            {/* ── Deadline editor ── */}
            <div style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:8, padding:'14px 18px', marginBottom:16,
            }}>
              <div className="sec" style={{marginBottom:14}}>Submission Deadline</div>
              <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end'}}>
                <div>
                  <label className="fl" style={{marginBottom:4}}>Date</label>
                  <input type="date" className="fi" style={{maxWidth:170}}
                    value={adminDeadlineDate}
                    onChange={e => setAdminDeadlineDate(e.target.value)} />
                </div>
                <div>
                  <label className="fl" style={{marginBottom:4}}>Time</label>
                  <input type="time" className="fi" style={{maxWidth:130}}
                    value={adminDeadlineTime}
                    onChange={e => setAdminDeadlineTime(e.target.value)} />
                </div>
                <button className="btn btn-gold" style={{fontSize:'0.76rem', alignSelf:'flex-end'}}
                  onClick={handleSaveDeadline}>
                  Save Deadline
                </button>
              </div>
              {deadline && (
                <div className="xs muted" style={{marginTop:10}}>
                  Current deadline: <strong style={{color:'var(--gold)'}}>{formatDeadline(deadline)}</strong>
                </div>
              )}
            </div>

            {/* ── Play-In Tournament Results ── */}
            <div style={{
              background:'var(--surface)', border:'1px solid rgba(201,168,76,0.3)',
              borderRadius:8, padding:'14px 18px', marginBottom:16,
            }}>
              <div className="sec" style={{marginBottom:12, color:'var(--gold)'}}>
                🏀 Play-In Tournament Results
              </div>
              <div className="xs muted" style={{marginBottom:14}}>
                Set actual play-in winners. These override participant play-in picks and lock the #7/#8 seed slots for everyone.
              </div>
              {["East","West"].map(conf => {
                const cfg = PLAY_IN_CONFIG[conf];
                const pfx = conf === "East" ? "piE" : "piW";
                const g1Id = `${pfx}1`, g2Id = `${pfx}2`, g3Id = `${pfx}3`;
                const confColor = conf === "East" ? "rgba(123,159,245,0.85)" : "rgba(251,146,60,0.85)";
                const g3t = getGame3Teams(conf, {}, playInResults);
                const games = [
                  {
                    id: g1Id,
                    label: `Game 1 — ${conf}ern #7 Seed`,
                    desc:  `Winner advances as #7 seed`,
                    top:   cfg.seed7, bottom: cfg.seed8
                  },
                  {
                    id: g2Id,
                    label: `Game 2 — ${conf}ern #9 vs #10`,
                    desc:  `Winner advances to Game 3`,
                    top:   cfg.seed9, bottom: cfg.seed10
                  },
                  {
                    id: g3Id,
                    label: `Game 3 — ${conf}ern #8 Seed`,
                    desc:  `Winner advances as #8 seed`,
                    top:   g3t.top   || "Loser of Game 1",
                    bottom: g3t.bottom || "Winner of Game 2",
                    disabled: !g3t.ready,
                  },
                ];
                return (
                  <div key={conf} style={{marginBottom:12}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:'0.72rem',
                      letterSpacing:'2.5px', color: confColor, marginBottom:8}}>
                      {conf}ern Conference
                    </div>
                    {games.map(game => (
                      <div key={game.id} className="asc" style={{marginBottom:6, opacity: game.disabled ? 0.4 : 1}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap'}}>
                          <div>
                            <div className="xs" style={{color:'var(--text2)', fontWeight:600}}>{game.label}</div>
                            <div className="xs muted" style={{marginTop:2}}>{game.desc}</div>
                          </div>
                          <div className="arow" style={{margin:0}}>
                            <select className="sel" style={{minWidth:180}}
                              value={playInResults?.[game.id] || ""}
                              disabled={game.disabled}
                              onChange={e => handleAdminPlayIn(game.id, e.target.value)}>
                              <option value="">— TBD —</option>
                              {game.top    && <option value={game.top}>{game.top}</option>}
                              {game.bottom && <option value={game.bottom}>{game.bottom}</option>}
                            </select>
                            {playInResults?.[game.id] && (
                              <span className="xs green mono">✓ {shortTeamName(playInResults[game.id])}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="alert alert-warn mb16">
              ⚠ Admin panel — enter series results here. Standings update automatically for all users.
            </div>

            {resolvedAdminRounds.map((round, ri) => {
              const resultRound = results?.rounds?.[ri];
              return (
                <div key={round.id}>
                  <div className="sec">{round.name}</div>
                  {round.series.map((series, si) => {
                    const rs = resultRound?.series?.[si] || {};
                    const merged = { ...series, winner: rs.winner || null, games: rs.games || null };
                    return (
                      <div key={series.id} className="asc">
                        <AdminControl series={merged} result={rs} onAdminSet={handleAdminSet} />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:28, marginBottom:10}}>
              <div className="sec" style={{margin:0, flex:1}}>Participant Entries</div>
              <button className="btn btn-ghost" style={{fontSize:"0.7rem", flexShrink:0, marginLeft:14}} onClick={handleExport}>
                ↓ Export CSV
              </button>
            </div>
            {leaderboard.length === 0 ? (
              <div className="empty" style={{paddingTop:20}}><p className="sm muted">No entries yet</p></div>
            ) : (
              <div style={{background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, padding:18}}>
                {[...leaderboard]
                  .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, {sensitivity:'base'}))
                  .map((p, i, arr) => {
                    const paid = participants[p.id]?.paid || false;
                    const isMe = sanitize(p.name || '') === myKey;
                    return (
                      <div key={p.id} style={{display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"11px 0", borderBottom: i < arr.length-1 ? "1px solid var(--border)" : "none",
                        background: isMe ? "rgba(148,163,184,0.04)" : "transparent",
                        borderRadius: isMe ? 4 : 0,
                        marginLeft: isMe ? -8 : 0,
                        marginRight: isMe ? -8 : 0,
                        paddingLeft: isMe ? 8 : 0,
                        paddingRight: isMe ? 8 : 0,
                      }}>
                        <div style={{display:'flex', alignItems:'center', gap:8, minWidth:0}}>
                          <div>
                            <div style={{display:'flex', alignItems:'center', gap:6}}>
                              <span className="sm" style={{color: isMe ? '#b4c4d4' : 'var(--text)'}}>{p.name}</span>
                              {isMe && <span style={{fontSize:'0.58rem', color:'#94a3b8', letterSpacing:'1px', textTransform:'uppercase', fontFamily:"'JetBrains Mono',monospace"}}>you</span>}
                            </div>
                            {p.email && <div className="xs muted" style={{marginTop:1}}>{p.email}</div>}
                          </div>
                        </div>
                        <div className="row gap8" style={{alignItems:"center", flexShrink:0}}>
                          <span className="xs muted mono">{Object.values(p.picks||{}).filter(pk=>pk.winner&&pk.games).length}/{totalSeries} picks</span>
                          <span className="sm gold mono">{p.points}pts</span>
                          <span className="xs muted">{p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : ""}</span>
                          <label style={{display:"flex", alignItems:"center", gap:5, cursor:"pointer", userSelect:"none", marginLeft:4}}>
                            <input
                              type="checkbox"
                              checked={paid}
                              onChange={() => handlePaidToggle(p.id, paid)}
                              style={{accentColor:"var(--green)", width:14, height:14, cursor:"pointer"}}
                            />
                            <span className="xs" style={{color: paid ? "var(--green)" : "var(--text3)"}}>Paid</span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ PICKS OVERLAY ══════════════════════════════════════════════════ */}
      {viewingEntry && (() => {
        const ep     = viewingEntry;
        const epPicked = Object.values(ep.picks || {}).filter(pk => pk.winner && pk.games).length;
        return (
          <div className="ov-backdrop" onClick={e => { if (e.target === e.currentTarget) setViewingEntry(null); }}>
            <div className="ov-modal" style={{maxWidth:1380}}>
              {/* Header */}
              <div className="ov-hdr">
                <div className="ov-hdr-left">
                  <div className="ov-title">{ep.name}'s Picks</div>
                  <div className="ov-sub">{epPicked}/{totalSeries} picks · {BRACKET_CONFIG.season}</div>
                </div>
                <button className="ov-close" onClick={() => setViewingEntry(null)}>✕</button>
              </div>

              {/* Score summary bar */}
              <div className="ov-body">
                <div className="ov-score-row">
                  <div className="ov-score-item">
                    <div className="ov-score-val">{ep.points}</div>
                    <div className="ov-score-lbl">Points</div>
                  </div>
                  <div className="ov-score-item">
                    <div className="ov-score-val" style={{color:"var(--cyan)"}}>{ep.maxPts}</div>
                    <div className="ov-score-lbl">Max Possible</div>
                  </div>
                  <div className="ov-score-item">
                    <div className="ov-score-val" style={{color:"var(--green)"}}>{ep.correct}</div>
                    <div className="ov-score-lbl">Correct</div>
                  </div>
                </div>

                {/* Bracket view — read-only */}
                <BracketView picks={ep.picks || {}} readOnly results={results}
                  playInSeeds={resolveEffectiveSeeds(ep.playInPicks || {}, playInResults)} />
              </div>
            </div>
          </div>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}

      {/* ══ PLAY-IN MODAL ═══════════════════════════════════════════════════ */}
      {showPlayIn && (
        <PlayInModal
          activeEntry={activeEntry}
          playInPicks={playInPicks}
          playInPicks2={playInPicks2}
          playInResults={playInResults}
          onPick={handlePlayInPick}
          onClose={() => setShowPlayIn(false)}
        />
      )}

      {/* ══ INFO / HOW TO PLAY PANEL ════════════════════════════════════════ */}
      {infoOpen && <InfoModal tab={tab} onClose={() => setInfoOpen(false)} />}
    </>
  );
}
