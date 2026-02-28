import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, update } from "firebase/database";
import { db } from "./firebase";
import { BRACKET_CONFIG, GAME_OPTIONS, MAX_POINTS } from "./bracketConfig";
import { buildLeaderboard, calcPoints, maxPossible } from "./scoring";
import { TeamLogo } from "./teamLogos";

// ─── CSS ─────────────────────────────────────────────────────────────────────

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#080c12; --surface:#0e1420; --surface2:#141b28; --surface3:#1b2435;
    --border:#1e2a3a; --border2:#243040; --gold:#c9a84c; --gold2:#f0c65a;
    --amber:#e8943a; --cyan:#2dd4bf; --red:#ef4444; --green:#22c55e;
    --text:#e8edf5; --text2:#8a9ab0; --text3:#4a5a70;
  }
  body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; }
  .app { max-width:1100px; margin:0 auto; padding:0 16px 80px; }

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
  .tbtn { padding:14px 8px 12px; background:var(--surface3); border:1px solid var(--border2); border-radius:8px;
    color:var(--text2); cursor:pointer; transition:all 0.18s; text-align:center; font-weight:500;
    display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; }
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
`;

// ─── Series Card ──────────────────────────────────────────────────────────────

function SeriesCard({ series, round, picks, onPick, readOnly, adminMode, results, onAdminSet }) {
  const pick    = picks?.[series.id] || {};
  const result  = results?.rounds?.flatMap(r => r.series)?.find(s => s.id === series.id);
  const settled = result?.winner != null;

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
        <span className={`conf conf-${series.conference}`}>{series.conference}</span>
        <span className="mult">{round.winnerPoints}+{round.gamesPoints}pts</span>
        {settled && (
          <span className="xs mono green">✓ {result.winner} in {result.games}</span>
        )}
      </div>

      {adminMode ? (
        <AdminControl series={series} result={result} onAdminSet={onAdminSet} />
      ) : (
        <>
          <div className="teams">
            <button className={`tbtn ${teamClass(series.top)}`}    onClick={() => pickWinner(series.top)}    disabled={readOnly}>
              <span className="tbtn-logo"><TeamLogo name={series.top}    size={46} state={teamClass(series.top)}    /></span>
              <span className="tbtn-name">{series.top}</span>
            </button>
            <span className="vs">vs</span>
            <button className={`tbtn ${teamClass(series.bottom)}`} onClick={() => pickWinner(series.bottom)} disabled={readOnly}>
              <span className="tbtn-logo"><TeamLogo name={series.bottom} size={46} state={teamClass(series.bottom)} /></span>
              <span className="tbtn-name">{series.bottom}</span>
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

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,       setTab]       = useState("picks");
  const [results,   setResults]   = useState(null);       // from Firebase
  const [participants, setParticipants] = useState({});   // from Firebase
  const [myPicks,   setMyPicks]   = useState({});
  const [myName,    setMyName]    = useState(() => localStorage.getItem("pool_name") || "");
  const [myEmail,   setMyEmail]   = useState("");
  const [submitted, setSubmitted] = useState(() => localStorage.getItem("pool_submitted") === "1");
  const [toast,     setToast]     = useState("");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const toastTimer = useRef(null);

  // ── Firebase listeners ──
  useEffect(() => {
    // Listen to results (admin sets these)
    const unsubResults = onValue(ref(db, "results"), snap => {
      if (snap.exists()) setResults(snap.val());
      else setResults(BRACKET_CONFIG); // default: use bracket config as skeleton
      setLoading(false);
    });

    // Listen to all participants
    const unsubParticipants = onValue(ref(db, "participants"), snap => {
      setParticipants(snap.exists() ? snap.val() : {});
    });

    // Load my own saved picks
    const savedName = localStorage.getItem("pool_name");
    if (savedName) {
      const unsubMe = onValue(ref(db, `participants/${sanitize(savedName)}/picks`), snap => {
        if (snap.exists()) setMyPicks(snap.val());
      });
      return () => { unsubResults(); unsubParticipants(); unsubMe(); };
    }

    return () => { unsubResults(); unsubParticipants(); };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  };

  // Sanitize name for use as Firebase key (no special chars)
  function sanitize(name) { return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"); }

  // ── Picks ──
  const handlePick = (seriesId, pick) => setMyPicks(prev => ({ ...prev, [seriesId]: pick }));

  const totalSeries  = BRACKET_CONFIG.rounds.flatMap(r => r.series).length;
  const pickedCount  = Object.values(myPicks).filter(p => p.winner && p.games).length;
  const allPicked    = pickedCount === totalSeries;

  // ── Submit ──
  const handleSubmit = async () => {
    if (!myName.trim()) return showToast("Please enter your name first");
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
            <div className="hdr-sub">{BRACKET_CONFIG.season} · Live standings</div>
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
              <span>R1: Winner <strong>10pts</strong> + Games <strong>5pts</strong></span>
              <span>Semis: Winner <strong>20pts</strong> + Games <strong>5pts</strong></span>
              <span>Conf Finals: Winner <strong>30pts</strong> + Games <strong>10pts</strong></span>
              <span>Finals: Winner <strong>40pts</strong> + Games <strong>10pts</strong></span>
              <span className="text-xs text-muted">(Games points only awarded if winner is correct)</span>
              <span>Max possible: <strong>{MAX_POINTS}pts</strong></span>
            </div>

            {submitted && (
              <div className="alert alert-success mb16">
                ✓ Picks submitted as <strong>{myName}</strong>. You can update and resubmit any time before series start.
              </div>
            )}

            {BRACKET_CONFIG.rounds.map(round => {
              // Get matching results round
              const resultRound = results?.rounds?.find(r => r.id === round.id);
              return (
                <div key={round.id}>
                  <div className="sec">{round.name} <span className="xs mono">{round.winnerPoints}+{round.gamesPoints}pts</span></div>
                  <div className="series-grid">
                    {round.series.map((series, si) => {
                      // Merge result data into series for display
                      const rs = resultRound?.series?.[si] || series;
                      const merged = { ...series, winner: rs.winner, games: rs.games };
                      return (
                        <SeriesCard
                          key={series.id} series={merged} round={round}
                          picks={myPicks} onPick={handlePick}
                          results={results}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Submit */}
            <div className="sec" style={{marginTop:30}}>Submit Your Picks</div>
            <div className="form">
              <div className="g2">
                <div>
                  <label className="fl">Your Name *</label>
                  <input className="fi" placeholder="e.g. Mike Jordan" value={myName} onChange={e => setMyName(e.target.value)} disabled={submitted} />
                </div>
                <div>
                  <label className="fl">Email (optional)</label>
                  <input className="fi" type="email" placeholder="for updates" value={myEmail} onChange={e => setMyEmail(e.target.value)} />
                </div>
              </div>
              <div className="row gap8 wrap">
                <button className="btn btn-gold" onClick={handleSubmit} disabled={!allPicked || !myName.trim() || saving}>
                  {saving ? "Saving…" : submitted ? "Update Picks" : "Submit Picks"}
                </button>
                <span className="sm muted">{pickedCount}/{totalSeries} series picked</span>
                {!allPicked && <span className="xs muted">({totalSeries - pickedCount} to go)</span>}
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
                  return (
                    <div key={p.id} className={`lbr ${rankClass}`}>
                      <div className="rank">{i + 1}</div>
                      <div>
                        <div className="lbn">
                          {p.name} {isMe && <span className="xs cyan">(you)</span>}
                        </div>
                        <div className="pb">
                          <div className="pbf" style={{width:`${topPts ? (p.points/topPts)*100 : 0}%`}} />
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div className="pts">{p.points}</div>
                        <div className="ptsl">PTS</div>
                      </div>
                      <div className="lbmeta">
                        <div>Max: <span className="mono cyan">{p.maxPts}</span></div>
                        <div>Correct: <span className="mono green">{p.correct}</span></div>
                      </div>
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
        {tab === "admin" && (
          <div>
            <div className="alert alert-warn mb16">
              ⚠ Admin panel — enter series results here. Standings update automatically for all users.
            </div>

            {BRACKET_CONFIG.rounds.map((round, ri) => {
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

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
