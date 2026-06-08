// Deterministic avatar initial + colour from a person's name, so the same
// assignee always looks the same across the app.
const PALETTE = ["#5A4BD4", "#2F9E6B", "#C77D18", "#4087E5", "#E5484D"];

export function avatarFor(name: string): { initial: string; color: string } {
  const trimmed = name.trim();
  const initial = (trimmed[0] ?? "?").toUpperCase();
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) hash = (hash * 31 + trimmed.charCodeAt(i)) | 0;
  const color = PALETTE[Math.abs(hash) % PALETTE.length];
  return { initial, color };
}
