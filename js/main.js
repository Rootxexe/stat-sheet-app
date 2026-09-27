// Start der App: Spielstand laden (beim ersten Mal aus der alten Godot-App übernehmen),
// Abgleich und Oberfläche starten, Service Worker anmelden.
import { Store } from "./store.js";
import { CloudSync, CONFIG_KEY } from "./sync.js";
import { UI } from "./ui.js";
import { readGodotData } from "./legacy.js";

const DAILY_CHECK_MS = 30_000;

async function start() {
  const store = new Store();
  if (!store.load()) await migrateFromGodot(store);

  const sync = new CloudSync(store);
  const ui = new UI(document.getElementById("app"), store, sync);
  ui.bindKeys();

  // Tägliche Quests um Mitternacht wieder öffnen, auch wenn die App offen bleibt.
  setInterval(() => store.resetDailies(), DAILY_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      store.resetDailies();
      sync.sync();
    } else {
      sync.flush();
    }
  });
  window.addEventListener("pagehide", () => sync.flush());

  sync.sync();
}

/** Übernimmt Spielstand und Sync-Token der früheren Godot-Web-App unter derselben Adresse. */
async function migrateFromGodot(store) {
  const old = await readGodotData();
  if (old.sync && store.storage.getItem(CONFIG_KEY) === null) {
    store.storage.setItem(CONFIG_KEY, JSON.stringify(old.sync));
  }
  if (old.save) {
    store.fromDict(old.save); // Revision bleibt, damit der Abgleich den Stand wiedererkennt
    store.resetDailies();
    store.save();
    store.emit("changed");
  }
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("index.service.worker.js").catch(() => {});
}

start();
