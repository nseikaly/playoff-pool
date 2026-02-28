import { BRACKET_CONFIG } from "./bracketConfig";

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
    const gamesPoints = roundConfig?.gamesPoints || 0;
    return seriesArray.map(s => ({ ...s, winnerPoints, gamesPoints }));
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
        potential += round.winnerPoints + round.gamesPoints;
      } else if (pick.winner === resultSeries.winner) {
        // Won — count what was earned
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
