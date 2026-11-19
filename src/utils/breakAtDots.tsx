import React from 'react';

/** Field name with a line-break opportunity after every dot, so long dotted names wrap between
 *  segments ("http." / "method") instead of mid-word. */
export function breakAtDots(name: string): React.ReactNode {
  const parts = name.split('.');
  if (parts.length === 1) {
    return name;
  }
  return parts.map((p, i) => (
    <React.Fragment key={i}>
      {p}
      {i < parts.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </React.Fragment>
  ));
}
