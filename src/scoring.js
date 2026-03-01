import { BRACKET_CONFIG } from "./bracketConfig";

// ─── Bracket feed map ─────────────────────────────────────────────────────────
// Maps each later-round series to the two earlier-round series whose winners feed into it.
// Mirrors FEEDS_FROM in App.js — kept in sync manually.
const FEEDS_FROM = {
  s9:  { top: "s1",  bottom: "s4"  },   // East Semis: (1) vs (4/5)
  s10: { top: "s2",  bottom: "s3"  },   // East Semis: (2) vs (3/6)
  s11: { top: "s5",  bottom: "s8"  },   // West Semis: (1) vs (4/5)
  s12: { top: "s6",  bottom: "s7"  },   // West Semis: (2) vs (3/6)
  s13: { top: "s9",  bottom: "s10" },   // East Finals
  s14: { top: "s11", bottom: "s12" },   // West Finals
  s15: { top: "s13", bottom: "s14" },   // NBA Finals
};

// Get a flat list of all series from results object
export function allSeries(results) {
  if (!results?.rounds) return [];

  // Firebase stores arrays as objects with numeric keys, so convert them
  const roundsArray = Array.isArray(results.rounds) ? results.rounds : Object.values(results.rounds);

  return roundsArray.flatMap((r, roundIdx) => {
    const seriesArray = Array.isArray(r.series) ? r.series : Object.values(r.series || {});
    // Get scoring from BRACKET_CONFIG since Firebase doesn't store it
    const roundConfig = BRACKET_CONFIG.rounds[roundIdx];
    const winnerPoints = roundConfig?.winnerPoints || 0;
    const gamesPoints  = roundConfig?.gamesPoints  || 0;
    return seriesArray.map(s => ({ ...s, winnerPoints, gamesPoints }));
  });
}

// Build a map of seriesId → winner from results
function buildResultWinners(results) {
  const winners = {};
  if (!results?.rounds) return winners;
  const roundsArr = Array.isArray(results.rounds) ? results.rounds : Object.values(results.rounds);
  roundsArr.forEach(r => {
    const seriesArr = Array.isArray(r.series) ? r.series : Object.values(r.series || {});
    seriesArr.forEach(s => { if (s?.id && s?.winner) winners[s.id] = s.winner; });
  });
  return winners;
}

// Get the set of all teams that have been eliminated based on current results.
// R1 losers are identified via BRACKET_CONFIG team names.
// Later-round losers are identified via FEEDS_FROM + known R1/later winners.
export function getEliminatedTeams(results) {
  const eliminated = new Set();
  if (!results) return eliminated;

  const resultWinners = buildResultWinners(results);

  // R1: team names are fixed in BRACKET_CONFIG — find losers directly
  BRACKET_CONFIG.rounds[0].series.forEach(s => {
    const winner = resultWinners[s.id];
    if (winner) {
      const loser = winner === s.top ? s.bottom : s.top;
      if (loser) eliminated.add(loser);
    }
  });

  // R2–R4: use FEEDS_FROM to resolve which teams played each series,
  // then add the loser to the eliminated set
  ["s9","s10","s11","s12","s13","s14","s15"].forEach(sid => {
    const winner = resultWinners[sid];
    if (!winner) return;
    const feed = FEEDS_FROM[sid];
    if (!feed) return;
    const topTeam    = resultWinners[feed.top];
    const bottomTeam = resultWinners[feed.bottom];
    if (topTeam    && topTeam    !== winner) eliminated.add(topTeam);
    if (bottomTeam && bottomTeam !== winner) eliminated.add(bottomTeam);
  });

  return eliminated;
}

// Calculate earned points for a set of picks against known results
export function calcPoints(picks, results) {
  if (!picks || !results) return 0;
  let total = 0;
  allSeries(results).forEach(series => {
    if (!series.winner) return;
    const pick = picks[series.id];
    if (!pick?.winner) return;

    // Only award points if winner is correct
    if (pick.winner === series.winner) {
      total += series.winnerPoints;
      // Bonus for exact games ONLY if winner was correct
      if (pick.games === series.games) {
        total += series.gamesPoints;
      }
    }
  });
  return total;
}

// Calculate max points still achievable.
// Excludes future series where the picked team has already been eliminated.
export function maxPossible(picks, results) {
  if (!picks) return 0;

  const eliminatedTeams = getEliminatedTeams(results);
  let potential = 0;

  // Loop through ALL series in the bracket (not just ones with results)
  BRACKET_CONFIG.rounds.forEach(round => {
    round.series.forEach(series => {
      const pick = picks[series.id];
      if (!pick?.winner) return; // No pick = no potential

      // Find if this series has a result
      const resultSeries = allSeries(results).find(s => s.id === series.id);

      if (!resultSeries?.winner) {
        // Series not done yet — only count if team is still alive
        if (!eliminatedTeams.has(pick.winner)) {
          potential += round.winnerPoints + round.gamesPoints;
        }
      } else if (pick.winner === resultSeries.winner) {
        // Correct winner — count earned points
        potential += round.winnerPoints;
        if (pick.games === resultSeries.games) {
          potential += round.gamesPoints;
        }
      }
      // Wrong pick = 0 potential
    });
  });

  return potential;
}

// Count how many series a participant got the winner correct
export function countCorrect(picks, results) {
  if (!picks || !results) return 0;
  return allSeries(results).filter(s => s.winner && picks[s.id]?.winner === s.winner).length;
}

// Count how many series a participant got BOTH winner AND games correct
export function countCorrectGames(picks, results) {
  if (!picks || !results) return 0;
  return allSeries(results).filter(s =>
    s.winner && s.games &&
    picks[s.id]?.winner === s.winner &&
    picks[s.id]?.games  === s.games
  ).length;
}

// Build the leaderboard from a participants map
export function buildLeaderboard(participants, results) {
  return Object.entries(participants || {})
    .map(([id, p]) => ({
      id, ...p,
      points:       calcPoints(p.picks, results),
      maxPts:       maxPossible(p.picks, results),
      correct:      countCorrect(p.picks, results),
      correctGames: countCorrectGames(p.picks, results),
    }))
    .sort((a, b) => b.points - a.points || b.maxPts - a.maxPts);
}
