// ─── Team Logos ───────────────────────────────────────────────────────────────
// Inline SVG badges — no image files needed. Add or edit teams below.

const TEAMS = {
  // ── East ──────────────────────────────────────────────────────────────────
  "Boston Celtics":         { abbr:"BOS", primary:"#007A33", secondary:"#BA9653" },
  "Miami Heat":             { abbr:"MIA", primary:"#98002E", secondary:"#F9A01B" },
  "Milwaukee Bucks":        { abbr:"MIL", primary:"#00471B", secondary:"#EEE1C6" },
  "Indiana Pacers":         { abbr:"IND", primary:"#002D62", secondary:"#FDBB30" },
  "Cleveland Cavaliers":    { abbr:"CLE", primary:"#6F2633", secondary:"#FFB81C" },
  "Orlando Magic":          { abbr:"ORL", primary:"#0077C0", secondary:"#FFFFFF" },
  "New York Knicks":        { abbr:"NYK", primary:"#006BB6", secondary:"#F58426" },
  "Philadelphia 76ers":     { abbr:"PHI", primary:"#006BB6", secondary:"#ED174C" },
  // ── West ──────────────────────────────────────────────────────────────────
  "Oklahoma City Thunder":  { abbr:"OKC", primary:"#007AC1", secondary:"#EF3B24" },
  "New Orleans Pelicans":   { abbr:"NOP", primary:"#0C2340", secondary:"#C8102E" },
  "Denver Nuggets":         { abbr:"DEN", primary:"#0E2240", secondary:"#FEC524" },
  "LA Lakers":              { abbr:"LAL", primary:"#552583", secondary:"#FDB927" },
  "Minnesota Timberwolves": { abbr:"MIN", primary:"#0C2340", secondary:"#78BE20" },
  "Phoenix Suns":           { abbr:"PHX", primary:"#1D1160", secondary:"#E56020" },
  "LA Clippers":            { abbr:"LAC", primary:"#C8102E", secondary:"#BEC0C2" },
  "Dallas Mavericks":       { abbr:"DAL", primary:"#00538C", secondary:"#B8C4CA" },
};

// Returns { primary, secondary } for a team name, with a dark fallback for TBD teams.
export function getTeamColors(name) {
  return TEAMS[name] || { primary:"#1b2435", secondary:"#4a5a70" };
}

// ─── TeamLogo Component ───────────────────────────────────────────────────────
// Renders an inline SVG badge. `state` mirrors the tbtn class: "sel"|"ok"|"wrong"|""
export function TeamLogo({ name, size = 46, state = "" }) {
  const team = TEAMS[name];

  // Fallback badge for TBD/future-round placeholders
  if (!team) {
    return (
      <svg
        width={size} height={size}
        viewBox="0 0 60 60"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="30" cy="30" r="28" fill="#141b28" />
        <circle cx="30" cy="30" r="26" fill="none" stroke="#243040" strokeWidth="2" />
        <text
          x="30" y="35"
          fontFamily="'DM Sans','Arial',sans-serif"
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill="#4a5a70"
          letterSpacing="0.5"
        >TBD</text>
      </svg>
    );
  }

  const { abbr, primary, secondary } = team;

  // Ring colour shifts with selection state to reinforce the button's own border colour
  const ringColor =
    state === "ok"    ? "#22c55e" :
    state === "wrong" ? "#ef4444" :
    state === "sel"   ? "#f0c65a" :
    secondary;

  const ringWidth = state ? 2.5 : 1.8;

  // Font size scales slightly for 4-char abbrs
  const fontSize = abbr.length >= 4 ? 12.5 : 15;

  return (
    <svg
      width={size} height={size}
      viewBox="0 0 60 60"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={name}
    >
      {/* Subtle dark outer rim for depth */}
      <circle cx="30" cy="30" r="29" fill="rgba(0,0,0,0.35)" />

      {/* Primary colour fill */}
      <circle cx="30" cy="30" r="27" fill={primary} />

      {/* Inner accent ring */}
      <circle
        cx="30" cy="30" r="24"
        fill="none"
        stroke={ringColor}
        strokeWidth={ringWidth}
        opacity={state ? "0.95" : "0.6"}
      />

      {/* Team abbreviation */}
      <text
        x="30" y="36"
        fontFamily="'Arial Black','Impact','Arial',sans-serif"
        fontSize={fontSize}
        fontWeight="900"
        textAnchor="middle"
        fill={secondary}
        letterSpacing="0.8"
      >
        {abbr}
      </text>
    </svg>
  );
}
