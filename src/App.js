import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update } from "firebase/database";
import { db } from "./firebase";
import { BRACKET_CONFIG, GAME_OPTIONS, MAX_POINTS } from "./bracketConfig";
import { buildLeaderboard, calcPoints, maxPossible } from "./scoring";
import { TeamLogo } from "./teamLogos";

// ─── Seed lookup (team name → playoff seed) built from R1 config ─────────────
const TEAM_SEEDS = {};
BRACKET_CONFIG.rounds[0].series.forEach(s => {
  if (s.topSeed    != null) TEAM_SEEDS[s.top]    = s.topSeed;
  if (s.bottomSeed != null) TEAM_SEEDS[s.bottom] = s.bottomSeed;
});

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

  /* Tabs */
  .tabs { display:flex; border-bottom:1px solid var(--border); margin:20px 0 28px; }
  .tab { padding:13px 22px; font-size:0.75rem; letter-spacing:2px; text-transform:uppercase; font-weight:600;
    color:var(--text2); cursor:pointer; border:none; background:none; border-bottom:2px solid transparent;
    transition:all 0.2s; position:relative; top:1px; }
  .tab:hover { color:var(--text); }
  .tab.active { color:var(--gold); border-bottom-color:var(--gold); }

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
  .sc.done { border-left:2px solid var(--green); }
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
  .lbr { display:grid; grid-template-columns:38px 1fr auto auto; gap:12px; align-items:center;
    background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:12px 16px; transition:border-color 0.2s; }
  .lbr:hover { border-color:var(--border2); }
  .lbr.r1 { border-color:rgba(201,168,76,0.4); background:rgba(201,168,76,0.05); }
  .lbr.r2 { border-color:rgba(148,163,184,0.25); }
  .lbr.r3 { border-color:rgba(205,127,50,0.25); }
  .lbr.me { border-color:rgba(45,212,191,0.35) !important; }
  .rank { font-family:'Bebas Neue',sans-serif; font-size:1.35rem; color:var(--text3); }
  .r1 .rank { color:var(--gold2); }
  .r2 .rank { color:#94a3b8; }
  .r3 .rank { color:#cd7f32; }
  .lbn { font-weight:600; font-size:0.88rem; }
  .pb { height:3px; background:var(--border); border-radius:2px; margin-top:5px; overflow:hidden; width:100%; }
  .pbf { height:100%; background:linear-gradient(90deg,var(--gold),var(--amber)); border-radius:2px; transition:width 0.6s; }
  .pts { font-family:'Bebas Neue',sans-serif; font-size:1.5rem; color:var(--gold); line-height:1; }
  .ptsl { font-size:0.6rem; color:var(--text3); letter-spacing:1px; }
  .lbmeta { font-size:0.7rem; color:var(--text3); text-align:right; line-height:1.7; }
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
  .brk-round-hdr { font-family:'Bebas Neue',sans-serif; font-size:0.65rem; letter-spacing:2.5px;
    color:var(--text3); text-transform:uppercase; text-align:center; padding:0 0 8px;
    white-space:nowrap; }
  .brk-hdr-pts { display:block; font-family:'JetBrains Mono',monospace; font-size:0.58rem; letter-spacing:1px;
    color:var(--gold); margin-top:2px; font-weight:400; }

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
  .bm.done { border-left:2px solid var(--green); }

  .bm-hdr { display:flex; align-items:center; justify-content:space-between; padding:5px 10px;
    background:var(--surface3); border-bottom:1px solid var(--border); }
  .bm-conf { font-size:0.55rem; letter-spacing:1.5px; font-weight:700; text-transform:uppercase; }
  .bm-conf.East { color:#7b9ff5; }
  .bm-conf.West { color:#fb923c; }
  .bm-conf.Finals { color:var(--gold2); }
  .bm-result { font-size:0.55rem; font-family:'JetBrains Mono',monospace; color:var(--green); letter-spacing:0.3px; }

  /* Team button rows */
  .bm-team { display:flex; align-items:center; gap:8px; padding:9px 10px; cursor:pointer;
    border:none; background:none; width:100%; text-align:left; color:var(--text2);
    transition:all 0.15s; border-bottom:1px solid var(--border); position:relative; }
  .bm-team:last-of-type { border-bottom:none; }
  .bm-team:hover:not(:disabled) { background:rgba(201,168,76,0.06); color:var(--gold); }
  .bm-team:disabled { cursor:default; }
  .bm-team.sel   { background:rgba(201,168,76,0.1); color:var(--gold2); }
  .bm-team.ok    { background:rgba(34,197,94,0.1); color:var(--green); }
  .bm-team.wrong { background:rgba(239,68,68,0.11); color:rgba(239,68,68,0.72); }
  .bm-team.wrong .bm-logo { opacity:0.5; filter:grayscale(0.35) saturate(0.6); }
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
  .bm-ps.ok { color:var(--cyan); }
  .bm-ps.pending { color:var(--text3); }

  /* Finals label */
  .brk-finals-label { display:flex; flex-direction:column; align-items:center;
    justify-content:center; padding-bottom:10px; }
  .brk-finals-icon { font-size:1.1rem; line-height:1; margin-bottom:2px; }

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
function cleanDownstreamPicks(picks) {
  let cleaned = picks;
  for (let pass = 0; pass < 3; pass++) {
    const resolved = resolveBracket(cleaned);
    for (const round of resolved) {
      for (const series of round.series) {
        const pick = cleaned[series.id];
        if (pick?.winner && pick.winner !== series.top && pick.winner !== series.bottom) {
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
  const result  = results?.rounds?.flatMap(r => r.series)?.find(s => s.id === series.id);
  const settled = result?.winner != null;

  // Seed resolution — works for any round once teams are known
  const topSeed    = TEAM_SEEDS[series.top];
  const bottomSeed = TEAM_SEEDS[series.bottom];
  const showSeedVs = topSeed != null && bottomSeed != null;

  const pickWinner = (team) => { if (!readOnly && !adminMode) onPick(series.id, { ...pick, winner: team }); };
  const pickGames  = (g)    => { if (!readOnly && !adminMode) onPick(series.id, { ...pick, games: g }); };

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
    <div className={`sc ${settled ? "done" : ""}`}>
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
              {topSeed != null && <span className="tbtn-seed">#{topSeed}</span>}
            </button>
            <span className="vs">vs</span>
            <button className={`tbtn ${teamClass(series.bottom)}`} onClick={() => pickWinner(series.bottom)} disabled={readOnly}>
              <span className="tbtn-logo"><TeamLogo name={series.bottom} size={46} state={teamClass(series.bottom)} /></span>
              <span className="tbtn-name">{series.bottom}</span>
              {bottomSeed != null && <span className="tbtn-seed">#{bottomSeed}</span>}
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

function BracketMatchup({ series, round, picks, onPick, readOnly, results, isFinals }) {
  const pick   = picks?.[series.id] || {};
  const result = results?.rounds?.flatMap(r => r.series)?.find(s => s.id === series.id);
  const settled = result?.winner != null;

  const topSeed    = TEAM_SEEDS[series.top];
  const bottomSeed = TEAM_SEEDS[series.bottom];

  const pickWinner = (team) => {
    if (!readOnly) {
      // clicking the already-selected team deselects it (and clears games)
      const next = pick.winner === team ? { ...pick, winner: undefined, games: undefined } : { ...pick, winner: team };
      onPick?.(series.id, next);
    }
  };
  const pickGames = (g) => {
    if (!readOnly) {
      // clicking the already-selected games count deselects it
      const next = pick.games === g ? { ...pick, games: undefined } : { ...pick, games: g };
      onPick?.(series.id, next);
    }
  };

  const teamClass = (team) => {
    if (pick.winner !== team) return "";
    if (settled) return pick.winner === result.winner ? "ok" : "wrong";
    return "sel";
  };

  const gamesClass = (g) => {
    if (pick.games !== g) return "";
    if (!settled) return "sel";
    // Winner correct + exact games = green
    if (pick.winner === result.winner && pick.games === result.games) return "exact";
    // Winner correct but games wrong = still gold (partial credit style)
    if (pick.winner === result.winner) return "sel";
    // Winner wrong = red games button
    return "wrong-games";
  };

  const hasPick = pick.winner && pick.games;
  const resultName = settled ? shortTeamName(result.winner) : "";

  return (
    <div className={`bm ${settled ? "done" : ""}`}>
      <div className="bm-hdr">
        <span className={`bm-conf ${series.conference}`}>{series.conference}</span>
        {settled && <span className="bm-result">✓ {resultName} in {result.games}</span>}
      </div>
      <button className={`bm-team ${teamClass(series.top)}`} onClick={() => pickWinner(series.top)} disabled={readOnly}>
        <span className="bm-logo"><TeamLogo name={series.top} size={26} state={teamClass(series.top)} /></span>
        <span className="bm-name">{series.top}</span>
        {topSeed != null && <span className="bm-seed">#{topSeed}</span>}
      </button>
      <button className={`bm-team ${teamClass(series.bottom)}`} onClick={() => pickWinner(series.bottom)} disabled={readOnly}>
        <span className="bm-logo"><TeamLogo name={series.bottom} size={26} state={teamClass(series.bottom)} /></span>
        <span className="bm-name">{series.bottom}</span>
        {bottomSeed != null && <span className="bm-seed">#{bottomSeed}</span>}
      </button>
      <div className="bm-games">
        <span className="bm-gl">G</span>
        {GAME_OPTIONS.map(g => (
          <button key={g} className={`bm-gbtn ${gamesClass(g)}`} onClick={() => pickGames(g)} disabled={readOnly}>{g}</button>
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
  HDR_H:         40,  // round header row height above bracket
};

// Given an array of source-card top-px, return centered top-px for each parent (per consecutive pair)
function nextRoundTops(srcTops, cardH) {
  const out = [];
  for (let i = 0; i < srcTops.length; i += 2) {
    out.push((srcTops[i] + srcTops[i + 1] + cardH) / 2 - cardH / 2);
  }
  return out;
}

function BracketView({ picks, onPick, readOnly, results }) {
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
  const resolvedRounds = resolveBracket(picks || {});
  const seriesMap = {}, roundMap = {};
  resolvedRounds.forEach(round => round.series.forEach(s => {
    seriesMap[s.id] = s;
    roundMap[s.id]  = round;
  }));

  // ── Card renderer ─────────────────────────────────────────────────────────
  function renderCard(sid, topPx, col) {
    const series = seriesMap[sid];
    if (!series) return null;
    const round = roundMap[sid];
    const resultRound = results?.rounds?.find(r => r.id === round?.id);
    const si = round?.series?.findIndex(s => s.id === sid);
    const rs = resultRound?.series?.[si];
    const merged = { ...series, winner: rs?.winner ?? null, games: rs?.games ?? null };
    return (
      <div key={sid} style={{position:'absolute', top: topPx, left: cx(col), width: CARD_W}}>
        <BracketMatchup
          series={merged} round={round} picks={picks || {}}
          onPick={onPick} readOnly={readOnly} results={results}
          isFinals={sid === "s15"}
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

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,       setTab]       = useState("picks");
  const [results,   setResults]   = useState(null);       // from Firebase
  const [participants, setParticipants] = useState({});   // from Firebase
  const [myPicks,   setMyPicks]   = useState({});
  const [myName,    setMyName]    = useState(() => localStorage.getItem("pool_name") || "");
  const [myEmail,   setMyEmail]   = useState("");
  const [submitted, setSubmitted] = useState(() => localStorage.getItem("pool_submitted") === "1");
  const [toast,       setToast]       = useState("");
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [adminAuthed,  setAdminAuthed]  = useState(false);
  const [adminPass,    setAdminPass]    = useState("");
  const [picksLocked,  setPicksLocked]  = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);  // participant whose picks are open in overlay
  const toastTimer = useRef(null);

  // ── Firebase listeners ──
  useEffect(() => {
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

    // Load my own saved picks
    const savedName = localStorage.getItem("pool_name");
    if (savedName) {
      const unsubMe = onValue(ref(db, `participants/${sanitize(savedName)}/picks`), snap => {
        if (snap.exists()) setMyPicks(snap.val());
      });
      return () => { unsubResults(); unsubParticipants(); unsubLock(); unsubMe(); };
    }

    return () => { unsubResults(); unsubParticipants(); unsubLock(); };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  };

  // Sanitize name for use as Firebase key (no special chars)
  function sanitize(name) { return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"); }

  // ── Picks ──
  const handlePick = (seriesId, pick) =>
    setMyPicks(prev => cleanDownstreamPicks({ ...prev, [seriesId]: pick }));

  const totalSeries  = BRACKET_CONFIG.rounds.flatMap(r => r.series).length;
  const pickedCount  = Object.values(myPicks).filter(p => p.winner && p.games).length;
  const allPicked    = pickedCount === totalSeries;

  // ── Submit ──
  const handleSubmit = async () => {
    if (!myName.trim()) return showToast("Please enter your name first");
    if (!myEmail.trim()) return showToast("Please enter your email address");
    if (!allPicked)     return showToast(`Complete all ${totalSeries} picks first`);
    setSaving(true);
    try {
      const key = sanitize(myName);
      await set(ref(db, `participants/${key}`), {
        name:        myName.trim(),
        email:       myEmail.trim(),
        picks:       myPicks,
        submittedAt: Date.now(),
      });
      localStorage.setItem("pool_name", myName.trim());
      localStorage.setItem("pool_submitted", "1");
      setSubmitted(true);
      showToast("🏆 Picks submitted!");
      setTab("leaderboard");
    } catch (e) {
      showToast("Error saving — check Firebase config");
      console.error(e);
    }
    setSaving(false);
  };

  // ── Admin: password gate ──
  const handleAdminLogin = () => {
    if (adminPass === "NBA") {
      setAdminAuthed(true);
      setAdminPass("");
    } else {
      showToast("Incorrect password");
      setAdminPass("");
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
  const leaderboard = buildLeaderboard(participants, results);
  const topPts      = leaderboard[0]?.points || 1;
  const myKey       = sanitize(myName);

  // ── Pool stats ──
  const completedCount = (results?.rounds || []).flatMap(r => r.series).filter(s => s.winner).length;

  // ── Admin: resolve bracket using actual results so later rounds show real team names ──
  const resultsAsPicks = {};
  (results?.rounds || []).flatMap(r => r.series || []).forEach(s => {
    if (s?.id && s?.winner) resultsAsPicks[s.id] = { winner: s.winner, games: s.games };
  });
  const resolvedAdminRounds = resolveBracket(resultsAsPicks);

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
            <div className="hdr-title">{BRACKET_CONFIG.sport} <span>Playoff</span> Pool</div>
            <div className="hdr-sub">2026 NBA Playoffs · Run by <span style={{color:'var(--gold)', fontWeight:600}}>Nicholas Seikaly</span></div>
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
            { id:"leaderboard", label:`Leaderboard (${Object.keys(participants).length})` },
            { id:"stats",       label:"Pool Stats" },
            { id:"admin",       label:"⚙ Admin" },
          ].map(t => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {/* ══ PICKS ══════════════════════════════════════════════════════════ */}
        {tab === "picks" && (
          <div>
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

            {picksLocked && (
              <div className="alert alert-locked mb16">
                🔒 Picks are locked — the pool deadline has passed. No new entries or changes are accepted.
              </div>
            )}

            {!picksLocked && submitted && (
              <div className="alert alert-success mb16">
                ✓ Picks submitted as <strong>{myName}</strong>. You can update and resubmit any time before the deadline.
              </div>
            )}

            <BracketView picks={myPicks} onPick={handlePick} readOnly={picksLocked} results={results} />

            {/* Submit */}
            <div className="sec" style={{marginTop:30}}>Submit Your Picks</div>
            <div className="form">
              <div className="g2">
                <div>
                  <label className="fl">Your Name *</label>
                  <input className="fi" placeholder="e.g. Mike Jordan" value={myName} onChange={e => setMyName(e.target.value)} disabled={submitted || picksLocked} />
                </div>
                <div>
                  <label className="fl">Email *</label>
                  <input className="fi" type="email" placeholder="your@email.com" value={myEmail} onChange={e => setMyEmail(e.target.value)} disabled={picksLocked} />
                </div>
              </div>
              <div className="row gap8 wrap">
                <button className="btn btn-gold" onClick={handleSubmit} disabled={!allPicked || !myName.trim() || !myEmail.trim() || saving || picksLocked}>
                  {saving ? "Saving…" : submitted ? "Update Picks" : "Submit Picks"}
                </button>
                {picksLocked
                  ? <span className="xs" style={{color:"var(--red)"}}>🔒 Picks locked</span>
                  : <><span className="sm muted">{pickedCount}/{totalSeries} series picked</span>
                    {!allPicked && <span className="xs muted">({totalSeries - pickedCount} to go)</span>}</>
                }
              </div>
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
                  const isMe = sanitize(p.name || "") === myKey;
                  const rankClass = isMe ? "me" : i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
                  const canView = picksLocked && p.picks && Object.keys(p.picks).length > 0;
                  const finalsWinner = picksLocked ? (p.picks?.s15?.winner || null) : null;
                  // Shorten long team names to just the nickname (last word)
                  // e.g. "Oklahoma City Thunder" → "Thunder", "New York Knicks" → "Knicks"
                  const shortName = (name) => shortTeamName(name) || "—";
                  return (
                    <div
                      key={p.id}
                      className={`lbr ${rankClass} ${canView ? "clickable" : ""}`}
                      style={picksLocked ? {gridTemplateColumns:'38px 1fr auto auto auto'} : {}}
                      onClick={canView ? () => setViewingEntry(p) : undefined}
                    >
                      <div className="rank">{i + 1}</div>
                      <div>
                        <div className="lbn">
                          {p.name} {isMe && <span className="xs cyan">(you)</span>}
                        </div>
                        <div className="pb">
                          <div className="pbf" style={{width:`${topPts ? (p.points/topPts)*100 : 0}%`}} />
                        </div>
                        {canView && <div className="lbr-view">tap to view picks →</div>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div className="pts">{p.points}</div>
                        <div className="ptsl">PTS</div>
                      </div>
                      <div className="lbmeta">
                        <div>Max: <span className="mono cyan">{p.maxPts}</span></div>
                        <div>Correct: <span className="mono green">{p.correct}</span></div>
                      </div>
                      {picksLocked && (
                        <div className="lbr-finals">
                          <div className="lbr-finals-lbl">🏆 Finals Pick</div>
                          {finalsWinner
                            ? <>
                                <TeamLogo name={finalsWinner} size={28} state="" />
                                <div className="lbr-finals-team">{shortName(finalsWinner)}</div>
                              </>
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

        {/* ══ STATS ══════════════════════════════════════════════════════════ */}
        {tab === "stats" && (
          <div>
            <div className="sg">
              <div className="sc2"><div className="sv">{Object.keys(participants).length}</div><div className="sl">Participants</div></div>
              <div className="sc2"><div className="sv">{completedCount}</div><div className="sl">Series Complete</div></div>
              <div className="sc2"><div className="sv">{leaderboard[0]?.points || 0}</div><div className="sl">Top Score</div></div>
              <div className="sc2">
                <div className="sv">
                  {leaderboard.length ? Math.round(leaderboard.reduce((a,p)=>a+p.points,0)/leaderboard.length) : 0}
                </div>
                <div className="sl">Avg Score</div>
              </div>
            </div>

            {BRACKET_CONFIG.rounds.map((round, ri) => {
              const resultRound = results?.rounds?.[ri];
              const completedSeries = round.series.filter((_, si) => resultRound?.series?.[si]?.winner);
              if (completedSeries.length === 0) return null;

              return (
                <div key={round.id}>
                  <div className="sec">{round.name} — Pick Distribution</div>
                  {round.series.map((series, si) => {
                    const rs = resultRound?.series?.[si];
                    if (!rs?.winner) return null;
                    const total = Object.keys(participants).length;
                    const pickTop = Object.values(participants).filter(p => p.picks?.[series.id]?.winner === series.top).length;
                    const pickBot = Object.values(participants).filter(p => p.picks?.[series.id]?.winner === series.bottom).length;

                    return [
                      { team: series.top, count: pickTop },
                      { team: series.bottom, count: pickBot }
                    ].map(({ team, count }) => {
                      const pct = total ? Math.round((count/total)*100) : 0;
                      return (
                        <div key={team} className="pr">
                          <span style={{color: rs.winner === team ? "var(--green)" : "var(--text2)"}}>
                            {team} {rs.winner === team && "✓"}
                          </span>
                          <div className="pbw"><div className="pbi" style={{width:`${pct}%`}} /></div>
                          <span className="pct">{pct}%</span>
                        </div>
                      );
                    });
                  })}
                </div>
              );
            })}

            {completedCount === 0 && (
              <div className="empty"><h3>No Results Yet</h3><p className="sm">Stats appear as series finish</p></div>
            )}
          </div>
        )}

        {/* ══ ADMIN ══════════════════════════════════════════════════════════ */}
        {tab === "admin" && !adminAuthed && (
          <div className="admin-gate">
            <div className="admin-gate-icon">🔒</div>
            <div className="admin-gate-title">Admin Access</div>
            <div className="admin-gate-sub">Enter password to continue</div>
            <div className="admin-gate-row">
              <input
                className="fi" type="password" placeholder="Password"
                value={adminPass} onChange={e => setAdminPass(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
                autoFocus
              />
              <button className="btn btn-gold" onClick={handleAdminLogin}>Enter</button>
            </div>
          </div>
        )}

        {tab === "admin" && adminAuthed && (
          <div>
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

            <div className="sec" style={{marginTop:28}}>Participant Entries</div>
            {leaderboard.length === 0 ? (
              <div className="empty" style={{paddingTop:20}}><p className="sm muted">No entries yet</p></div>
            ) : (
              <div style={{background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, padding:18}}>
                {leaderboard.map((p, i) => (
                  <div key={p.id} style={{display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"10px 0", borderBottom: i < leaderboard.length-1 ? "1px solid var(--border)" : "none"}}>
                    <div>
                      <span className="sm">{p.name}</span>
                      {p.email && <span className="xs muted" style={{marginLeft:8}}>{p.email}</span>}
                    </div>
                    <div className="row gap8">
                      <span className="xs muted mono">{Object.values(p.picks||{}).filter(pk=>pk.winner&&pk.games).length}/{totalSeries} picks</span>
                      <span className="sm gold mono">{p.points}pts</span>
                      <span className="xs muted">{p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : ""}</span>
                    </div>
                  </div>
                ))}
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
                <BracketView picks={ep.picks || {}} readOnly results={results} />
              </div>
            </div>
          </div>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
