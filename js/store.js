// Der Spielstand: Name, Level, XP, Stats, Quests, Fähigkeiten und Traits.
// Jede Änderung durch den Spieler läuft über commit(): neue Revision, speichern, Ereignisse senden.
// Das Speicherformat ist dasselbe JSON wie in der früheren Godot-App (Version 5), ergänzt um
// eigene Stats (Version 6). Ältere Stände laden weiter.

import * as Rules from "./rules.js";
import { dayString, dateTimeString, dayBefore } from "./dates.js";

export const SAVE_VERSION = 6;
export const DEFAULT_NAME = "Spieler";
export const SAVE_KEY = "statsheet.save";
export const BACKUP_KEY = "statsheet.backups";
const MAX_BACKUPS = 15;

const int = (v, fallback = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};
const str = (v, fallback = "") => (v === undefined || v === null ? fallback : String(v));
const clean = (v) => str(v).trim();

/** Speicher im Browser; Tests geben ein einfaches Objekt mit getItem/setItem hinein. */
export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }
}

export class Store extends EventTarget {
  /**
   * @param {{storage?: any, now?: () => Date}} [opts]
   */
  constructor(opts = {}) {
    super();
    this.storage = opts.storage ?? browserStorage();
    this.now = opts.now ?? (() => new Date());
    this.reset();
  }

  reset() {
    this.name = DEFAULT_NAME;
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    /** @type {{key: string, abbr: string, name: string}[]} */
    this.statDefs = Rules.DEFAULT_STATS.map((s) => ({ ...s }));
    /** Grundwerte ohne Trait-Boni: {key: number} */
    this.stats = Object.fromEntries(this.statDefs.map((s) => [s.key, Rules.START_STAT]));
    this.quests = [];
    this.skills = [];
    this.traits = [];
    this.nextId = 1;
    this.rev = "";
    this.updatedAt = 0;
  }

  // --- Ereignisse ------------------------------------------------------------

  /** "changed": Daten sind anders (Spieler, Laden, Sync). "edited": nur Änderungen durch den Spieler. */
  emit(type) {
    this.dispatchEvent(new Event(type));
  }

  commit() {
    this.rev = randomRev();
    this.updatedAt = Math.floor(this.now().getTime() / 1000);
    this.save();
    this.emit("changed");
    this.emit("edited");
  }

  today() {
    return dayString(this.now());
  }

  stamp() {
    return dateTimeString(this.now());
  }

  // --- Level, XP und Stats ---------------------------------------------------

  xpToNext(level = this.level) {
    return Rules.xpToNext(level);
  }

  rank(level = this.level) {
    return Rules.rank(level);
  }

  /** Fügt XP hinzu und gibt die Anzahl der Level-Ups zurück. */
  grantXp(amount) {
    let ups = 0;
    this.xp = Math.max(0, this.xp + amount);
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level += 1;
      this.statPoints += Rules.POINTS_PER_LEVEL;
      ups += 1;
    }
    return ups;
  }

  spendStatPoint(key) {
    if (this.statPoints <= 0 || !(key in this.stats)) return false;
    this.statPoints -= 1;
    this.stats[key] += 1;
    this.commit();
    return true;
  }

  traitBonus(key) {
    return this.traits.reduce((sum, t) => sum + int(t.bonuses[key]), 0);
  }

  totalStat(key) {
    return int(this.stats[key]) + this.traitBonus(key);
  }

  statDef(key) {
    return this.statDefs.find((s) => s.key === key) ?? null;
  }

  /** Legt einen eigenen Stat an, z. B. WIL "Willenskraft". Startet bei START_STAT. */
  addStat(abbr, name) {
    abbr = clean(abbr).toUpperCase().slice(0, Rules.MAX_ABBR);
    name = clean(name);
    if (!abbr || !name) return null;
    const def = { key: "s" + this.takeId(), abbr, name };
    this.statDefs.push(def);
    this.stats[def.key] = Rules.START_STAT;
    this.commit();
    return def;
  }

  updateStat(key, abbr, name) {
    const def = this.statDef(key);
    abbr = clean(abbr).toUpperCase().slice(0, Rules.MAX_ABBR);
    name = clean(name);
    if (!def || !abbr || !name) return false;
    def.abbr = abbr;
    def.name = name;
    this.commit();
    return true;
  }

  /** Entfernt einen Stat. Darauf verteilte Punkte kommen als freie Punkte zurück, Trait-Boni darauf fallen weg. */
  removeStat(key) {
    const def = this.statDef(key);
    if (!def || this.statDefs.length <= 1) return false;
    this.statPoints += Math.max(0, int(this.stats[key]) - Rules.START_STAT);
    this.statDefs = this.statDefs.filter((s) => s.key !== key);
    delete this.stats[key];
    for (const t of this.traits) delete t.bonuses[key];
    this.commit();
    return true;
  }

  setName(value) {
    value = clean(value);
    if (!value || value === this.name) return;
    this.name = value.slice(0, 24);
    this.commit();
  }

  // --- Quests ----------------------------------------------------------------

  addQuest(title, description = "", reward = Rules.DEFAULT_QUEST_XP, daily = false) {
    title = clean(title);
    if (!title) return null;
    const q = {
      id: this.takeId(),
      title,
      description: clean(description),
      xp: Math.max(1, int(reward, Rules.DEFAULT_QUEST_XP)),
      done: false,
      created: this.stamp(),
      completed: "",
      daily: !!daily,
      streak: 0,
    };
    this.quests.push(q);
    this.commit();
    return q;
  }

  quest(id) {
    return this.quests.find((q) => q.id === id) ?? null;
  }

  updateQuest(id, title, description, reward, daily = false) {
    const q = this.quest(id);
    title = clean(title);
    if (!q || !title) return false;
    q.title = title;
    q.description = clean(description);
    q.xp = Math.max(1, int(reward, q.xp));
    q.daily = !!daily;
    this.commit();
    return true;
  }

  removeQuest(id) {
    return this.removeFrom("quests", id);
  }

  /** Schließt eine Quest ab und gibt die Anzahl der Level-Ups zurück (-1, wenn es nicht geht). */
  completeQuest(id) {
    const q = this.quest(id);
    if (!q || q.done) return -1;
    if (q.daily) {
      const last = completedDay(q);
      if (last === this.today()) return -1; // heute schon erledigt
      q.streak = last === dayBefore(this.today()) ? q.streak + 1 : 1;
    }
    q.done = true;
    q.completed = this.stamp();
    const ups = this.grantXp(q.xp);
    this.commit();
    return ups;
  }

  /** Holt eine erledigte Quest zurück (XP bleiben). Tägliche Quests öffnen sich um Mitternacht von selbst. */
  reopenQuest(id) {
    const q = this.quest(id);
    if (!q || !q.done || q.daily) return false;
    q.done = false;
    q.completed = "";
    this.commit();
    return true;
  }

  /** Aktuelle Serie einer täglichen Quest in Tagen. */
  streak(q) {
    const last = completedDay(q);
    return last === this.today() || last === dayBefore(this.today()) ? q.streak : 0;
  }

  /**
   * Öffnet tägliche Quests, die an einem früheren Tag erledigt wurden. Keine neue Revision:
   * jedes Gerät leitet das aus denselben Daten ab, also muss nichts hochgeladen werden.
   */
  resetDailies() {
    let reset = false;
    for (const q of this.quests) {
      if (q.daily && q.done && completedDay(q) !== this.today()) {
        q.done = false; // completed bleibt für die Serie erhalten
        reset = true;
      }
    }
    if (reset) {
      this.save();
      this.emit("changed");
    }
    return reset;
  }

  // --- Fähigkeiten und Traits ------------------------------------------------

  addSkill(name, description = "") {
    return this.addEntry("skills", { name, description });
  }

  updateSkill(id, name, description) {
    return this.updateEntry(this.skills, id, name, description);
  }

  removeSkill(id) {
    return this.removeFrom("skills", id);
  }

  /** bonuses: {statKey: number}, z. B. {vit: 2, agi: -1}. Nullwerte und unbekannte Stats fallen weg. */
  addTrait(name, description = "", bonuses = {}) {
    return this.addEntry("traits", { name, description, bonuses: this.cleanBonuses(bonuses) });
  }

  updateTrait(id, name, description, bonuses) {
    const t = this.traits.find((e) => e.id === id);
    if (!t || !clean(name)) return false;
    t.bonuses = this.cleanBonuses(bonuses);
    return this.updateEntry(this.traits, id, name, description);
  }

  removeTrait(id) {
    return this.removeFrom("traits", id);
  }

  cleanBonuses(raw) {
    const out = {};
    for (const def of this.statDefs) {
      const v = int(raw?.[def.key]);
      if (v !== 0) out[def.key] = Math.max(-99, Math.min(99, v));
    }
    return out;
  }

  addEntry(list, e) {
    const name = clean(e.name);
    if (!name) return null;
    const entry = { id: this.takeId(), ...e, name, description: clean(e.description) };
    this[list].push(entry);
    this.commit();
    return entry;
  }

  updateEntry(list, id, name, description) {
    const e = list.find((x) => x.id === id);
    name = clean(name);
    if (!e || !name) return false;
    e.name = name;
    e.description = clean(description);
    this.commit();
    return true;
  }

  removeFrom(list, id) {
    const before = this[list].length;
    this[list] = this[list].filter((x) => x.id !== id);
    if (this[list].length === before) return false;
    this.commit();
    return true;
  }

  takeId() {
    return this.nextId++;
  }

  // --- Speichern, Laden, Sync ------------------------------------------------

  toDict() {
    return {
      version: SAVE_VERSION,
      rev: this.rev,
      updated_at: this.updatedAt,
      name: this.name,
      level: this.level,
      xp: this.xp,
      stat_points: this.statPoints,
      stat_defs: this.statDefs.map((s) => ({ ...s })),
      stats: { ...this.stats },
      quests: this.quests.map((q) => ({ ...q })),
      skills: this.skills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
      traits: this.traits.map((t) => ({ id: t.id, name: t.name, description: t.description, bonuses: { ...t.bonuses } })),
      next_id: this.nextId,
    };
  }

  /** Lädt einen Spielstand. Versteht alle Versionen der Godot-App; fehlende Felder behalten Standardwerte. */
  fromDict(d) {
    this.reset();
    if (!d || typeof d !== "object") return;
    this.rev = str(d.rev);
    this.updatedAt = int(d.updated_at);
    this.name = clean(d.name) || DEFAULT_NAME;
    this.level = Math.max(1, int(d.level, 1));
    this.xp = Math.max(0, int(d.xp));
    this.statPoints = Math.max(0, int(d.stat_points));

    if (Array.isArray(d.stat_defs) && d.stat_defs.length > 0) {
      const seen = new Set();
      this.statDefs = [];
      for (const raw of d.stat_defs) {
        const key = clean(raw?.key);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        this.statDefs.push({ key, abbr: clean(raw.abbr).toUpperCase() || key.toUpperCase(), name: clean(raw.name) || key });
      }
      if (this.statDefs.length === 0) this.statDefs = Rules.DEFAULT_STATS.map((s) => ({ ...s }));
    }
    const saved = d.stats && typeof d.stats === "object" ? d.stats : {};
    this.stats = Object.fromEntries(this.statDefs.map((s) => [s.key, int(saved[s.key], Rules.START_STAT)]));

    this.quests = arr(d.quests).map(readQuest).filter(Boolean);
    this.skills = arr(d.skills).map(readEntry).filter(Boolean);
    this.traits = arr(d.traits)
      .map((raw) => {
        const e = readEntry(raw);
        if (e) e.bonuses = this.cleanBonuses(raw.bonuses);
        return e;
      })
      .filter(Boolean);

    // Bis Version 4 gab es getrennte Zähler für Quests und Einträge.
    let next = Math.max(int(d.next_id, 1), int(d.next_quest_id, 1), int(d.next_entry_id, 1));
    for (const item of [...this.quests, ...this.skills, ...this.traits]) next = Math.max(next, item.id + 1);
    for (const s of this.statDefs) if (/^s\d+$/.test(s.key)) next = Math.max(next, int(s.key.slice(1)) + 1);
    this.nextId = next;
    if (this.rev === "" && !this.isPristine()) this.rev = "legacy"; // älterer Stand mit Fortschritt
  }

  /** Übernimmt einen fremden Stand (Cloud oder Import). */
  applyRemote(d) {
    this.fromDict(d);
    this.save();
    this.resetDailies();
    this.emit("changed");
  }

  isPristine() {
    return isPristineDict(this.toDict());
  }

  save() {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.toDict()));
    } catch (e) {
      console.error("Speichern fehlgeschlagen", e);
    }
  }

  /** Lädt den Stand aus dem Browser. Gibt false zurück, wenn es noch keinen gibt. */
  load() {
    const text = this.storage.getItem(SAVE_KEY);
    if (text === null) return false;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* unten gesichert */
    }
    if (parsed && typeof parsed === "object") {
      this.fromDict(parsed);
      this.resetDailies();
    } else {
      this.writeBackup({ raw: text }, "unlesbar"); // nichts überschreiben, ohne eine Kopie zu behalten
    }
    this.emit("changed");
    return true;
  }

  // --- Sicherungen -----------------------------------------------------------

  backups() {
    try {
      const list = JSON.parse(this.storage.getItem(BACKUP_KEY) ?? "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Legt eine Sicherung ab (die neuesten MAX_BACKUPS bleiben). */
  writeBackup(data, label) {
    const list = this.backups();
    list.unshift({ at: this.stamp(), label, data });
    try {
      this.storage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
    } catch (e) {
      console.error("Sicherung fehlgeschlagen", e);
    }
  }
}

export function isPristineDict(d) {
  for (const key of ["quests", "skills", "traits"]) {
    if (Array.isArray(d?.[key]) && d[key].length > 0) return false;
  }
  return int(d?.level, 1) <= 1 && int(d?.xp) === 0 && int(d?.stat_points) === 0;
}

export function completedDay(q) {
  return str(q.completed).slice(0, 10);
}

function randomRev() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function readQuest(d) {
  if (!d || typeof d !== "object" || !clean(d.title)) return null;
  return {
    id: int(d.id),
    title: str(d.title),
    description: str(d.description),
    xp: Math.max(1, int(d.xp, Rules.DEFAULT_QUEST_XP)),
    done: !!d.done,
    created: str(d.created),
    completed: str(d.completed),
    daily: !!d.daily,
    streak: Math.max(0, int(d.streak)),
  };
}

function readEntry(d) {
  if (!d || typeof d !== "object" || !clean(d.name)) return null;
  return { id: int(d.id), name: str(d.name), description: str(d.description) };
}
