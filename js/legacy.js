// Übernahme aus der früheren Godot-Web-App unter derselben Adresse.
// Godot hat Spielstand und Sync-Einstellungen im Browser-Speicher (IndexedDB "/userfs") abgelegt.
// Beim ersten Start der neuen App werden beide gelesen, damit Fortschritt und Token erhalten bleiben.

const DB_NAME = "/userfs";
const STORE = "FILE_DATA";
const DIR = "/userfs/godot/app_userdata/Stat Sheet/";

/** Gibt {save, sync} zurück; beides kann null sein. Wirft nie. */
export async function readGodotData() {
  const out = { save: null, sync: null };
  try {
    if (!globalThis.indexedDB) return out;
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === DB_NAME)) return out; // nicht erst anlegen, wenn es sie nie gab
    }
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        req.transaction.abort(); // Datenbank gab es nicht
        reject(new Error("keine Godot-Daten"));
      };
    });
    try {
      if (!db.objectStoreNames.contains(STORE)) return out;
      const saveText = await readFile(db, DIR + "player.json");
      if (saveText) {
        const parsed = JSON.parse(saveText);
        if (parsed && typeof parsed === "object") out.save = parsed;
      }
      const cfg = await readFile(db, DIR + "sync.cfg");
      if (cfg) out.sync = parseSyncConfig(cfg);
    } finally {
      db.close();
    }
  } catch {
    /* keine oder unlesbare Godot-Daten: frisch starten */
  }
  return out;
}

function readFile(db, path) {
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(path);
    req.onsuccess = () => {
      const c = req.result?.contents;
      resolve(c ? new TextDecoder().decode(c) : "");
    };
    req.onerror = () => resolve("");
  });
}

/** Liest Godots sync.cfg ([github] token="…" gist_id="…" synced_rev="…"). */
export function parseSyncConfig(text) {
  const get = (key) => {
    const m = new RegExp("^" + key + '\\s*=\\s*"([^"]*)"', "m").exec(text);
    return m ? m[1] : "";
  };
  const token = get("token");
  return token ? { token, gist_id: get("gist_id"), synced_rev: get("synced_rev") } : null;
}
