// Service Worker der Web-App. Der Dateiname ist derselbe wie bei der früheren Godot-App,
// damit der Browser ihn als Update erkennt und die alte Version sauber ablöst.
// Strategie: erst Netz, bei Offline der zuletzt gespeicherte Stand.
const CACHE = "stat-sheet-web-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "index.manifest.json",
  "fonts/Manrope.ttf",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/main.js",
  "js/ui.js",
  "js/store.js",
  "js/sync.js",
  "js/gist.js",
  "js/legacy.js",
  "js/rules.js",
  "js/dates.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .catch(() => {}) // Offline-Vorrat ist nett, aber kein Grund, die Installation abzubrechen
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const cleanup = (async () => {
    const old = (await caches.keys()).filter((k) => k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    // Die Godot-Version hatte Navigation-Preload eingeschaltet; hier wird es nicht genutzt.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.disable().catch(() => {});
    await self.clients.claim();
    return old.length > 0;
  })();
  event.waitUntil(cleanup);
  // Lief noch die alte Godot-App (erkennbar an ihren Caches), offene Fenster neu laden.
  // Bewusst erst nach der Aktivierung: solange dieser Worker aktiviert, würde das Neuladen auf ihn warten.
  cleanup.then(async (hadOld) => {
    if (!hadOld) return;
    const wins = await self.clients.matchAll({ type: "window" });
    wins.forEach((w) => w.navigate(w.url).catch(() => {}));
  });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // GitHub-API nie anfassen
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") return (await caches.match("index.html")) ?? Response.error();
        return Response.error();
      }
    })(),
  );
});
