import { US_TILE_GRID, US_STATES } from "../lib/geoRegions";

// Clickable schematic US map (state tile grid). Used with the "United States"
// nationwide option: every state starts green (targeted); clicking a state
// turns it red (excluded). Built for affiliate marketers who must block
// restricted states.

const TILE = 34;
const GAP = 3;

export default function USStateTileMap({ excluded = [], onToggleState }) {
  const excludedSet = new Set(excluded);
  const cols = 12;
  const rows = 8;
  const width = cols * (TILE + GAP);
  const height = rows * (TILE + GAP);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-xl" role="group" aria-label="US map — click a state to exclude it">
      {Object.entries(US_TILE_GRID).map(([code, [col, row]]) => {
        const isExcluded = excludedSet.has(code);
        const x = col * (TILE + GAP);
        const y = row * (TILE + GAP);
        return (
          <g
            key={code}
            onClick={() => onToggleState && onToggleState(code)}
            className="cursor-pointer"
            role="button"
            aria-label={`${US_STATES[code]} — ${isExcluded ? "excluded (click to target)" : "targeted (click to exclude)"}`}
          >
            <title>{`${US_STATES[code]}: ${isExcluded ? "Excluded — never market here" : "Targeted"}`}</title>
            <rect
              x={x}
              y={y}
              width={TILE}
              height={TILE}
              rx="5"
              fill={isExcluded ? "#7f1d1d" : "#14532d"}
              stroke={isExcluded ? "#ef4444" : "#22c55e"}
              strokeWidth="1.5"
            />
            <text
              x={x + TILE / 2}
              y={y + TILE / 2 + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill={isExcluded ? "#fca5a5" : "#86efac"}
              style={{ pointerEvents: "none" }}
            >
              {code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
