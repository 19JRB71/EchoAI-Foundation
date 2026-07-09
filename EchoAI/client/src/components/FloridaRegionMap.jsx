// Small stylized Florida map. Selected regions are highlighted so the owner
// gets visual confirmation of their coverage. Overlapping regions (e.g. East
// Coast + North) blend via opacity. Purely visual — clicks happen on the
// region checkboxes next to the map.

// Rough region overlays, clipped to the Florida silhouette below.
const REGION_SHAPES = {
  FL_PANHANDLE: "M0,10 H46 V34 H0 Z",
  FL_NORTH: "M0,10 H78 V38 H0 Z",
  FL_CENTRAL: "M30,38 H90 V64 H30 Z",
  FL_SOUTH: "M40,64 H100 V100 H40 Z",
  FL_EAST_COAST: "M52,10 L72,10 L98,100 L74,100 Z",
  FL_WEST_COAST: "M0,10 L20,10 L20,26 L52,26 L80,100 L56,100 L36,44 L0,34 Z",
};

// Stylized Florida silhouette (panhandle + peninsula).
const FL_OUTLINE =
  "M2,14 H48 V10 H62 L68,20 L74,34 L80,48 L86,62 L90,76 L88,88 L82,96 L73,94 L66,84 L60,70 L54,56 L48,42 L44,32 H30 L2,30 Z";

export default function FloridaRegionMap({ selected = [] }) {
  const active = new Set(selected);
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-36 w-36 shrink-0"
      role="img"
      aria-label={`Florida map${active.size ? ` — highlighted: ${[...active].join(", ")}` : ""}`}
    >
      <defs>
        <clipPath id="fl-clip">
          <path d={FL_OUTLINE} />
        </clipPath>
      </defs>
      <path d={FL_OUTLINE} fill="#1f2937" stroke="#4b5563" strokeWidth="1.5" />
      <g clipPath="url(#fl-clip)">
        {Object.entries(REGION_SHAPES).map(([code, d]) =>
          active.has(code) ? (
            <path key={code} d={d} fill="#3b82f6" opacity="0.55" />
          ) : null
        )}
      </g>
      <path d={FL_OUTLINE} fill="none" stroke="#6b7280" strokeWidth="1" />
    </svg>
  );
}
