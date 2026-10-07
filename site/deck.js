// Presentation controller: navigation, per-slide simulator, rendering loop.
(function () {
  "use strict";
  const { SLIDES, RULES } = window.TALK;
  const { Sim } = window.Raft;
  const V = window.RaftView;
  const $ = id => document.getElementById(id);

  // Slower than the sandbox so the audience can follow each message.
  const TALK_CFG = { latencyBase: 150, latencyPerUnit: 300, latencyJitter: 100, heartbeat: 2000, electionMin: 2500, electionMax: 7500 };

  // Every (slide, fragment) that introduces a rule, in talk order.
  const RULE_POINTS = [];
  SLIDES.forEach((sl, i) => (sl.frags || []).forEach((f, j) => { if (f.rule) RULE_POINTS.push({ i, j, key: f.rule }); }));

  const deck = { i: 0, frag: 0, sim: null, view: null, paused: false, speed: 1, notes: false, sandboxLoaded: false };
  window.deck = deck; // handy for debugging and the test harness

  function slideFromHash() {
    const m = /^#\/(\d+)/.exec(location.hash);
    return m ? Math.min(SLIDES.length - 1, Math.max(0, +m[1])) : 0;
  }

  function enter(i) {
    deck.i = i; deck.frag = 0;
    const sl = SLIDES[i];
    history.replaceState(null, "", "#/" + i);
    const layout = sl.layout || "demo";
    document.body.className = "layout-" + layout;

    $("kicker").textContent = sl.kicker || "";
    $("kicker").className = "kicker " + (sl.kicker || "").toLowerCase().replace(/\s+/g, "-");
    $("title").textContent = sl.title;
    document.title = sl.title + " · Raft";

    $("bullets").innerHTML = (sl.frags || []).map(f => `<li>${f.text}</li>`).join("");
    $("notes").innerHTML = `<b>Notes:</b> ${sl.notes || "—"}`;

    deck.sim = null;
    if (layout === "demo") {
      const sim = new Sim({ flags: sl.flags || {}, cfg: { ...TALK_CFG, ...(sl.cfg || {}) }, seed: sl.seed || i + 1 });
      if (sl.clients) sim.clients = sl.clients;
      if (sl.setup) sl.setup(sim);
      deck.sim = sim;
      if (!deck.view) deck.view = new V.ClusterView($("cv"), sim);
      deck.view.sim = sim;
      deck.view.overlay = null;
      const panels = sl.panels || [];
      $("stage").classList.toggle("nodata", panels.length === 0);
      $("cardLogs").classList.toggle("hidden", !panels.includes("logs"));
      $("cardSm").classList.toggle("hidden", !panels.includes("sm"));
      $("cardReceipts").classList.toggle("hidden", !panels.includes("receipts"));
      $("cardEvents").classList.toggle("hidden", !panels.includes("events"));
      $("btnWrite").classList.toggle("hidden", sim.clients.length === 0);
      $("btnPart").classList.toggle("hidden", !(sl.controls || []).includes("partition"));
      requestAnimationFrame(() => { deck.view.fit(); renderPanels(); });
    } else if (layout === "hero") {
      $("hero").innerHTML = `<h2>${sl.title}</h2><p>${sl.sub || ""}</p><div class="start">press → to start</div>`;
    } else if (layout === "recap") {
      renderRecap();
    } else if (layout === "sandbox") {
      if (!deck.sandboxLoaded) { $("sandbox").src = "sandbox.html?embed"; deck.sandboxLoaded = true; }
    }
    renderBullets(); renderRules(); renderProgress();
  }

  function next() {
    const sl = SLIDES[deck.i];
    const frags = sl.frags || [];
    if (deck.frag < frags.length) {
      const f = frags[deck.frag];
      deck.frag++;
      if (f.do && deck.sim) f.do(deck.sim, deck);
      renderBullets(); renderRules();
    } else if (deck.i < SLIDES.length - 1) {
      enter(deck.i + 1);
    }
  }
  function prev() { if (deck.i > 0) enter(deck.i - 1); }

  function renderBullets() {
    [...$("bullets").children].forEach((li, k) => {
      li.classList.toggle("shown", k < deck.frag);
      li.classList.toggle("past", k < deck.frag - 1);
    });
  }

  function renderRules() {
    const shown = RULE_POINTS.filter(p => p.i < deck.i || (p.i === deck.i && p.j < deck.frag));
    $("rules").innerHTML = shown.map(p => `<li class="${p.i === deck.i ? "fresh" : ""}">${RULES[p.key]}</li>`).join("") ||
      '<li style="list-style:none;margin-left:-1.4em;color:var(--muted)">none yet</li>';
  }

  function renderProgress() {
    $("progress").innerHTML = SLIDES.map((s, k) =>
      `<span data-k="${k}" title="${k}: ${V.esc(s.title)}${s.optional ? " (optional)" : ""}" class="${s.optional ? "optional " : ""}${k < deck.i ? "done" : k === deck.i ? "current" : ""}"></span>`).join("");
  }

  function renderRecap() {
    const g = (title, keys) => `<div class="group"><h3>${title}</h3><ul>${keys.map(k => `<li>${RULES[k]}</li>`).join("")}</ul></div>`;
    $("recap").innerHTML = `<div class="groups">
      ${g("Leader election", ["terms", "random", "restrict", "stepdown"])}
      ${g("Log replication", ["leader", "prev", "backoff"])}
      ${g("Safety", ["log", "majority", "commit", "curterm"])}
    </div>
    <div class="skipped"><b>Not covered today:</b> log compaction &amp; snapshots · cluster membership changes ·
      exactly-once client semantics · fast linearizable reads · persisting state to disk before replying.</div>
    <div class="skipped"><b>Paper:</b> Ongaro &amp; Ousterhout, <i>In Search of an Understandable Consensus Algorithm</i> (2014) —
      <a href="https://raft.github.io/" style="color:var(--ae)">raft.github.io</a></div>`;
  }

  function renderPanels() {
    const sim = deck.sim; if (!sim) return;
    const sl = SLIDES[deck.i], panels = sl.panels || [];
    if (panels.includes("logs")) V.renderLogs(sim, $("logs"), { minCols: 6 });
    if (panels.includes("sm")) V.renderStateMachines(sim, $("sms"));
    if (panels.includes("receipts")) V.renderReceipts(sim, $("receipts"));
    if (panels.includes("events")) V.renderEvents(sim, $("events"));
    V.clearFlashes(sim);
    $("btnPart").textContent = sim.partition ? "Heal network" : "Partition";
    $("btnPart").classList.toggle("on", !!sim.partition);
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now(), lastPanel = 0, lastSize = "";
  function frame(t) {
    const dt = Math.min(100, t - last); last = t;
    if (deck.sim) {
      if (!deck.paused) deck.sim.advance(dt * deck.speed);
      const r = $("cv").getBoundingClientRect(), size = r.width + "x" + r.height;
      if (size !== lastSize) { deck.view.fit(); lastSize = size; }
      deck.view.draw({ paused: deck.paused });
      if (t - lastPanel > 120) { renderPanels(); lastPanel = t; }
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ input
  function clientWrite() {
    const sim = deck.sim; if (!sim || !sim.clients.length) return;
    sim.flags.mode === "broadcast" ? sim.clientBroadcast() : sim.clientRequest();
  }
  function togglePartition() {
    const sim = deck.sim; if (!sim) return;
    sim.partition ? sim.heal() : sim.setPartition([0, 1]);
  }
  function setSpeed(s) { deck.speed = Math.max(0.25, Math.min(4, s)); $("speed").textContent = deck.speed.toFixed(2).replace(/0$/, "") + "×"; }
  function togglePause() { deck.paused = !deck.paused; $("btnPause").textContent = deck.paused ? "▶" : "❚❚"; }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight": case " ": case "PageDown": case "Enter": next(); break;
      case "ArrowLeft": case "PageUp": case "Backspace": prev(); break;
      case "Home": enter(0); break;
      case "End": enter(SLIDES.length - 1); break;
      case "r": case "R": enter(deck.i); break;
      case "p": case "P": togglePause(); break;
      case "n": case "N": deck.notes = !deck.notes; $("notes").classList.toggle("hidden", !deck.notes); break;
      case "c": case "C": clientWrite(); break;
      case "+": case "=": setSpeed(deck.speed * 1.5); break;
      case "-": case "_": setSpeed(deck.speed / 1.5); break;
      default: return;
    }
    e.preventDefault();
  }
  document.addEventListener("keydown", onKey);

  // The sandbox iframe swallows key presses; forward navigation keys back to the deck.
  $("sandbox").addEventListener("load", () => {
    try {
      $("sandbox").contentWindow.addEventListener("keydown", e => {
        if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(e.key)) onKey(e);
      });
    } catch (_) { /* cross-origin: ignore */ }
  });

  $("cv").addEventListener("click", ev => {
    if (!deck.sim) return;
    const r = $("cv").getBoundingClientRect();
    const id = deck.view.serverAt(ev.clientX - r.left, ev.clientY - r.top);
    if (id == null) return;
    ev.shiftKey ? deck.sim.forceTimeout(id) : deck.sim.toggleCrash(id);
  });
  $("btnWrite").onclick = e => { clientWrite(); e.target.blur(); };
  $("btnPart").onclick = e => { togglePartition(); e.target.blur(); };
  $("btnReplay").onclick = e => { enter(deck.i); e.target.blur(); };
  $("btnPause").onclick = e => { togglePause(); e.target.blur(); };
  $("progress").addEventListener("click", e => { const k = e.target.dataset.k; if (k != null) enter(+k); });
  window.addEventListener("hashchange", () => { const k = slideFromHash(); if (k !== deck.i) enter(k); });

  deck.next = next; deck.prev = prev; deck.enter = enter;
  enter(slideFromHash());
  requestAnimationFrame(frame);
})();
