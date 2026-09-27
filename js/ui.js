// Oberfläche: eine Seite als Liste mit einklappbaren Abschnitten, dazu die Dialoge.
// Die Seite wird bei jeder Änderung neu gezeichnet; Klicks laufen über data-act-Attribute.

import * as Rules from "./rules.js";
import { formatGerman } from "./dates.js";
import { TOKEN_URL } from "./sync.js";

const UI_KEY = "statsheet.ui";
const DEFAULT_COLLAPSED = { stats: false, today: false, open: false, done: true, skills: true, traits: true };

const ICON = {
  chev: '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#101318" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  avatar: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="14" r="6.5" fill="none" stroke="#ffb547" stroke-width="2.2"/><path d="M8 36c1-8 6-12 12-12s11 4 12 12" fill="none" stroke="#ffb547" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const days = (n) => `${n} ${n === 1 ? "Tag" : "Tage"}`;
const signed = (n) => (n > 0 ? "+" + n : "−" + Math.abs(n));

export class UI {
  /**
   * @param {HTMLElement} root
   * @param {import("./store.js").Store} store
   * @param {import("./sync.js").CloudSync} sync
   */
  constructor(root, store, sync) {
    this.root = root;
    this.store = store;
    this.sync = sync;
    this.dialog = document.getElementById("dlg");
    this.toastEl = document.getElementById("toast");
    this.collapsed = { ...DEFAULT_COLLAPSED, ...this.loadUi().collapsed };

    root.addEventListener("click", (e) => this.onClick(e));
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog.close(); // Tipp neben das Blatt schließt es
    });
    store.addEventListener("changed", () => this.render());
    sync.addEventListener("status", () => this.renderFooter());
    sync.addEventListener("notice", (e) => this.message("Sync", e.detail));
    sync.addEventListener("choice", () => this.openFirstSync());
    this.render();
  }

  loadUi() {
    try {
      return JSON.parse(this.store.storage.getItem(UI_KEY) ?? "{}") ?? {};
    } catch {
      return {};
    }
  }

  saveUi() {
    try {
      this.store.storage.setItem(UI_KEY, JSON.stringify({ collapsed: this.collapsed }));
    } catch {
      /* nur Komfort */
    }
  }

  // --- Seite ---------------------------------------------------------------

  render() {
    const s = this.store;
    const daily = [...s.quests.filter((q) => q.daily && !q.done), ...s.quests.filter((q) => q.daily && q.done)];
    const open = s.quests.filter((q) => !q.daily && !q.done);
    const done = s.quests.filter((q) => !q.daily && q.done).reverse(); // zuletzt erledigte zuerst
    const doneToday = daily.filter((q) => q.done).length;

    const statRows = s.statDefs.map((d) => this.statRow(d)).join("") + `<button class="row new" data-act="add-stat">+ Eigener Stat</button>`;
    const todayBody =
      (daily.length
        ? `<div class="bar daybar${doneToday === daily.length ? " full" : ""}"><i style="width:${(doneToday / daily.length) * 100}%"></i></div>`
        : "") + (daily.length ? daily.map((q) => this.questRow(q)).join("") : this.empty("Noch keine täglichen Quests, z. B. „10 Seiten lesen“."));
    const openBody = open.length ? open.map((q) => this.questRow(q)).join("") : this.empty("Keine offenen Quests. Leg mit „+ Neu“ ein echtes Ziel an.");

    this.root.innerHTML = `
      ${this.profile()}
      ${this.section("stats", "Stats", String(s.statDefs.length), statRows)}
      ${this.section("today", "Heute", daily.length ? `${doneToday} / ${daily.length}` : "0", todayBody, "add-daily", daily.length && doneToday === daily.length ? "good" : "accent")}
      ${this.section("open", "Offen", String(open.length), openBody, "add-quest")}
      ${done.length ? this.section("done", "Erledigt", String(done.length), done.map((q) => this.questRow(q)).join("")) : ""}
      ${this.section("skills", "Fähigkeiten", String(s.skills.length), s.skills.length ? s.skills.map((e) => this.entryRow(e, false)).join("") : this.empty("Halte fest, was du kannst oder lernst, z. B. „Spanisch A2“."), "add-skill")}
      ${this.section("traits", "Traits", String(s.traits.length), s.traits.length ? s.traits.map((e) => this.entryRow(e, true)).join("") : this.empty("Eigenschaften, die deine Stats verändern, z. B. „Frühaufsteher“ mit VIT +2."), "add-trait")}
      <div class="footer" id="footer"></div>`;
    this.renderFooter();
  }

  renderFooter() {
    const f = this.root.querySelector("#footer");
    if (!f) return;
    f.innerHTML = this.sync.enabled()
      ? `${esc(this.sync.status)} · <button data-act="settings">Einstellungen</button>`
      : `Sync aus · <button data-act="settings">Zwischen Handy und PC abgleichen</button>`;
  }

  profile() {
    const s = this.store;
    const need = s.xpToNext();
    return `<header class="profile">
      <div class="avatar">${ICON.avatar}</div>
      <div class="who">
        <div class="who-top">
          <button class="name" data-act="edit-name" title="Namen ändern">${esc(s.name)}</button>
          <button class="icon-btn" data-act="settings" aria-label="Einstellungen und Sync">${ICON.gear}</button>
        </div>
        <div class="level">Level ${s.level} <span class="rank" title="Rang E bis S, alle ${Rules.LEVELS_PER_RANK} Level einer höher">RANG ${s.rank()}</span></div>
        <div class="bar xpbar"><i style="width:${Math.min(100, (s.xp / need) * 100)}%"></i></div>
        <div class="xpline"><span>XP ${s.xp} / ${need}</span>${s.statPoints > 0 ? `<b>${s.statPoints} ${s.statPoints === 1 ? "Punkt" : "Punkte"} frei</b>` : ""}</div>
      </div>
    </header>`;
  }

  section(id, title, count, body, addAct = "", tone = "") {
    const open = !this.collapsed[id];
    return `<div class="sec">
        <button class="sec-toggle" data-act="toggle" data-id="${id}" aria-expanded="${open}" aria-controls="sec-${id}">${ICON.chev}${title}<span class="count${tone ? " " + tone : ""}">${count}</span></button>
        ${addAct ? `<button class="add" data-act="${addAct}">+ Neu</button>` : ""}
      </div>
      <div class="sec-body" id="sec-${id}"${open ? "" : " hidden"}>${body}</div>`;
  }

  empty(text) {
    return `<div class="row empty">${esc(text)}</div>`;
  }

  statRow(d) {
    const s = this.store;
    const base = s.stats[d.key];
    const bonus = s.traitBonus(d.key);
    const total = s.totalStat(d.key);
    const scale = Math.max(20, ...s.statDefs.map((x) => s.totalStat(x.key)));
    return `<div class="row tap" data-act="edit-stat" data-key="${esc(d.key)}" role="button" tabindex="0" aria-label="${esc(d.name)} bearbeiten">
      <span class="abbr">${esc(d.abbr)}</span>
      <span class="main">${esc(d.name)}<div class="bar"><i style="width:${(Math.max(0, total) / scale) * 100}%"></i></div></span>
      <span class="val" title="Grundwert ${base}${bonus ? `, Traits ${signed(bonus)}` : ""}">${total}${bonus ? `<small class="${bonus > 0 ? "pos" : "neg"}">${signed(bonus)} Trait</small>` : ""}</span>
      ${s.statPoints > 0 ? `<button class="plus" data-act="plus" data-key="${esc(d.key)}" aria-label="Punkt auf ${esc(d.name)} verteilen">+</button>` : ""}
    </div>`;
  }

  questRow(q) {
    const parts = [];
    if (q.description) parts.push(esc(q.description));
    if (q.daily) {
      const streak = this.store.streak(q);
      if (streak > 0) parts.push(`<span class="hot">Serie ${days(streak)}</span>`);
      if (q.done) parts.push('<span class="ok">morgen wieder offen</span>');
    } else if (q.done && q.completed) {
      parts.push("erledigt am " + formatGerman(q.completed));
    }
    let check;
    if (!q.done) check = `<button class="check${q.daily ? " daily" : ""}" data-act="complete" data-id="${q.id}" aria-label="„${esc(q.title)}“ abschließen"></button>`;
    else if (q.daily) check = `<button class="check on" disabled aria-label="Heute erledigt">${ICON.check}</button>`;
    else check = `<button class="check on" data-act="reopen" data-id="${q.id}" aria-label="„${esc(q.title)}“ wieder öffnen">${ICON.check}</button>`;
    return `<div class="row tap${q.done ? " done" : ""}" data-act="edit-quest" data-id="${q.id}" role="button" tabindex="0">
      ${check}
      <span class="main">${esc(q.title)}${parts.length ? `<span class="sub">${parts.join(" · ")}</span>` : ""}</span>
      <span class="xp">+${q.xp}</span>
    </div>`;
  }

  entryRow(e, isTrait) {
    let sub = e.description ? esc(e.description) : "";
    if (isTrait) {
      const bon = this.store.statDefs
        .filter((d) => e.bonuses[d.key])
        .map((d) => `<span class="${e.bonuses[d.key] > 0 ? "pos" : "neg"}">${esc(d.abbr)} ${signed(e.bonuses[d.key])}</span>`)
        .join(" · ");
      if (bon) sub += (sub ? "<br>" : "") + `<span class="bon">${bon}</span>`;
    }
    return `<button class="row" data-act="${isTrait ? "edit-trait" : "edit-skill"}" data-id="${e.id}">
      <span class="main">${esc(e.name)}${sub ? `<span class="sub">${sub}</span>` : ""}</span>
      <span class="chevron">›</span>
    </button>`;
  }

  // --- Klicks --------------------------------------------------------------

  onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el || !this.root.contains(el)) return;
    const s = this.store;
    const id = Number(el.dataset.id);
    const key = el.dataset.key;
    switch (el.dataset.act) {
      case "toggle":
        this.collapsed[el.dataset.id] = !this.collapsed[el.dataset.id];
        this.saveUi();
        el.setAttribute("aria-expanded", String(!this.collapsed[el.dataset.id]));
        this.root.querySelector("#sec-" + el.dataset.id).hidden = this.collapsed[el.dataset.id];
        break;
      case "plus":
        s.spendStatPoint(key);
        break;
      case "complete":
        this.complete(id);
        break;
      case "reopen":
        s.reopenQuest(id);
        break;
      case "edit-quest":
        this.openQuest(s.quest(id));
        break;
      case "add-quest":
        this.openQuest(null, false);
        break;
      case "add-daily":
        this.openQuest(null, true);
        break;
      case "edit-stat":
        this.openStat(s.statDef(key));
        break;
      case "add-stat":
        this.openStat(null);
        break;
      case "edit-skill":
        this.openEntry(s.skills.find((x) => x.id === id), false);
        break;
      case "add-skill":
        this.openEntry(null, false);
        break;
      case "edit-trait":
        this.openEntry(s.traits.find((x) => x.id === id), true);
        break;
      case "add-trait":
        this.openEntry(null, true);
        break;
      case "edit-name":
        this.openName();
        break;
      case "settings":
        this.openSettings();
        break;
    }
  }

  /** Enter/Leertaste auf Zeilen, die keine echten Knöpfe sind. */
  bindKeys() {
    this.root.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches(".row.tap")) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  complete(id) {
    const s = this.store;
    const q = s.quest(id);
    const oldLevel = s.level;
    const oldRank = s.rank();
    const ups = s.completeQuest(id);
    if (ups < 0) return;
    if (ups === 0) {
      const streak = q.daily ? ` · Serie ${days(s.streak(q))}` : "";
      this.toast(`<b>+${q.xp} XP</b> · ${esc(q.title)}${streak}`);
      return;
    }
    const rankUp = s.rank() !== oldRank ? `<p class="big">Neuer Rang: <b>${s.rank()}</b></p>` : "";
    this.show(`<div class="sheet levelup">
      <h2>Level up!</h2>
      <div class="lv">${oldLevel} → ${s.level}</div>
      <p class="big">${esc(q.title)} · +${q.xp} XP</p>
      <p>+${ups * Rules.POINTS_PER_LEVEL} freie Stat-Punkte. Verteil sie oben bei den Stats mit „+“.</p>
      ${rankUp}
      <div class="actions"><button class="btn primary" data-close>Weiter</button></div>
    </div>`);
  }

  // --- Dialoge -------------------------------------------------------------

  /** Zeigt HTML im Dialog. Knöpfe mit data-close schließen ihn. */
  show(html) {
    this.dialog.innerHTML = html;
    this.dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => this.dialog.close()));
    if (!this.dialog.open) this.dialog.showModal();
    const first = this.dialog.querySelector("[autofocus]");
    if (first && matchMedia("(hover: hover)").matches) first.focus(); // auf dem Handy nicht gleich die Tastatur öffnen
    return this.dialog;
  }

  message(title, text) {
    this.show(`<div class="sheet"><h2>${esc(title)}</h2><p class="big">${esc(text)}</p>
      <div class="actions"><button class="btn primary" data-close>OK</button></div></div>`);
  }

  toast(html) {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 2600);
  }

  /** Löschen-Knopf, der beim ersten Tipp nachfragt und erst beim zweiten löscht. */
  armDelete(button, action) {
    if (!button) return;
    const label = button.textContent;
    button.addEventListener("click", () => {
      if (button.classList.contains("armed")) {
        action();
        this.dialog.close();
        return;
      }
      button.classList.add("armed");
      button.textContent = "Wirklich " + label.toLowerCase() + "?";
      setTimeout(() => {
        button.classList.remove("armed");
        button.textContent = label;
      }, 3500);
    });
  }

  /** Enter im Formular speichert. */
  onSubmit(save) {
    const form = this.dialog.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      save();
    });
  }

  openQuest(q, daily = false) {
    const d = this.show(`<form class="sheet" autocomplete="off" novalidate>
      <h2>${q ? "Quest bearbeiten" : daily ? "Neue tägliche Quest" : "Neue Quest"}</h2>
      <label class="field"><span>Titel</span><input type="text" name="title" maxlength="80" value="${esc(q?.title ?? "")}" placeholder="z. B. 30 Minuten joggen" autofocus></label>
      <label class="field"><span>Beschreibung (optional)</span><textarea name="desc" maxlength="300">${esc(q?.description ?? "")}</textarea></label>
      <label class="field"><span>XP-Belohnung</span><input type="number" name="xp" inputmode="numeric" min="1" max="10000" value="${q?.xp ?? Rules.DEFAULT_QUEST_XP}"></label>
      <label class="switch"><input type="checkbox" name="daily"${(q ? q.daily : daily) ? " checked" : ""}><span>Tägliche Quest<small>Einmal pro Tag abhakbar, um Mitternacht wieder offen</small></span></label>
      <div class="actions">
        ${q ? '<button type="button" class="btn danger grow" data-del>Löschen</button>' : ""}
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>
    </form>`);
    const f = d.querySelector("form");
    this.onSubmit(() => {
      const title = f.title.value.trim();
      if (!title) return f.title.focus();
      const xp = Math.max(1, Math.min(10000, Math.round(Number(f.xp.value) || Rules.DEFAULT_QUEST_XP)));
      if (q) this.store.updateQuest(q.id, title, f.desc.value, xp, f.daily.checked);
      else this.store.addQuest(title, f.desc.value, xp, f.daily.checked);
      d.close();
    });
    if (q) this.armDelete(d.querySelector("[data-del]"), () => this.store.removeQuest(q.id));
  }

  openStat(def) {
    const s = this.store;
    const info = def
      ? `<p>Grundwert ${s.stats[def.key]}${s.traitBonus(def.key) ? `, durch Traits ${signed(s.traitBonus(def.key))}` : ""}. Beim Entfernen bekommst du die darauf verteilten Punkte zurück.</p>`
      : `<p>Der neue Stat startet wie die anderen bei ${Rules.START_STAT} und lässt sich mit Punkten und Traits steigern.</p>`;
    const d = this.show(`<form class="sheet" autocomplete="off" novalidate>
      <h2>${def ? "Stat bearbeiten" : "Eigener Stat"}</h2>
      <div class="inline">
        <label class="field" style="flex:0 0 96px"><span>Kürzel</span><input type="text" name="abbr" maxlength="${Rules.MAX_ABBR}" value="${esc(def?.abbr ?? "")}" placeholder="WIL" autocapitalize="characters" autofocus></label>
        <label class="field"><span>Name</span><input type="text" name="name" maxlength="30" value="${esc(def?.name ?? "")}" placeholder="Willenskraft"></label>
      </div>
      ${info}
      <div class="actions">
        ${def && s.statDefs.length > 1 ? '<button type="button" class="btn danger grow" data-del>Entfernen</button>' : ""}
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>
    </form>`);
    const f = d.querySelector("form");
    this.onSubmit(() => {
      if (!f.abbr.value.trim()) return f.abbr.focus();
      if (!f.name.value.trim()) return f.name.focus();
      if (def) s.updateStat(def.key, f.abbr.value, f.name.value);
      else s.addStat(f.abbr.value, f.name.value);
      d.close();
    });
    if (def) this.armDelete(d.querySelector("[data-del]"), () => s.removeStat(def.key));
  }

  openEntry(e, isTrait) {
    const s = this.store;
    const noun = isTrait ? "Trait" : "Fähigkeit";
    const bonuses = { ...(e?.bonuses ?? {}) };
    const steppers = isTrait
      ? `<div class="field"><span>Stat-Bonus (negativ = Malus)</span><div class="steppers">${s.statDefs
          .map((d) => `<div class="stepper" data-key="${esc(d.key)}"><span class="lbl"><b>${esc(d.abbr)}</b>${esc(d.name)}</span>
            <button type="button" data-step="-1" aria-label="${esc(d.name)} weniger">−</button><output></output>
            <button type="button" data-step="1" aria-label="${esc(d.name)} mehr">+</button></div>`)
          .join("")}</div></div>`
      : "";
    const d = this.show(`<form class="sheet" autocomplete="off" novalidate>
      <h2>${e ? noun + " bearbeiten" : (isTrait ? "Neuer " : "Neue ") + noun}</h2>
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="40" value="${esc(e?.name ?? "")}" placeholder="${isTrait ? "z. B. Frühaufsteher" : "z. B. Spanisch A2"}" autofocus></label>
      <label class="field"><span>Beschreibung (optional)</span><textarea name="desc" maxlength="300">${esc(e?.description ?? "")}</textarea></label>
      ${steppers}
      <div class="actions">
        ${e ? '<button type="button" class="btn danger grow" data-del>Entfernen</button>' : ""}
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>
    </form>`);
    const paint = () =>
      d.querySelectorAll(".stepper").forEach((row) => {
        const v = bonuses[row.dataset.key] ?? 0;
        const out = row.querySelector("output");
        out.textContent = v === 0 ? "0" : signed(v);
        out.className = v > 0 ? "pos" : v < 0 ? "neg" : "";
      });
    d.querySelectorAll("[data-step]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.closest(".stepper").dataset.key;
        bonuses[k] = Math.max(-99, Math.min(99, (bonuses[k] ?? 0) + Number(b.dataset.step)));
        paint();
      }),
    );
    paint();
    const f = d.querySelector("form");
    this.onSubmit(() => {
      const name = f.name.value.trim();
      if (!name) return f.name.focus();
      if (isTrait) {
        if (e) s.updateTrait(e.id, name, f.desc.value, bonuses);
        else s.addTrait(name, f.desc.value, bonuses);
      } else if (e) s.updateSkill(e.id, name, f.desc.value);
      else s.addSkill(name, f.desc.value);
      d.close();
    });
    if (e) this.armDelete(d.querySelector("[data-del]"), () => (isTrait ? s.removeTrait(e.id) : s.removeSkill(e.id)));
  }

  openName() {
    const d = this.show(`<form class="sheet" autocomplete="off" novalidate>
      <h2>Dein Name</h2>
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="24" value="${esc(this.store.name)}" autofocus></label>
      <div class="actions"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div>
    </form>`);
    const f = d.querySelector("form");
    this.onSubmit(() => {
      this.store.setName(f.name.value);
      d.close();
    });
  }

  openFirstSync() {
    const d = this.show(`<div class="sheet">
      <h2>Welcher Stand soll bleiben?</h2>
      <p class="big">In der Cloud liegt schon ein Spielstand, und auf diesem Gerät gibt es auch Fortschritt. Der andere Stand wird als Sicherung aufgehoben.</p>
      <div class="actions"><button class="btn" data-keep>Dieses Gerät behalten</button><button class="btn primary" data-cloud>Cloud-Stand übernehmen</button></div>
    </div>`);
    d.querySelector("[data-keep]").addEventListener("click", () => {
      d.close();
      this.sync.resolveFirstSync(true);
    });
    d.querySelector("[data-cloud]").addEventListener("click", () => {
      d.close();
      this.sync.resolveFirstSync(false);
    });
  }

  openSettings() {
    const s = this.store;
    const sync = this.sync;
    const backups = s.backups();
    const syncPart = sync.enabled()
      ? `<p class="status" data-status>${esc(sync.status)}</p>
         <p>Dein Spielstand wird in einem privaten GitHub Gist gespeichert und auf allen Geräten mit demselben Token automatisch abgeglichen.</p>
         <div class="actions"><button type="button" class="btn grow" data-disconnect>Trennen</button><button type="button" class="btn primary" data-sync>Jetzt abgleichen</button></div>`
      : `<p>Dein Spielstand wird in einem privaten GitHub Gist gespeichert und auf allen Geräten mit demselben Token automatisch abgeglichen.</p>
         <p>1. Token auf GitHub erstellen (das Recht „gist“ ist vorausgewählt), dann kopieren.</p>
         <a class="btn" href="${TOKEN_URL}" target="_blank" rel="noopener">Token auf GitHub erstellen</a>
         <p>2. Token hier einfügen. Auf dem zweiten Gerät denselben Token nutzen.</p>
         <label class="field"><span>GitHub-Token</span><input type="password" name="token" placeholder="ghp_…" autocomplete="off" spellcheck="false"></label>
         <p class="status" data-status>${esc(sync.status === "Sync aus" ? "" : sync.status)}</p>
         <div class="actions"><button class="btn primary" data-connect>Verbinden</button></div>`;
    const list = backups.length
      ? `<div class="backups">${backups
          .map((b, i) => `<div class="backup"><span>${esc(b.label)}<small>${esc(formatGerman(b.at))} ${esc(String(b.at).slice(11, 16))}${b.data?.level ? ` · Level ${b.data.level}` : ""}</small></span>
            ${b.data?.raw === undefined ? `<button type="button" class="btn" data-restore="${i}">Wiederherstellen</button>` : ""}</div>`)
          .join("")}</div>`
      : "<p>Noch keine Sicherungen. Sie entstehen automatisch bei Sync-Konflikten, beim Import und beim Wiederherstellen.</p>";
    const d = this.show(`<form class="sheet" autocomplete="off" novalidate>
      <h2>Einstellungen</h2>
      <div class="group"><h3>Sync zwischen Geräten</h3>${syncPart}</div>
      <div class="group"><h3>Spielstand</h3>
        <p>Als Datei sichern oder einen Spielstand laden, z. B. die player.json der früheren PC-App.</p>
        <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-export>Exportieren</button><button type="button" class="btn" data-import>Importieren</button></div>
        <input type="file" accept=".json,application/json" data-file hidden>
      </div>
      <div class="group"><h3>Sicherungen</h3>${list}</div>
      <div class="actions"><button type="button" class="btn primary" data-close>Fertig</button></div>
    </form>`);
    const status = () => d.querySelector("[data-status]");
    const onStatus = () => {
      if (!d.open) return sync.removeEventListener("status", onStatus);
      if (status()) status().textContent = sync.status;
    };
    sync.addEventListener("status", onStatus);

    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = d.querySelector("[name=token]");
      if (!input) return;
      const token = input.value.trim();
      if (!token) return input.focus();
      await sync.connect(token);
      if (d.open && sync.status.startsWith("Synchronisiert")) this.openSettings(); // neu zeichnen: jetzt verbunden
    });
    d.querySelector("[data-sync]")?.addEventListener("click", () => sync.sync());
    d.querySelector("[data-disconnect]")?.addEventListener("click", () => {
      sync.disconnect();
      this.openSettings();
      this.renderFooter();
    });
    d.querySelector("[data-export]").addEventListener("click", () => this.exportSave());
    const file = d.querySelector("[data-file]");
    d.querySelector("[data-import]").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      let data = null;
      try {
        data = JSON.parse(await f.text());
      } catch {
        /* unten gemeldet */
      }
      if (!data || typeof data !== "object" || Array.isArray(data) || !("level" in data || "quests" in data)) {
        this.message("Import", "Die Datei ist kein Stat-Sheet-Spielstand.");
        return;
      }
      this.replaceWith(data, "vor dem Import");
      this.message("Import", `Spielstand von „${data.name ?? "Spieler"}“ geladen. Dein vorheriger Stand liegt in den Sicherungen.`);
    });
    d.querySelectorAll("[data-restore]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!b.classList.contains("armed")) {
          b.classList.add("armed", "danger");
          b.textContent = "Wirklich?";
          return;
        }
        this.replaceWith(backups[Number(b.dataset.restore)].data, "vor dem Wiederherstellen");
        d.close();
        this.toast("Sicherung wiederhergestellt");
      }),
    );
  }

  /** Ersetzt den Spielstand und lädt ihn als neue Änderung hoch; der alte Stand wird gesichert. */
  replaceWith(data, label) {
    const s = this.store;
    s.writeBackup(s.toDict(), label);
    s.fromDict(data);
    s.resetDailies();
    s.commit();
  }

  exportSave() {
    const blob = new Blob([JSON.stringify(this.store.toDict(), null, "\t")], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stat-sheet-${this.store.today()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
