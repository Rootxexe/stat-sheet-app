// Speicherort in der Cloud: eine Datei in einem privaten ("secret") GitHub Gist.
// Braucht einen GitHub-Token mit dem Recht "gist". Dieselbe Datei wie in der früheren Godot-App.

export const FILE_NAME = "stat-sheet-save.json";
export const DESCRIPTION = "Stat Sheet Spielstand (automatische Synchronisierung)";
const TIMEOUT_MS = 20000;

export class GistBackend {
  constructor(opts = {}) {
    this.apiUrl = opts.apiUrl ?? "https://api.github.com";
    this.fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.token = "";
  }

  /** Sucht das Gist mit dem Spielstand. data: Gist-ID oder "" (noch keins angelegt). */
  async find() {
    const r = await this.request("GET", "/gists?per_page=100");
    if (r.ok) {
      const hit = (Array.isArray(r.data) ? r.data : []).find((g) => g?.files && FILE_NAME in g.files);
      r.data = hit ? String(hit.id) : "";
    }
    return r;
  }

  /** Lädt den Spielstand. data: Objekt (leer, wenn die Datei fehlt oder kaputt ist). */
  async download(gistId) {
    const r = await this.request("GET", "/gists/" + gistId);
    if (r.ok) {
      const file = r.data?.files?.[FILE_NAME];
      let content = file?.content ?? "";
      // Sehr große Dateien liefert GitHub gekürzt, dann steht der volle Inhalt unter raw_url.
      if (file?.truncated && file.raw_url) {
        const raw = await this.fetch(file.raw_url, { cache: "no-store" });
        content = raw.ok ? await raw.text() : "";
      }
      let parsed = null;
      try {
        parsed = JSON.parse(content);
      } catch {
        /* kaputt: leer zurückgeben */
      }
      r.data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    return r;
  }

  /** Speichert den Spielstand. Ohne gistId wird ein neues privates Gist angelegt. data: Gist-ID. */
  async upload(gistId, save) {
    const files = { [FILE_NAME]: { content: JSON.stringify(save, null, "\t") } };
    const r = gistId
      ? await this.request("PATCH", "/gists/" + gistId, { files })
      : await this.request("POST", "/gists", { description: DESCRIPTION, public: false, files });
    if (r.ok) r.data = String(r.data?.id ?? gistId);
    return r;
  }

  async request(method, path, body) {
    let url = this.apiUrl + path;
    if (method === "GET") url += (url.includes("?") ? "&" : "?") + "nocache=" + Date.now(); // nie einen veralteten Stand lesen
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = { ok: false, code: 0, data: null, error: "" };
    try {
      const res = await this.fetch(url, {
        method,
        cache: "no-store",
        signal: ctrl.signal,
        headers: {
          Authorization: "Bearer " + this.token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      r.code = res.status;
      const text = await res.text();
      try {
        r.data = text ? JSON.parse(text) : null;
      } catch {
        r.data = null;
      }
      r.ok = res.ok;
      if (!r.ok) r.error = errorText(res.status);
    } catch {
      r.error = "Keine Verbindung zu GitHub";
    } finally {
      clearTimeout(timer);
    }
    return r;
  }
}

function errorText(code) {
  if (code === 401) return "Token ungültig oder abgelaufen";
  if (code === 403 || code === 429) return 'GitHub verweigert den Zugriff (Token-Recht "gist" fehlt oder zu viele Anfragen)';
  if (code === 404) return "Gist nicht gefunden";
  return "GitHub-Fehler " + code;
}
