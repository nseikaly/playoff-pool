// ─── BRACKET CONFIG ───────────────────────────────────────────────────────────
// To reuse for a new season or sport: edit the values below.
// - Change sport, season, and the team names in rounds[0].series
// - Later rounds auto-populate labels once results are entered

export const BRACKET_CONFIG = {
  sport:  "NBA",
  season: "2025 Playoffs",

  rounds: [
    {
      id: "r1", name: "First Round",
      winnerPoints: 10,
      gamesPoints: 5,
      series: [
        { id:"s1",  top:"Boston Celtics",          bottom:"Miami Heat",           conference:"East" },
        { id:"s2",  top:"Milwaukee Bucks",          bottom:"Indiana Pacers",       conference:"East" },
        { id:"s3",  top:"Cleveland Cavaliers",      bottom:"Orlando Magic",        conference:"East" },
        { id:"s4",  top:"New York Knicks",          bottom:"Philadelphia 76ers",   conference:"East" },
        { id:"s5",  top:"Oklahoma City Thunder",    bottom:"New Orleans Pelicans", conference:"West" },
        { id:"s6",  top:"Denver Nuggets",           bottom:"LA Lakers",            conference:"West" },
        { id:"s7",  top:"Minnesota Timberwolves",   bottom:"Phoenix Suns",         conference:"West" },
        { id:"s8",  top:"LA Clippers",              bottom:"Dallas Mavericks",     conference:"West" },
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
