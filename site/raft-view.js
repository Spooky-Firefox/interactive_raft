// Rendering for the Raft simulation: the cluster canvas and the HTML panels.
(function (global) {
  "use strict";
  const { fmtCmd, name, isClient } = global.Raft;

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function termColor(t) {
    if (t === 0) return "hsl(210, 12%, 70%)";
    const hues = [200, 140, 45, 330, 270, 15, 170, 90, 240, 0];
    return `hsl(${hues[t % hues.length]}, 65%, 62%)`;
  }

  class ClusterView {
    constructor(canvas, sim) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.sim = sim;
      this.overlay = null; // "majority"
      this.col = {};
      for (const k of ["follower", "candidate", "leader", "offline", "rv", "ae", "client", "bad", "text", "muted", "canvas-bg", "link"]) this.col[k] = css("--" + k);
      this.fit();
    }

    fit() {
      const r = this.cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.W = r.width; this.H = r.height;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    get S() { return Math.min(this.W, this.H); }
    px(id) {
      const p = this.sim.pos(id), R = this.S * 0.36;
      return { x: this.W / 2 + p.x * R, y: this.H / 2 + p.y * R };
    }
    nodeR() { return this.S * 0.085; }

    serverAt(x, y) {
      for (const s of this.sim.servers) {
        const p = this.px(s.id);
        if (Math.hypot(x - p.x, y - p.y) <= this.nodeR() + 10) return s.id;
      }
      return null;
    }

    draw({ paused = false } = {}) {
      const { ctx, sim } = this;
      ctx.clearRect(0, 0, this.W, this.H);
      const R = this.nodeR();

      // links
      ctx.lineWidth = 1.5;
      for (let i = 0; i < sim.n; i++) for (let j = i + 1; j < sim.n; j++) {
        const a = this.px(i), b = this.px(j);
        const cut = !sim.canReach(i, j);
        ctx.strokeStyle = cut ? this.col.bad : this.col.link;
        ctx.setLineDash(cut ? [6, 6] : []);
        ctx.globalAlpha = cut ? 0.6 : 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (cut) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          ctx.setLineDash([]); ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(mx - 5, my - 5); ctx.lineTo(mx + 5, my + 5); ctx.moveTo(mx + 5, my - 5); ctx.lineTo(mx - 5, my + 5); ctx.stroke();
          ctx.lineWidth = 1.5;
        }
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;

      if (this.overlay === "majority") this.drawMajority(R);

      for (const c of sim.clients) this.drawClient(c);
      for (const s of sim.servers) this.drawServer(s, R);
      for (const m of sim.messages) this.drawMessage(m, R);

      // status line
      ctx.fillStyle = this.col.muted; ctx.font = `${Math.max(11, this.S * 0.022)}px system-ui`;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`t = ${(sim.now / 1000).toFixed(1)}s` + (paused ? "  ❚❚ paused" : ""), 10, 10);

      const v = sim.violations[sim.violations.length - 1];
      if (v) {
        const fs = Math.max(12, this.S * 0.026);
        ctx.font = `700 ${fs}px system-ui`;
        const w = Math.min(this.W - 20, ctx.measureText(v.text).width + 24);
        ctx.fillStyle = "rgba(224,85,97,.92)";
        roundRect(ctx, (this.W - w) / 2, this.H - fs * 2.4, w, fs * 1.9, 8); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(v.text, this.W / 2, this.H - fs * 1.45, this.W - 40);
      }
    }

    drawMajority(R) {
      const { ctx } = this;
      const groups = [{ ids: [0, 1, 2], color: "rgba(79,179,217,.85)", off: 16 }, { ids: [2, 3, 4], color: "rgba(224,160,48,.85)", off: 26 }];
      for (const g of groups) {
        ctx.strokeStyle = g.color; ctx.lineWidth = 5;
        for (const id of g.ids) {
          const p = this.px(id);
          ctx.beginPath(); ctx.arc(p.x, p.y, R + g.off, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    drawClient(c) {
      const { ctx } = this;
      const p = this.px(c.id);
      const fs = Math.max(11, this.S * 0.026);
      ctx.font = `600 ${fs}px system-ui`;
      const w = ctx.measureText(c.id).width + 22, h = fs * 2;
      ctx.fillStyle = "rgba(176,124,240,.12)"; ctx.strokeStyle = this.col.client; ctx.lineWidth = 1.5;
      roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = this.col.client; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(c.id, p.x, p.y);
    }

    drawServer(s, R) {
      const { ctx, sim } = this;
      const p = this.px(s.id);
      ctx.save();
      if (s.crashed) {
        ctx.fillStyle = this.col.offline;
        ctx.setLineDash([5, 4]); ctx.strokeStyle = "#5a6470"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = this.col.bad; ctx.lineWidth = 3;
        const k = R * 0.35;
        ctx.beginPath(); ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y + k);
        ctx.moveTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); ctx.stroke();
        ctx.fillStyle = "#9aa4af"; ctx.font = `600 ${R * 0.36}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(name(s.id), p.x, p.y - R * 0.6);
        this.label(p, R, "OFFLINE", this.col.bad);
        ctx.restore();
        return;
      }

      const raft = sim.flags.mode === "raft";
      const role = raft ? s.state : "follower";
      const fill = this.col[role];
      if (role === "leader") { ctx.shadowColor = fill; ctx.shadowBlur = 25; }
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      if (raft && role !== "leader" && isFinite(s.electionDeadline)) {
        const frac = Math.max(0, Math.min(1, (s.electionDeadline - sim.now) / s.timeoutLen));
        ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(p.x, p.y, R + 7, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = frac < 0.25 ? this.col.bad : "#c7d2de";
        ctx.beginPath(); ctx.arc(p.x, p.y, R + 7, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      } else if (role === "leader") {
        ctx.strokeStyle = this.col.leader; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, R + 7, 0, Math.PI * 2); ctx.stroke();
      }

      ctx.fillStyle = "#0d1117"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${R * 0.5}px system-ui`;
      ctx.fillText(name(s.id), p.x, raft ? p.y - R * 0.12 : p.y);
      if (raft) {
        ctx.font = `600 ${R * 0.27}px system-ui`;
        ctx.fillText(`term ${s.term}`, p.x, p.y + R * 0.38);
      }
      if (role === "leader") drawCrown(ctx, p.x, p.y - R - 16, R * 0.32);
      this.label(p, R, raft ? role.toUpperCase() : "SERVER", fill);

      if (role === "candidate") {
        const vs = s.votes.size;
        for (let i = 0; i < sim.n; i++) {
          const x = p.x + (i - (sim.n - 1) / 2) * 12, y = p.y + R + 14 + R * 0.34;
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          if (i < vs) { ctx.fillStyle = this.col.candidate; ctx.fill(); }
          else { ctx.strokeStyle = "#5a6470"; ctx.lineWidth = 1.2; ctx.stroke(); }
        }
      }
      ctx.restore();
    }

    label(p, R, text, color) {
      const { ctx } = this;
      ctx.fillStyle = color; ctx.font = `600 ${Math.max(10, R * 0.24)}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(text, p.x, p.y + R + 13);
    }

    drawMessage(m, R) {
      const { ctx, sim } = this;
      const a = this.px(m.from), b = this.px(m.to);
      let f = Math.max(0, Math.min(1, (sim.now - m.sent) / (m.arrive - m.sent)));
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const r0 = isClient(m.from) ? R * 0.5 : R, r1 = isClient(m.to) ? R * 0.5 : R;
      const sx = a.x + ux * r0, sy = a.y + uy * r0, ex = b.x - ux * r1, ey = b.y - uy * r1;
      const off = 6;
      if (m.drop && f > 0.5) {
        const x = sx + (ex - sx) * 0.5 - uy * off, y = sy + (ey - sy) * 0.5 + ux * off;
        ctx.globalAlpha = Math.max(0, 1 - (f - 0.5) / 0.3);
        ctx.strokeStyle = this.col.bad; ctx.lineWidth = 4;
        const k = 9;
        ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }
      const x = sx + (ex - sx) * f - uy * off, y = sy + (ey - sy) * f + ux * off;
      const scale = Math.max(1, this.S / 560);

      let color, filled = true, rad = 6, txt = "";
      switch (m.type) {
        case "RV": color = this.col.rv; rad = 7; break;
        case "RVR": color = m.granted ? this.col.rv : this.col.bad; filled = false; txt = m.granted ? "✓" : "✗"; rad = 7; break;
        case "AE": color = this.col.ae; if (m.entries.length) { rad = 9; txt = String(m.entries.length); } else rad = 5; break;
        case "AER": color = m.success ? this.col.ae : this.col.bad; filled = false; rad = 5; break;
        case "CLIENT": color = this.col.client; rad = 8; break;
        case "OK": color = this.col.client; filled = false; rad = 9; txt = "OK"; break;
      }
      rad *= scale;
      const dead = !isClient(m.to) && sim.servers[m.to].crashed;
      ctx.globalAlpha = dead ? 0.35 : 1;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      if (filled) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.fillStyle = this.col["canvas-bg"]; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
      if (txt) {
        ctx.fillStyle = filled ? "#0d1117" : color; ctx.font = `700 ${(txt.length > 1 ? 8 : 10) * scale}px system-ui`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, x, y + 0.5);
      }
      if (m.type === "CLIENT") {
        ctx.fillStyle = color; ctx.font = `600 ${11 * scale}px system-ui`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(fmtCmd(m.cmd), x + rad + 4, y);
      }
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawCrown(ctx, x, y, s) {
    ctx.fillStyle = "#f5c542";
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.5); ctx.lineTo(x - s, y - s * 0.4); ctx.lineTo(x - s * 0.5, y + s * 0.05);
    ctx.lineTo(x, y - s * 0.6); ctx.lineTo(x + s * 0.5, y + s * 0.05); ctx.lineTo(x + s, y - s * 0.4);
    ctx.lineTo(x + s, y + s * 0.5); ctx.closePath(); ctx.fill();
  }

  // ------------------------------------------------------------------ panels

  // Most common entry at each index; cells that differ are flagged as diverged.
  function majorityLog(sim) {
    const maxLen = Math.max(0, ...sim.servers.map(s => s.log.length));
    const out = [];
    for (let i = 0; i < maxLen; i++) {
      const counts = {};
      for (const s of sim.servers) {
        const e = s.log[i]; if (!e) continue;
        const k = e.term + "|" + fmtCmd(e.cmd);
        counts[k] = (counts[k] || 0) + 1;
      }
      out.push(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    }
    return out;
  }

  function renderLogs(sim, el, { minCols = 8, showCmd = true } = {}) {
    const leader = sim.flags.mode === "raft" ? sim.leader() : null;
    const ref = majorityLog(sim);
    const maxLen = Math.max(minCols, ...sim.servers.map(s => s.log.length));
    const raft = sim.flags.mode === "raft";
    let h = `<table class="log${showCmd ? " cmds" : ""}"><tr><th></th>`;
    for (let i = 1; i <= maxLen; i++) h += `<th>${i}</th>`;
    h += "<th></th></tr>";
    for (const s of sim.servers) {
      const role = raft ? s.state : "follower";
      const stCol = s.crashed ? "var(--offline)" : `var(--${role})`;
      const badge = s.crashed ? "off" : raft ? role[0].toUpperCase() : "";
      h += `<tr class="${s.crashed ? "offline" : ""}"><th class="row">${name(s.id)}${badge ? `<span class="badge" style="background:${stCol};${s.crashed ? "color:#ccc" : ""}">${badge}</span>` : ""}</th>`;
      const next = leader && s.id !== leader.id ? leader.nextIndex[s.id] : null;
      for (let i = 1; i <= maxLen; i++) {
        const e = s.log[i - 1];
        const cls = ["cell"];
        if (next === i) cls.push("nextmark");
        if (!e) { cls.push("empty"); h += `<td class="${cls.join(" ")}"></td>`; continue; }
        if (raft && sim.flags.commit && i > s.commitIndex) cls.push("uncommitted");
        if (sim.newCells.has(s.id + ":" + i)) cls.push("new");
        if (ref[i - 1] !== e.term + "|" + fmtCmd(e.cmd)) cls.push("diverged");
        const body = showCmd
          ? `<span class="c">${esc(fmtCmd(e.cmd))}</span>${raft ? `<span class="tm">t${e.term}</span>` : ""}`
          : e.term;
        h += `<td class="${cls.join(" ")}" style="background:${termColor(e.term)}" title="index ${i}, term ${e.term}: ${esc(fmtCmd(e.cmd))}">${body}</td>`;
      }
      let meta = "";
      if (raft && sim.flags.commit) meta = `commit ${s.commitIndex}`;
      if (next != null && !s.crashed) meta += `${meta ? " · " : ""}next ${next}`;
      h += `<td class="meta">${meta}</td></tr>`;
    }
    h += "</table>";
    el.innerHTML = h;
  }

  function renderStateMachines(sim, el) {
    // majority value per key, to highlight diverged values
    const keys = global.Raft.KEYS;
    const maj = {};
    for (const k of keys) {
      const c = {};
      for (const s of sim.servers) if (!s.crashed) { const v = s.kv[k] ?? "—"; c[v] = (c[v] || 0) + 1; }
      maj[k] = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    let h = "";
    for (const s of sim.servers) {
      h += `<div class="sm ${s.crashed ? "offline" : ""}"><div class="t">${name(s.id)}</div><div class="kv">`;
      for (const k of keys) {
        const v = s.kv[k] ?? "—";
        const cls = ["v"];
        if (sim.flashKeys.has(s.id + ":" + k)) cls.push("flash");
        if (!s.crashed && String(v) !== maj[k]) cls.push("diff");
        h += `<span class="k">${k}</span><span class="${cls.join(" ")}">${v}</span>`;
      }
      h += "</div></div>";
    }
    el.innerHTML = h;
  }

  function renderReceipts(sim, el) {
    if (!sim.acked.length) { el.innerHTML = '<span class="none">none yet</span>'; return; }
    el.innerHTML = sim.acked.map(a =>
      `<span class="receipt${a.lost ? " lost" : ""}">${esc(fmtCmd(a.cmd))} <small>@${a.index}</small>${a.lost ? " <b>LOST</b>" : " ✓"}</span>`).join("");
  }

  function renderEvents(sim, el, limit = 300) {
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    el.innerHTML = sim.events.slice(-limit).map(e =>
      `<div class="${e.cls}"><span class="time">${(e.t / 1000).toFixed(1).padStart(5)}s</span>${esc(e.text)}</div>`).join("");
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  function clearFlashes(sim) { sim.newCells.clear(); sim.flashKeys.clear(); }

  global.RaftView = { ClusterView, renderLogs, renderStateMachines, renderReceipts, renderEvents, clearFlashes, termColor, esc };
})(window);
