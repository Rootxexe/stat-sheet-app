// Datums-Helfer. Tage sind "YYYY-MM-DD", Zeitpunkte "YYYY-MM-DD HH:MM:SS", beides in Ortszeit
// (dasselbe Format wie in der früheren Godot-App, damit alte Spielstände passen).

const pad = (n) => String(n).padStart(2, "0");

export function dayString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateTimeString(d) {
  return `${dayString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dayBefore(day) {
  const [y, m, d] = day.split("-").map(Number);
  return dayString(new Date(y, m - 1, d - 1, 12));
}

/** "2026-09-26 20:15:00" -> "26.09.2026" */
export function formatGerman(datetime) {
  const d = String(datetime).slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : String(datetime);
}
