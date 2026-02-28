import { BRACKET_CONFIG } from "./bracketConfig";

const { correctWinner, exactGames } = BRACKET_CONFIG.scoring;

// Get a flat list of all series from results object
export function allSeries(results) {
  return (results?.rounds || []).flatMap(r => r.series.map(s => ({ ...s, multiplier: r.multiplier })));
}

// Calculate earned points for a set of picks against known results
export function calcPoints(picks, results) {
  if (!picks || !results) return 0;
  let total = 0;
  allSeries(results).forEach(series => {
    if (!series.winner) return;
    const pick = picks[series.id];
    if (!pick?.winner) return;
    if (pick.winner === series.winner) {
      total += correctWinner * series.multiplier;
      if (pick.games === series.games) total += exactGames * series.multiplier;
    }
  });
  return total;
}

// Calculate max points still achievable (earned + potential from incomplete series)
export function maxPossible(picks, results) {
  if (!picks || !results) return 0;
  let potential = 0;
  allSeries(results).forEach(series => {
    const pick = picks[series.id];
    if (!pick?.winner) return;
    if (!series.winner) {
      // Series not done yet — full points still possible
      potential += (correctWinner + exactGames) * series.multiplier;
    } else if (pick.winner === series.winner) {
      // Won — count what was earned
      potential += correctWinner * series.multiplier;
      if (pick.games === series.games) potential += exactGames * series.multiplier;
    }
    // Wrong pick = 0 potential
  });
  return potential;
}

// Count how many series a participant got right
export function countCorrect(picks, results) {
  if (!picks || !results) return 0;
  return allSeries(results).filter(s => s.winner && picks[s.id]?.winner === s.winner).length;
}

// Build the leaderboard from a participants map
export function buildLeaderboard(participants, results) {
  return Object.entries(participants || {})
    .map(([id, p]) => ({
      id, ...p,
      points:  calcPoints(p.picks, results),
      maxPts:  maxPossible(p.picks, results),
      correct: countCorrect(p.picks, results),
    }))
    .sort((a, b) => b.points - a.points || b.maxPts - a.maxPts);
}
