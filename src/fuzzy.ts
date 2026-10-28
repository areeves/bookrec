/**
 * Similarity ratio in [0, 1] using Ratcliff/Obershelp matching, the same
 * algorithm as Python's difflib.SequenceMatcher(None, a, b).ratio().
 */
export function ratio(a: string, b: string): number {
  if (a.length + b.length === 0) return 1;
  return (2 * matchingChars(a, 0, a.length, b, 0, b.length)) / (a.length + b.length);
}

function matchingChars(
  a: string,
  alo: number,
  ahi: number,
  b: string,
  blo: number,
  bhi: number,
): number {
  const { i, j, size } = longestMatch(a, alo, ahi, b, blo, bhi);
  if (size === 0) return 0;
  return (
    size +
    matchingChars(a, alo, i, b, blo, j) +
    matchingChars(a, i + size, ahi, b, j + size, bhi)
  );
}

// Longest common substring; ties go to the earliest position in a, then in b.
function longestMatch(a: string, alo: number, ahi: number, b: string, blo: number, bhi: number) {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  let prev = new Array<number>(bhi - blo + 1).fill(0);
  for (let i = alo; i < ahi; i++) {
    const cur = new Array<number>(bhi - blo + 1).fill(0);
    for (let j = blo; j < bhi; j++) {
      if (a[i] === b[j]) {
        const k = (prev[j - blo] ?? 0) + 1;
        cur[j - blo + 1] = k;
        if (k > bestSize) {
          bestI = i - k + 1;
          bestJ = j - k + 1;
          bestSize = k;
        }
      }
    }
    prev = cur;
  }
  return { i: bestI, j: bestJ, size: bestSize };
}
