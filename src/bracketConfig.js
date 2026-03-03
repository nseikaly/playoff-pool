// ─── BRACKET CONFIG ───────────────────────────────────────────────────────────
// To reuse for a new season or sport: edit the values below.
// - Change sport, season, and the team names in rounds[0].series
// - Later rounds auto-populate labels once results are entered

export const BRACKET_CONFIG = {
  sport:  "NBA",
  season: "2026 NBA Playoffs",

  rounds: [
    {
      id: "r1", name: "First Round",
      winnerPoints: 10,
      gamesPoints: 5,
      series: [
        { id:"s1",  top:"Boston Celtics",          bottom:"Miami Heat",           conference:"East", topSeed:1, bottomSeed:8 },
        { id:"s2",  top:"Milwaukee Bucks",          bottom:"Indiana Pacers",       conference:"East", topSeed:2, bottomSeed:7 },
        { id:"s3",  top:"Cleveland Cavaliers",      bottom:"Orlando Magic",        conference:"East", topSeed:3, bottomSeed:6 },
        { id:"s4",  top:"New York Knicks",          bottom:"Philadelphia 76ers",   conference:"East", topSeed:4, bottomSeed:5 },
        { id:"s5",  top:"Oklahoma City Thunder",    bottom:"New Orleans Pelicans", conference:"West", topSeed:1, bottomSeed:8 },
        { id:"s6",  top:"Denver Nuggets",           bottom:"LA Lakers",            conference:"West", topSeed:2, bottomSeed:7 },
        { id:"s7",  top:"Minnesota Timberwolves",   bottom:"Phoenix Suns",         conference:"West", topSeed:3, bottomSeed:6 },
        { id:"s8",  top:"LA Clippers",              bottom:"Dallas Mavericks",     conference:"West", topSeed:4, bottomSeed:5 },
      ]
    },
    {
      id: "r2", name: "Conference Semifinals",
      winnerPoints: 20,
      gamesPoints: 5,
      series: [
        { id:"s9",  top:"East R1 Winner (1/8)", bottom:"East R1 Winner (4/5)", conference:"East" },
        { id:"s10", top:"East R1 Winner (2/7)", bottom:"East R1 Winner (3/6)", conference:"East" },
        { id:"s11", top:"West R1 Winner (1/8)", bottom:"West R1 Winner (4/5)", conference:"West" },
        { id:"s12", top:"West R1 Winner (2/7)", bottom:"West R1 Winner (3/6)", conference:"West" },
      ]
    },
    {
      id: "r3", name: "Conference Finals",
      winnerPoints: 30,
      gamesPoints: 10,
      series: [
        { id:"s13", top:"East Semifinal Winner A", bottom:"East Semifinal Winner B", conference:"East" },
        { id:"s14", top:"West Semifinal Winner A", bottom:"West Semifinal Winner B", conference:"West" },
      ]
    },
    {
      id: "r4", name: "NBA Finals",
      winnerPoints: 40,
      gamesPoints: 10,
      series: [
        { id:"s15", top:"Eastern Champion", bottom:"Western Champion", conference:"Finals" },
      ]
    }
  ]
};

export const GAME_OPTIONS = [4, 5, 6, 7];

// Max points possible in the pool
export const MAX_POINTS = BRACKET_CONFIG.rounds.reduce((acc, r) =>
  acc + r.series.length * (r.winnerPoints + r.gamesPoints), 0
);

// ─── Play-In Tournament Config ────────────────────────────────────────────────
// The four teams that compete in the Play-In to determine the #7 and #8 seeds.
// seed7/seed8 are already seeded into the main bracket; the play-in decides
// whether they keep those slots or are replaced by seed9/seed10.
export const PLAY_IN_CONFIG = {
  East: {
    seed7:  "Indiana Pacers",
    seed8:  "Miami Heat",
    seed9:  "Chicago Bulls",
    seed10: "Detroit Pistons",
  },
  West: {
    seed7:  "LA Lakers",
    seed8:  "New Orleans Pelicans",
    seed9:  "San Antonio Spurs",
    seed10: "Sacramento Kings",
  },
};

// Maps each play-in seed slot to the R1 series + slot it fills.
// The #7 and #8 seeds always occupy the "bottom" slot in their respective R1 matchups.
export const PLAY_IN_SLOTS = {
  E7: "s2",  // East #2 (Milwaukee Bucks) vs East #7 seed
  E8: "s1",  // East #1 (Boston Celtics)  vs East #8 seed
  W7: "s6",  // West #2 (Denver Nuggets)  vs West #7 seed
  W8: "s5",  // West #1 (OKC Thunder)     vs West #8 seed
};
