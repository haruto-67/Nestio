export function nextSortOrder(existing: { sort_order: number }[]): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((e) => e.sort_order)) + 1;
}
