// Hält den Spielstand zwischen Geräten gleich, genau wie in der früheren Godot-App.
//
// Jeder Stand trägt eine Revision (store.rev). Sync merkt sich, welche Revision zuletzt auf beiden
// Seiten gleich war (syncedRev), und entscheidet bei jedem Abgleich:
// - nur hier geändert  -> hochladen
// - nur in der Cloud   -> übernehmen
// - auf beiden Seiten  -> der neuere Stand gewinnt, der andere landet in den Sicherungen
// Beim allerersten Abgleich mit Fortschritt auf beiden Seiten fragt die App nach ("choice").
//
// Abgeglichen wird beim Start, wenn die App wieder sichtbar wird, kurz nach jeder Änderung
// und jede Minute, solange die App offen ist.

import { GistBackend } from "./gist.js";
import { isPristineDict } from "./store.js";

export const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Stat%20Sheet%20Sync";
export const CONFIG_KEY = "statsheet.sync";
const EDIT_DELAY_MS = 2000;
const POLL_MS = 60000;

export class CloudSync extends EventTarget {
  /**
   * @param {import("./store.js").Store} store
   * @param {{backend?: GistBackend, auto?: boolean}} [opts]
   */
  constructor(store, opts = {}) {
    super();
    this.store = store;
    this.backend = opts.backend ?? new GistBackend();
    this.auto = opts.auto ?? true;
    this.token = "";
    this.gistId = "";
    this.syncedRev = "";
    this.status = "";
    this.lastSync = null;
    this.busy = false;
    this.pendingRemote = null; // Cloud-Stand, der auf die Entscheidung beim ersten Abgleich wartet
    this.again = false;
    this.editTimer = null;
    this.pollTimer = null;
    store.addEventListener("edited", () => this.onEdited());
    this.loadConfig();
  }

  enabled() {
    return this.token !== "";
  }

  // --- Einstellungen -------------------------------------------------------

  loadConfig() {
    let cfg = {};
    try {
      cfg = JSON.parse(this.store.storage.getItem(CONFIG_KEY) ?? "{}") ?? {};
    } catch {
      cfg = {};
    }
    this.token = String(cfg.token ?? "");
    this.gistId = String(cfg.gist_id ?? "");
    this.syncedRev = String(cfg.synced_rev ?? "");
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.enabled() && this.auto) this.pollTimer = setInterval(() => this.sync(), POLL_MS);
    this.setStatus(this.enabled() ? "Sync bereit" : "Sync aus");
  }

  saveConfig() {
    const cfg = { token: this.token, gist_id: this.gistId, synced_rev: this.syncedRev };
    this.store.storage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }

  /** Verbindet mit einem (neuen) Token und gleicht sofort ab. */
  async connect(token) {
    this.token = String(token).trim();
    this.gistId = "";
    this.syncedRev = "";
    this.pendingRemote = null;
    this.saveConfig();
    this.loadConfig();
    await this.sync();
  }

  disconnect() {
    this.token = "";
    this.gistId = "";
    this.syncedRev = "";
    this.pendingRemote = null;
    this.saveConfig();
    this.loadConfig();
  }

  // --- Abgleich ------------------------------------------------------------

  onEdited() {
    if (!this.enabled() || !this.auto) return;
    clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.sync();
    }, EDIT_DELAY_MS);
  }

  /** Letzte Änderung sofort hochladen, z. B. bevor die App in den Hintergrund geht. */
  flush() {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
      this.sync();
    }
  }

  /** Gleicht einmal ab. Läuft schon ein Abgleich, folgt direkt danach ein weiterer. */
  async sync() {
    if (!this.enabled() || this.pendingRemote) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.setStatus("Synchronisiere …");
    let error = "";
    try {
      error = await this.syncOnce();
    } catch (e) {
      error = String(e?.message ?? e);
    }
    this.busy = false;
    if (error) this.setStatus("Sync-Fehler: " + error);
    if (this.again) {
      this.again = false;
      await this.sync();
    }
  }

  /** Ein Abgleich. Gibt "" zurück oder eine Fehlermeldung. */
  async syncOnce() {
    const store = this.store;
    this.backend.token = this.token;
    const startRev = store.rev;
    if (!this.gistId) {
      const found = await this.backend.find();
      if (!found.ok) return found.error;
      this.gistId = found.data;
      this.saveConfig();
    }

    let remote = {};
    if (this.gistId) {
      const r = await this.backend.download(this.gistId);
      if (r.code === 404) {
        this.gistId = ""; // Gist wurde gelöscht: neu anlegen
        this.syncedRev = "";
      } else if (!r.ok) {
        return r.error;
      } else {
        remote = r.data;
      }
    }

    if (store.rev !== startRev) {
      this.again = true; // während des Ladens geändert: gleich noch einmal mit dem neuen Stand
      return "";
    }
    if (Object.keys(remote).length === 0) return this.upload();

    const remoteRev = String(remote.rev ?? "");
    if (remoteRev === store.rev) return this.done(remoteRev);
    if (!this.syncedRev) return this.firstSync(remote);

    const localChanged = store.rev !== this.syncedRev;
    const remoteChanged = remoteRev !== this.syncedRev;
    if (localChanged && !remoteChanged) return this.upload();
    if (remoteChanged && !localChanged) return this.download(remote);
    // Auf beiden Seiten geändert: neuerer Stand gewinnt, der andere wird gesichert.
    if (Number(remote.updated_at ?? 0) > store.updatedAt) {
      store.writeBackup(store.toDict(), "dieses Gerät");
      this.notice("Auf einem anderen Gerät gab es neuere Änderungen, sie wurden übernommen. Der Stand dieses Geräts liegt in den Sicherungen.");
      return this.download(remote);
    }
    store.writeBackup(remote, "Cloud");
    this.notice("Dieses Gerät hat die neueren Änderungen, sie wurden hochgeladen. Der ältere Cloud-Stand liegt in den Sicherungen.");
    return this.upload();
  }

  /** Erster Abgleich mit einer bestehenden Cloud-Datei. */
  async firstSync(remote) {
    if (this.store.isPristine()) return this.download(remote); // neues Gerät: Fortschritt aus der Cloud holen
    if (isPristineDict(remote)) return this.upload();
    this.pendingRemote = remote;
    this.setStatus("Sync wartet: Welcher Stand soll bleiben?");
    this.dispatchEvent(new CustomEvent("choice", { detail: remote }));
    return "";
  }

  /** Antwort auf "choice". Der verworfene Stand landet in den Sicherungen. */
  async resolveFirstSync(keepThisDevice) {
    const remote = this.pendingRemote;
    if (!remote) return;
    this.pendingRemote = null;
    if (keepThisDevice) {
      this.store.writeBackup(remote, "Cloud");
      this.busy = true;
      const error = await this.upload();
      this.busy = false;
      if (error) this.setStatus("Sync-Fehler: " + error);
    } else {
      this.store.writeBackup(this.store.toDict(), "dieses Gerät");
      this.download(remote);
    }
  }

  async upload() {
    const save = this.store.toDict();
    const r = await this.backend.upload(this.gistId, save);
    if (!r.ok) return r.error;
    this.gistId = r.data;
    return this.done(save.rev);
  }

  download(remote) {
    this.store.applyRemote(remote);
    return this.done(this.store.rev);
  }

  done(rev) {
    this.syncedRev = rev;
    this.saveConfig();
    this.lastSync = new Date();
    const t = this.lastSync.toTimeString().slice(0, 5);
    this.setStatus("Synchronisiert um " + t);
    return "";
  }

  notice(text) {
    this.dispatchEvent(new CustomEvent("notice", { detail: text }));
  }

  setStatus(text) {
    this.status = text;
    this.dispatchEvent(new CustomEvent("status", { detail: text }));
  }
}
