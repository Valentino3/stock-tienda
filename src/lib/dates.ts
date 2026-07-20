export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
