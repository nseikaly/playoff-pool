import { BRACKET_CONFIG } from "./bracketConfig";

const { correctWinner, exactGames } = BRACKET_CONFIG.scoring;

// Calculate earned points for a set of picks against known results
export function calcPoints(picks, results) {
  if (!picks || !results) return 0;
  let total = 0;
  
  BRACKET_CONFIG.rounds.forEach(round => {
    round.series.forEach(series => {
      const result = results[series.id];
      if (!result?.winner) return;
      
      const pick = picks[series.id];
      if (!pick?.winner) return;
      
      if (pick.winner === result.winner) {
        total += correctWinner * round.multiplier;
        if (pick.games === result.games) total += exactGames * round.multiplier;
      }
    });
  });
  
  return total;
}

// Calculate max points still achievable (earned + potential from incomplete series)
export function maxPossible(picks, results) {
  if (!picks || !results) return 0;
  let potential = 0;
  
  BRACKET_CONFIG.rounds.forEach(round => {
    round.series.forEach(series => {
      const pick = picks[series.id];
      if (!pick?.winner) return;
      
      const result = results[series.id];
      if (!result?.winner) {
        // Series not done yet — full points still possible
        potential += (correctWinner + exactGames) * round.multiplier;
      } else if (pick.winner === result.winner) {
        // Won — count what was earned
        potential += correctWinner * round.multiplier;
        if (pick.games === result.games) potential += exactGames * round.multiplier;
      }
      // Wrong pick = 0 potential
    });
  });
  
  return potential;
}

// Count how many series a participant got right
export function countCorrect(picks, results) {
  if (!picks || !results) return 0;
  let count = 0;
  
  BRACKET_CONFIG.rounds.forEach(round => {
    round.series.forEach(series => {
      const result = results[series.id];
      if (result?.winner && picks[series.id]?.winner === result.winner) {
        count++;
      }
    });
  });
  
  return count;
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
