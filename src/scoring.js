import { BRACKET_CONFIG } from "./bracketConfig";

const { correctWinner, exactGames } = BRACKET_CONFIG.scoring;

// Get a flat list of all series from results object
export function allSeries(results) {
  if (!results?.rounds) return [];
  
  // Firebase stores arrays as objects with numeric keys, so convert them
  const roundsArray = Array.isArray(results.rounds) ? results.rounds : Object.values(results.rounds);
  
  return roundsArray.flatMap((r, roundIdx) => {
    const seriesArray = Array.isArray(r.series) ? r.series : Object.values(r.series || {});
    // Get multiplier from BRACKET_CONFIG since Firebase doesn't store it
    const multiplier = BRACKET_CONFIG.rounds[roundIdx]?.multiplier || 1;
    return seriesArray.map(s => ({ ...s, multiplier }));
  });
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
  if (!picks) return 0;
  let potential = 0;
  
  // Loop through ALL series in the bracket (not just ones with results)
  BRACKET_CONFIG.rounds.forEach(round => {
    round.series.forEach(series => {
      const pick = picks[series.id];
      if (!pick?.winner) return; // No pick = no potential
      
      // Find if this series has a result
      const resultSeries = allSeries(results).find(s => s.id === series.id);
      
      if (!resultSeries?.winner) {
        // Series not done yet — full points still possible
        potential += (correctWinner + exactGames) * round.multiplier;
      } else if (pick.winner === resultSeries.winner) {
        // Won — count what was earned
        potential += correctWinner * round.multiplier;
        if (pick.games === resultSeries.games) {
          potential += exactGames * round.multiplier;
        }
      }
      // Wrong pick = 0 potential
    });
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
