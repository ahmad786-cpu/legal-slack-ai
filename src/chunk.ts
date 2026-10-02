// Splits text into overlapping chunks for embedding, preferring paragraph and sentence breaks
// so clauses are not cut mid-sentence. Sizes are in characters (about 4 per token).
export function chunkText(text: string, size = 3200, overlap = 400): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start + Math.floor(size * 0.6), end);
      const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (breakAt > 0) end = start + Math.floor(size * 0.6) + breakAt + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}
