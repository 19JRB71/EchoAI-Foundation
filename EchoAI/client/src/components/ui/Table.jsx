// Zorecho Table — quiet executive data. Thin dividers, uppercase micro-headers,
// rows brighten softly on hover. Wrap in <Card> for the glass frame.

export function Table({ className = "", children }) {
  return (
    <div className="overflow-x-auto">
      <table className={`font-inter w-full text-left text-sm ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }) {
  return (
    <thead>
      <tr className="border-b border-z-line">{children}</tr>
    </thead>
  );
}

export function TH({ className = "", children }) {
  return (
    <th
      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-z-faint ${className}`}
    >
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-[rgba(148,163,184,0.08)]">{children}</tbody>;
}

export function TR({ interactive = false, className = "", children, ...props }) {
  return (
    <tr
      className={[
        interactive
          ? "cursor-pointer transition-colors duration-150 hover:bg-white/[0.03]"
          : "",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TD({ className = "", children, ...props }) {
  return (
    <td className={`px-4 py-3 text-z-dim first:text-z-text ${className}`} {...props}>
      {children}
    </td>
  );
}
