// Raft simulation engine shared by the presentation (index.html) and the sandbox.
//
// Every mechanism the talk introduces can be switched off with a flag, so each
// slide can show what goes wrong without it. All times are simulated ms.
(function (global) {
  "use strict";

  const DEFAULT_FLAGS = {
    mode: "raft",               // "raft" | "broadcast" (clients write to every server, no protocol)
    elections: true,            // false: leader is fixed by the slide setup, nobody times out
    randomTimeout: true,        // false: every server uses cfg.fixedTimeout
    acks: true,                 // AppendEntries carries prevIndex/prevTerm, followers reply, leader retries
    commit: true,               // false: apply entries (and answer clients) as soon as they are appended
    electionRestriction: true,  // only vote for candidates whose log is at least as up to date
    currentTermCommit: true,    // only count replicas for entries from the leader's current term
  };

  const DEFAULT_CFG = {
    n: 5,
    latencyBase: 150, latencyPerUnit: 380, latencyJitter: 150,
    heartbeat: 2200,
    electionMin: 5000, electionMax: 9000,
    fixedTimeout: 4000,
    maxEntries: 4,
    lossRate: 0,
  };

  const KEYS = ["x", "y", "z"];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const isClient = id => typeof id === "string";
  const fmtCmd = c => (c ? `${c.key}=${c.val}` : "·");
  const name = id => (isClient(id) ? id : "S" + (id + 1));
  const sameEntry = (a, b) => !!a && !!b && a.term === b.term && fmtCmd(a.cmd) === fmtCmd(b.cmd);

  class Sim {
    constructor({ flags = {}, cfg = {}, seed = 1 } = {}) {
      this.flags = { ...DEFAULT_FLAGS, ...flags };
      this.cfg = { ...DEFAULT_CFG, ...cfg };
      this.rand = mulberry32(seed);
      this.n = this.cfg.n;
      this.majority = Math.floor(this.n / 2) + 1;
      this.now = 0;
      this.servers = [];
      for (let i = 0; i < this.n; i++) this.servers.push(this.makeServer(i));
      this.clients = [{ id: "client", x: 0, y: 0 }];
      this.messages = [];
      this.events = [];
      this.timers = [];
      this.watchers = [];
      this.acked = [];          // writes a client was told succeeded
      this.violations = [];     // safety violations (committed data lost)
      this.committed = {};      // index -> entry, every entry any server ever considered committed
      this.partition = null;    // null or Set of server ids on "side A"
      this.dropRules = [];
      this.newCells = new Set();
      this.flashKeys = new Set();
      this.cmdCounter = 0;
      for (const s of this.servers) this.resetElectionTimer(s);
    }

    makeServer(id) {
      return {
        id,
        term: 0, votedFor: null, log: [],                       // persistent
        state: "follower", commitIndex: 0, lastApplied: 0, kv: {}, // volatile
        leaderId: null, votes: new Set(),
        nextIndex: [], matchIndex: [], sendDue: [], inflight: [], pending: {},
        electionDeadline: Infinity, timeoutLen: 1,
        crashed: false,
      };
    }

    // ------------------------------------------------------------------ geometry
    pos(id) {
      if (isClient(id)) {
        const c = this.clients.find(c => c.id === id) || this.clients[0];
        return { x: c.x, y: c.y };
      }
      const a = -Math.PI / 2 + id * 2 * Math.PI / this.n;
      return { x: Math.cos(a), y: Math.sin(a) };
    }

    latency(from, to) {
      const a = this.pos(from), b = this.pos(to);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      return this.cfg.latencyBase + this.cfg.latencyPerUnit * d + this.rand() * this.cfg.latencyJitter;
    }

    // ------------------------------------------------------------------ helpers
    log(text, cls = "") {
      this.events.push({ t: this.now, text, cls });
      if (this.events.length > 400) this.events.shift();
    }
    after(ms, fn) { this.timers.push({ at: this.now + ms, fn }); }
    waitFor(pred, fn) { this.watchers.push({ pred, fn }); }
    nextCmd() {
      const k = this.cmdCounter++;
      return { key: KEYS[k % KEYS.length], val: k + 1 };
    }
    lastLogIndex(s) { return s.log.length; }
    lastLogTerm(s) { return s.log.length ? s.log[s.log.length - 1].term : 0; }
    leader() {
      let best = null;
      for (const s of this.servers) if (!s.crashed && s.state === "leader" && (!best || s.term > best.term)) best = s;
      return best;
    }
    leaders() { return this.servers.filter(s => !s.crashed && s.state === "leader"); }
    canReach(a, b) {
      if (isClient(a) || isClient(b) || !this.partition) return true;
      return this.partition.has(a) === this.partition.has(b);
    }

    resetElectionTimer(s) {
      if (!this.flags.elections || this.flags.mode !== "raft") { s.electionDeadline = Infinity; return; }
      s.timeoutLen = this.flags.randomTimeout
        ? this.cfg.electionMin + this.rand() * (this.cfg.electionMax - this.cfg.electionMin)
        : this.cfg.fixedTimeout;
      s.electionDeadline = this.now + s.timeoutLen;
    }

    // ------------------------------------------------------------------ network
    send(from, to, msg) {
      if (!isClient(from) && this.servers[from].crashed) return;
      msg.from = from; msg.to = to;
      msg.sent = this.now;
      msg.arrive = this.now + this.latency(from, to);
      msg.drop = false;
      if (!this.canReach(from, to)) msg.drop = true;
      for (const r of this.dropRules) {
        if (r.count > 0 && (r.to == null || r.to === to) && (r.from == null || r.from === from) &&
            (r.type == null || r.type === msg.type) && (!r.withEntries || (msg.entries && msg.entries.length))) {
          r.count--; msg.drop = true; break;
        }
      }
      this.dropRules = this.dropRules.filter(r => r.count > 0);
      if (!msg.drop && this.cfg.lossRate > 0 && !isClient(from) && !isClient(to) && this.rand() < this.cfg.lossRate) msg.drop = true;
      this.messages.push(msg);
    }
    dropNext(rule) { this.dropRules.push({ count: 1, ...rule }); }
    setPartition(ids) {
      this.partition = new Set(ids);
      const other = this.servers.map(s => s.id).filter(i => !this.partition.has(i));
      this.log(`Network partition: {${ids.map(name).join(", ")}} | {${other.map(name).join(", ")}}`, "ev-crash");
    }
    heal() { if (this.partition) { this.partition = null; this.log("Network healed", "ev-crash"); } }

    // ------------------------------------------------------------------ clients
    clientRequest(cmd = this.nextCmd(), clientId = this.clients[0].id) {
      const l = this.leader();
      if (!l) { this.log(`${clientId}: no leader, "${fmtCmd(cmd)}" not sent`, "ev-client"); return null; }
      this.send(clientId, l.id, { type: "CLIENT", cmd });
      return cmd;
    }
    clientRequestTo(id, cmd = this.nextCmd(), clientId = this.clients[0].id) {
      this.send(clientId, id, { type: "CLIENT", cmd });
      return cmd;
    }
    clientBroadcast(cmd = this.nextCmd(), clientId = this.clients[0].id) {
      for (const s of this.servers) this.send(clientId, s.id, { type: "CLIENT", cmd });
      return cmd;
    }

    // ------------------------------------------------------------------ crash/restart
    crash(id) {
      const s = this.servers[id];
      if (s.crashed) return;
      s.crashed = true;
      this.log(`${name(id)} went OFFLINE${s.state === "leader" ? " (was leader)" : ""}`, "ev-crash");
    }
    restart(id) {
      const s = this.servers[id];
      if (!s.crashed) return;
      s.crashed = false;
      s.state = "follower";
      s.commitIndex = 0; s.lastApplied = 0; s.kv = {};
      s.leaderId = null; s.votes = new Set(); s.pending = {};
      if (this.flags.mode === "broadcast" || !this.flags.commit) { s.commitIndex = s.log.length; this.apply(s); }
      this.resetElectionTimer(s);
      this.log(`${name(id)} restarted (term ${s.term}, ${s.log.length} log entries kept)`, "ev-crash");
    }
    toggleCrash(id) { this.servers[id].crashed ? this.restart(id) : this.crash(id); }
    forceTimeout(id) {
      const s = this.servers[id];
      if (!s.crashed && s.state !== "leader" && this.flags.mode === "raft") s.electionDeadline = this.now;
    }

    // ------------------------------------------------------------------ presets for slides
    entryFor(index, term) {
      return { term, cmd: { key: KEYS[(index - 1) % KEYS.length], val: index * 10 + term } };
    }
    // terms: array (per server) of arrays of entry terms. commit: per-server commit index.
    preset({ terms, commit = [] }) {
      for (const s of this.servers) {
        s.log = (terms[s.id] || []).map((t, i) => this.entryFor(i + 1, t));
        s.commitIndex = 0; s.lastApplied = 0; s.kv = {};
        const c = this.flags.commit && this.flags.mode === "raft" ? (commit[s.id] || 0) : s.log.length;
        s.commitIndex = Math.min(c, s.log.length);
        this.apply(s, true);
      }
      this.cmdCounter = Math.max(0, ...this.servers.map(s => s.log.length));
    }
    makeLeader(id, term) {
      for (const s of this.servers) {
        s.term = term; s.votedFor = id; s.state = "follower"; s.leaderId = id;
        this.resetElectionTimer(s);
      }
      const l = this.servers[id];
      this.becomeLeader(l, true);
    }

    // ------------------------------------------------------------------ Raft rules
    stepDown(s, term) {
      if (term > s.term) { s.term = term; s.votedFor = null; }
      if (s.state !== "follower") {
        s.state = "follower";
        s.votes.clear();
        s.pending = {};
        this.resetElectionTimer(s);
      }
    }

    startElection(s) {
      s.state = "candidate";
      s.term += 1;
      s.votedFor = s.id;
      s.votes = new Set([s.id]);
      s.leaderId = null;
      this.resetElectionTimer(s);
      this.log(`${name(s.id)} timed out → candidate for term ${s.term}`, "ev-cand");
      for (const p of this.servers) {
        if (p.id === s.id) continue;
        this.send(s.id, p.id, { type: "RV", term: s.term, lastLogIndex: this.lastLogIndex(s), lastLogTerm: this.lastLogTerm(s) });
      }
    }

    becomeLeader(s, quiet = false) {
      s.state = "leader";
      s.leaderId = s.id;
      s.pending = {};
      for (let i = 0; i < this.n; i++) {
        s.nextIndex[i] = s.log.length + 1;
        s.matchIndex[i] = 0;
        s.sendDue[i] = this.now;
        s.inflight[i] = false;
      }
      s.matchIndex[s.id] = s.log.length;
      if (!quiet) this.log(`${name(s.id)} won election with ${s.votes.size} votes → LEADER of term ${s.term}`, "ev-leader");
      else this.log(`${name(s.id)} is leader of term ${s.term}`, "ev-leader");
    }

    sendAppendEntries(s, peer) {
      const prevIndex = s.nextIndex[peer] - 1;
      const prevTerm = prevIndex > 0 ? s.log[prevIndex - 1].term : 0;
      const entries = s.log.slice(prevIndex, prevIndex + this.cfg.maxEntries).map(e => ({ ...e }));
      this.send(s.id, peer, { type: "AE", term: s.term, prevIndex, prevTerm, entries, leaderCommit: s.commitIndex });
      s.inflight[peer] = true;
      s.sendDue[peer] = this.now + this.cfg.heartbeat;
    }

    advanceCommit(s) {
      for (let n = s.log.length; n > s.commitIndex; n--) {
        if (this.flags.currentTermCommit && s.log[n - 1].term !== s.term) break;
        let count = 0;
        for (let i = 0; i < this.n; i++) if (s.matchIndex[i] >= n) count++;
        if (count >= this.majority) {
          this.log(`${name(s.id)} commits up to index ${n} (stored on ${count}/${this.n})`, "ev-commit");
          s.commitIndex = n;
          this.apply(s);
          this.answerClients(s);
          break;
        }
      }
    }

    answerClients(s) {
      for (const k of Object.keys(s.pending)) {
        const idx = +k, p = s.pending[k];
        if (idx <= s.commitIndex) {
          if (s.log[idx - 1] && s.log[idx - 1].term === p.term) this.send(s.id, p.client, { type: "OK", cmd: p.cmd, index: idx, term: p.term });
          delete s.pending[k];
        }
      }
    }

    apply(s, quiet = false) {
      while (s.lastApplied < s.commitIndex) {
        s.lastApplied++;
        const e = s.log[s.lastApplied - 1];
        if (this.flags.mode === "raft" && this.flags.commit) {
          const prev = this.committed[s.lastApplied];
          if (!prev) this.committed[s.lastApplied] = { ...e };
        }
        if (e.cmd) {
          s.kv[e.cmd.key] = e.cmd.val;
          if (!quiet) this.flashKeys.add(s.id + ":" + e.cmd.key);
        }
      }
    }

    // Remove s.log[from-1 ..]; record a violation if anything committed or acknowledged disappears.
    truncate(s, from) {
      const removed = s.log.slice(from - 1);
      removed.forEach((e, k) => {
        const idx = from + k;
        const c = this.committed[idx];
        if (c && sameEntry(c, e)) {
          const v = `Committed entry ${idx} (${fmtCmd(e.cmd)}, term ${e.term}) overwritten on ${name(s.id)}!`;
          this.violations.push({ t: this.now, text: v });
          this.log("⚠ " + v, "ev-bad");
        }
      });
      if (!this.flags.commit && removed.length && from <= s.lastApplied) {
        this.log(`${name(s.id)} drops entries it had already applied: ${removed.map(e => fmtCmd(e.cmd)).join(", ")}`, "ev-trunc");
      } else if (removed.length) {
        this.log(`${name(s.id)} conflict at index ${from}: removes ${removed.length} entr${removed.length === 1 ? "y" : "ies"}`, "ev-trunc");
      }
      s.log.length = from - 1;
      s.commitIndex = Math.min(s.commitIndex, from - 1);
      s.lastApplied = Math.min(s.lastApplied, from - 1);
    }

    upToDate(s, m) {
      if (!this.flags.electionRestriction) return true;
      return m.lastLogTerm > this.lastLogTerm(s) ||
        (m.lastLogTerm === this.lastLogTerm(s) && m.lastLogIndex >= this.lastLogIndex(s));
    }

    appendLocal(s, e) {
      s.log.push(e);
      this.newCells.add(s.id + ":" + s.log.length);
    }

    handle(s, m) {
      if (m.type === "CLIENT") return this.handleClient(s, m);

      if (m.term > s.term) {
        if (s.state === "leader") this.log(`${name(s.id)} sees term ${m.term} > ${s.term} → steps down`, "ev-cand");
        this.stepDown(s, m.term);
      }

      switch (m.type) {
        case "RV": {
          let granted = false;
          const logOk = this.upToDate(s, m);
          if (m.term === s.term && (s.votedFor === null || s.votedFor === m.from) && logOk) {
            granted = true;
            s.votedFor = m.from;
            this.resetElectionTimer(s);
          } else if (m.term === s.term && !logOk && (s.votedFor === null || s.votedFor === m.from)) {
            this.log(`${name(s.id)} refuses vote: ${name(m.from)}'s log is behind`, "ev-cand");
          }
          this.send(s.id, m.from, { type: "RVR", term: s.term, granted });
          break;
        }
        case "RVR": {
          if (s.state === "candidate" && m.term === s.term && m.granted) {
            s.votes.add(m.from);
            if (s.votes.size >= this.majority) this.becomeLeader(s);
          }
          break;
        }
        case "AE": {
          if (!this.flags.acks) { // naive: append whatever arrives
            if (s.state !== "leader") for (const e of m.entries) this.appendLocal(s, { ...e });
            if (!this.flags.commit) { s.commitIndex = s.log.length; this.apply(s); }
            break;
          }
          if (m.term < s.term) {
            this.send(s.id, m.from, { type: "AER", term: s.term, success: false, prevIndex: m.prevIndex, matchIndex: 0 });
            break;
          }
          if (s.state !== "follower") this.stepDown(s, m.term);
          s.leaderId = m.from;
          this.resetElectionTimer(s);
          const prevOk = m.prevIndex === 0 ||
            (m.prevIndex <= s.log.length && s.log[m.prevIndex - 1].term === m.prevTerm);
          if (!prevOk) {
            this.send(s.id, m.from, { type: "AER", term: s.term, success: false, prevIndex: m.prevIndex, matchIndex: 0 });
            break;
          }
          let idx = m.prevIndex;
          for (const e of m.entries) {
            idx++;
            if (s.log.length >= idx && s.log[idx - 1].term !== e.term) this.truncate(s, idx);
            if (s.log.length < idx) this.appendLocal(s, { ...e });
          }
          const lastNew = m.prevIndex + m.entries.length;
          if (!this.flags.commit) {
            s.commitIndex = s.log.length; this.apply(s);
          } else if (m.leaderCommit > s.commitIndex) {
            s.commitIndex = Math.min(m.leaderCommit, lastNew);
            this.apply(s);
          }
          this.send(s.id, m.from, { type: "AER", term: s.term, success: true, prevIndex: m.prevIndex, matchIndex: lastNew, n: m.entries.length });
          break;
        }
        case "AER": {
          if (s.state !== "leader" || m.term !== s.term) break;
          const p = m.from;
          if (m.success) {
            s.inflight[p] = false;
            s.matchIndex[p] = Math.max(s.matchIndex[p], m.matchIndex);
            s.nextIndex[p] = Math.max(s.nextIndex[p], s.matchIndex[p] + 1);
            if (this.flags.commit) this.advanceCommit(s);
            if (s.nextIndex[p] <= s.log.length) s.sendDue[p] = this.now;
          } else if (m.prevIndex === s.nextIndex[p] - 1) { // reply to our current probe
            s.inflight[p] = false;
            s.nextIndex[p] = Math.max(1, s.nextIndex[p] - 1);
            this.log(`${name(p)} rejected prevIndex ${m.prevIndex} → ${name(s.id)} retries from index ${s.nextIndex[p]}`, "ev-trunc");
            s.sendDue[p] = this.now;
          }
          break;
        }
      }
    }

    handleClient(s, m) {
      if (this.flags.mode === "broadcast") {
        this.appendLocal(s, { term: 0, cmd: m.cmd });
        s.commitIndex = s.log.length;
        this.apply(s);
        return;
      }
      if (s.state !== "leader") {
        this.log(`${name(s.id)} rejected "${fmtCmd(m.cmd)}": not leader`, "ev-client");
        return;
      }
      this.appendLocal(s, { term: s.term, cmd: m.cmd });
      const idx = s.log.length;
      s.matchIndex[s.id] = idx;
      this.log(`${name(s.id)} appended "${fmtCmd(m.cmd)}" at index ${idx} (term ${s.term})`, "ev-client");
      if (!this.flags.commit) {
        s.commitIndex = idx; this.apply(s);
        this.send(s.id, m.from, { type: "OK", cmd: m.cmd, index: idx, term: s.term });
      } else {
        s.pending[idx] = { cmd: m.cmd, client: m.from, term: s.term };
      }
      if (!this.flags.acks) {
        for (const p of this.servers) if (p.id !== s.id) this.send(s.id, p.id, { type: "AE", term: s.term, entries: [{ term: s.term, cmd: m.cmd }] });
      } else {
        for (let i = 0; i < this.n; i++) if (i !== s.id && !s.inflight[i]) s.sendDue[i] = this.now;
      }
    }

    deliverToClient(m) {
      if (m.type === "OK") {
        this.acked.push({ cmd: m.cmd, index: m.index, term: m.term, t: this.now, lost: false });
        this.log(`client got OK for "${fmtCmd(m.cmd)}" (index ${m.index})`, "ev-client");
      }
    }

    // A write the client was told succeeded is lost if the current leader's log disagrees.
    updateAcked() {
      const l = this.leader();
      if (!l) return;
      for (const a of this.acked) {
        if (a.lost) continue;
        const e = l.log[a.index - 1];
        if (!e || e.term !== a.term) {
          a.lost = true;
          this.log(`⚠ "${fmtCmd(a.cmd)}" was acknowledged to the client but is gone from leader ${name(l.id)}'s log`, "ev-bad");
        }
      }
    }

    // ------------------------------------------------------------------ main step
    step(dt) {
      this.now += dt;

      if (this.timers.length) {
        const due = this.timers.filter(t => t.at <= this.now).sort((a, b) => a.at - b.at);
        this.timers = this.timers.filter(t => t.at > this.now);
        for (const t of due) t.fn(this);
      }

      const arrived = [];
      this.messages = this.messages.filter(m => {
        if (m.drop) return (this.now - m.sent) / (m.arrive - m.sent) < 0.8;
        if (m.arrive <= this.now) { arrived.push(m); return false; }
        return true;
      });
      arrived.sort((a, b) => a.arrive - b.arrive);
      for (const m of arrived) {
        if (!this.canReach(m.from, m.to)) continue;
        if (isClient(m.to)) { this.deliverToClient(m); continue; }
        const s = this.servers[m.to];
        if (s.crashed) continue;
        this.handle(s, m);
      }

      if (this.flags.mode === "raft") {
        for (const s of this.servers) {
          if (s.crashed) continue;
          if (s.state === "leader") {
            if (!this.flags.acks) continue;
            for (let i = 0; i < this.n; i++) if (i !== s.id && s.sendDue[i] <= this.now) this.sendAppendEntries(s, i);
          } else if (this.now >= s.electionDeadline) {
            this.startElection(s);
          }
        }
        this.updateAcked();
      }

      if (this.watchers.length) {
        const fire = [];
        this.watchers = this.watchers.filter(w => (w.pred(this) ? (fire.push(w), false) : true));
        for (const w of fire) w.fn(this);
      }
    }

    advance(ms) {
      while (ms > 0) { const d = Math.min(ms, 20); this.step(d); ms -= d; }
    }

    // Is every applied prefix identical across live servers?
    consistent() {
      const ref = this.servers.reduce((a, b) => (b.lastApplied > a.lastApplied ? b : a));
      for (const s of this.servers) {
        for (let i = 0; i < s.lastApplied; i++) if (!sameEntry(s.log[i], ref.log[i])) return false;
      }
      return true;
    }
    statesAgree() {
      const live = this.servers.filter(s => !s.crashed);
      const j = s => JSON.stringify(Object.keys(s.kv).sort().map(k => [k, s.kv[k]]));
      return live.every(s => j(s) === j(live[0]));
    }
  }

  global.Raft = { Sim, DEFAULT_FLAGS, DEFAULT_CFG, fmtCmd, name, isClient, sameEntry, KEYS };
})(typeof window !== "undefined" ? window : globalThis);
