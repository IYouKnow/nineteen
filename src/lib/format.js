import { formatDistanceToNow, format } from "date-fns";

export function timeAgo(date) {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "—";
  }
}

export function formatDate(date, fmt = "MMM d, yyyy · HH:mm") {
  if (!date) return "—";
  try {
    return format(new Date(date), fmt);
  } catch {
    return "—";
  }
}

export function formatDuration(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function shortSha(sha) {
  if (!sha) return "—";
  return sha.substring(0, 7);
}

export function randomSha() {
  return Array.from({ length: 40 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");
}