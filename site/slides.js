// The talk: Raft built up one failure at a time.
//
// Each slide sets the simulator's feature flags, a starting state (setup) and a
// list of fragments. Pressing → reveals the next fragment and runs its `do`.
// `rule` on a fragment adds that rule to the "Rules so far" sidebar.
// Slides marked `optional` can be skipped when short on time.
(function (global) {
  "use strict";

  // Helpers used by the scenarios -------------------------------------------
  const holdTimers = sim => { for (const s of sim.servers) s.electionDeadline = Infinity; };
  const armTimers = sim => { for (const s of sim.servers) if (!s.crashed) sim.resetElectionTimer(s); };
  const whenLeader = (sim, pred, fn) => sim.waitFor(s => { const l = s.leader(); return l && pred(l); }, fn);
  const crashLeader = sim => { const l = sim.leader(); if (l) sim.crash(l.id); };
  const ackAll = sim => {
    const l = sim.leader();
    l.log.forEach((e, i) => { if (i < l.commitIndex) sim.acked.push({ cmd: e.cmd, index: i + 1, term: e.term, t: 0, lost: false }); });
  };

  // Leader S1 sends four writes; the network loses one to S3 and one to S5.
  function lossyWrites(sim) {
    sim.clientRequest();
    sim.after(1800, s => { s.dropNext({ from: 0, to: 2, type: "AE", withEntries: true }); s.clientRequest(); });
    sim.after(3600, s => { s.dropNext({ from: 0, to: 4, type: "AE", withEntries: true }); s.clientRequest(); });
    sim.after(5400, s => s.clientRequest());
  }

  // Leader takes a write, all its replication messages are lost, then it crashes.
  function writeThenCrash(sim) {
    sim.dropRules.push({ count: 4, from: 0, type: "AE", withEntries: true });
    sim.clientRequest();
    sim.after(1400, s => s.crash(0));
  }

  // Three entries everywhere, S1 leader of term 1.
  function stableCluster(sim) {
    sim.preset({ terms: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], commit: [3, 3, 3, 3, 3] });
    sim.makeLeader(0, 1);
  }

  // S4, S5 were down while S1–S3 committed entries 4–6 in term 2.
  function laggingPair(sim) {
    const full = [1, 1, 1, 2, 2, 2], short = [1, 1, 1];
    sim.preset({ terms: [full, full, full, short, short], commit: [6, 6, 6, 3, 3] });
    sim.makeLeader(0, 2);
    ackAll(sim);
    sim.servers[3].crashed = true; sim.servers[4].crashed = true;
  }
  function wrongWinner(sim) {
    sim.crash(0); sim.restart(3); sim.restart(4); sim.forceTimeout(4);
  }

  // Figure 8 of the paper, starting at its step (c).
  function figure8(sim) {
    sim.preset({ terms: [[1, 2], [1, 2], [1], [1], [1, 3]], commit: [1, 1, 1, 1, 1] });
    sim.makeLeader(0, 4);
    sim.servers[4].crashed = true;
  }
  function figure8Takeover(sim) { sim.crash(0); sim.restart(4); sim.forceTimeout(4); }

  // Rules ----------------------------------------------------------------------
  const RULES = {
    log: "Same log, same order ⇒ same state",
    leader: "One leader decides the order of all entries",
    majority: "Every decision needs a majority (3 of 5)",
    terms: "Terms number elections; one vote per server per term",
    random: "Random election timeouts; leader sends heartbeats",
    prev: "AppendEntries carries the previous entry's index + term; follower appends only if it matches; leader retries until acked",
    commit: "Apply (and answer the client) only once an entry is committed = stored on a majority",
    backoff: "On reject, the leader steps nextIndex back until the logs match",
    restrict: "Vote only for a candidate whose log is at least as up to date as yours",
    stepdown: "Higher term wins: stale leaders and candidates step down",
    curterm: "Only commit by counting replicas for entries of the current term",
  };

  // Slides ---------------------------------------------------------------------
  const RAFT_OFF = { elections: false, randomTimeout: true, acks: false, commit: false, electionRestriction: false, currentTermCommit: false };

  const SLIDES = [
    {
      layout: "hero",
      title: "Raft, one failure at a time",
      sub: "How five unreliable servers agree on a single log",
      notes: "Plan: we build a replicated log from nothing. Every time it breaks, we add one rule. The rules we end up with are Raft.",
    },
    {
      kicker: "The goal",
      title: "A replicated, deterministic log",
      flags: { mode: "broadcast" },
      panels: ["logs", "sm"],
      frags: [
        { text: "Five servers run the same <b>deterministic state machine</b>: a tiny key–value store." },
        { text: "Every command goes into a <b>log</b>; each server applies its log in order.",
          do: sim => { sim.clientBroadcast(); sim.after(1600, s => s.clientBroadcast()); sim.after(3200, s => s.clientBroadcast()); } },
        { text: "Same commands in the same order ⇒ same state on every server.", rule: "log" },
        { text: "Goal: keep working while <b>any minority</b> of servers is down or unreachable." },
      ],
      notes: "Deterministic is the key word: if the input sequence is identical, the output is identical. So the whole problem reduces to agreeing on the log.",
    },
    {
      kicker: "Problem",
      title: "Everyone accepts writes",
      flags: { mode: "broadcast" },
      clients: [{ id: "client A", x: -0.45, y: 0.12 }, { id: "client B", x: 0.45, y: 0.12 }],
      panels: ["logs", "sm"],
      frags: [
        { text: "Two clients write the same key at the same moment.",
          do: sim => { sim.clientBroadcast({ key: "x", val: 1 }, "client A"); sim.clientBroadcast({ key: "x", val: 2 }, "client B"); } },
        { text: "Messages travel different distances, so servers see them in <b>different orders</b>…" },
        { text: "…and end up with different values for <code>x</code>. The replicas have diverged." },
        { text: "Fix: let <b>one server</b>, the leader, decide the order of everything.", rule: "leader" },
      ],
      notes: "Point at the left servers vs the right servers: left got A first, right got B first. Nobody did anything wrong. We need someone to decide the order.",
    },
    {
      kicker: "Background",
      optional: true,
      title: "Why a majority?",
      flags: { mode: "broadcast" },
      clients: [],
      panels: [],
      frags: [
        { text: "Decisions need a <b>majority</b>: 3 of 5 servers.", rule: "majority" },
        { text: "Any two majorities <b>overlap</b> in at least one server…", do: (sim, deck) => { deck.view.overlay = "majority"; } },
        { text: "…and that server remembers the first decision, so a conflicting second one can't also win." },
        { text: "5 servers survive 2 failures: 3 left is still a majority.", do: sim => { sim.crash(3); sim.crash(4); } },
      ],
      notes: "Blue majority S1–S3, orange majority S3–S5: they always share someone. This overlap argument is behind every safety rule later.",
    },
    {
      kicker: "Problem",
      title: "Electing a leader, naively",
      flags: { randomTimeout: false },
      cfg: { fixedTimeout: 3500 },
      setup: holdTimers,
      panels: ["events"],
      frags: [
        { text: "No leader yet. A server that hears nothing for a while becomes a <b>candidate</b> and asks for votes." },
        { text: "Each election has a number, the <b>term</b>. A server votes at most <b>once per term</b>; a majority of votes wins.", rule: "terms" },
        { text: "Everyone uses the <b>same timeout</b>…", do: armTimers },
        { text: "…so everyone becomes a candidate at once and votes for itself. <b>Split vote.</b> Again. Forever." },
      ],
      notes: "Watch the term number climb on every server while nobody wins. Each candidate already voted for itself, so it rejects everyone else.",
    },
    {
      kicker: "Fix",
      title: "Randomized election timeouts",
      setup: holdTimers,
      panels: ["events"],
      frags: [
        { text: "Each server picks a <b>random</b> timeout (here 2.5–7.5 s).", do: armTimers, rule: "random" },
        { text: "The first to wake up usually collects a majority before anyone else times out." },
        { text: "The leader sends <b>heartbeats</b>, so followers keep resetting their timers." },
        { text: "Kill the leader: followers time out and elect a new one in a <b>higher term</b>.", do: crashLeader },
      ],
      notes: "Ring around each follower = its timer. Heartbeats refill it. You can click servers yourself here.",
    },
    {
      kicker: "Problem",
      title: "Replicating the log, fire-and-forget",
      flags: RAFT_OFF,
      setup: sim => sim.makeLeader(0, 1),
      panels: ["logs", "sm"],
      frags: [
        { text: "S1 is leader. It appends each client command and sends it to every follower.", do: lossyWrites },
        { text: "The network is unreliable: some messages are <b>lost</b>." },
        { text: "Followers append whatever arrives, so one lost message shifts everything after it." },
        { text: "Logs (red outlines) and state machines no longer agree." },
      ],
      notes: "S3 missed the 2nd write, S5 the 3rd. Their later entries are at the wrong index.",
    },
    {
      kicker: "Fix",
      title: "Say where it goes, acknowledge, retry",
      flags: { ...RAFT_OFF, acks: true },
      setup: sim => sim.makeLeader(0, 1),
      panels: ["logs", "sm"],
      frags: [
        { text: "Each AppendEntries names the <b>previous entry</b> (index + term); a follower only appends if it has that entry.", do: lossyWrites, rule: "prev" },
        { text: "Followers <b>reply</b>. The leader tracks each follower's <code>nextIndex</code> (yellow underline)." },
        { text: "No reply? The leader resends from <code>nextIndex</code> with its next heartbeat." },
        { text: "Lost messages now cause <b>delay</b>, never divergence." },
      ],
      notes: "Same message losses as the previous slide. The heartbeat doubles as the retry timer.",
    },
    {
      kicker: "Problem",
      title: "Applying too early",
      flags: { commit: false },
      setup: stableCluster,
      panels: ["logs", "sm", "receipts"],
      frags: [
        { text: "Right now a server applies an entry the moment it's in its log, and the leader answers the client immediately." },
        { text: "A client writes. S1 applies it and says <b>OK</b>… its messages are lost… and it crashes.", do: writeThenCrash },
        { text: "A new leader is elected. It never saw that entry." },
        { text: "The next write lands at the same index. The client was told OK, and the write is <b>gone</b>.",
          do: sim => whenLeader(sim, l => l.id !== 0, s => s.clientRequest()) },
        { text: "When S1 returns, its entry is overwritten, but it already applied it.", do: sim => sim.restart(0) },
      ],
      notes: "The receipts panel shows what the client believes happened. The struck-out one is a broken promise.",
    },
    {
      kicker: "Fix",
      title: "Commit before you apply",
      setup: stableCluster,
      panels: ["logs", "sm", "receipts"],
      frags: [
        { text: "An entry is <b>committed</b> once a majority stores it. Only committed entries are applied, and only then does the client get OK.", rule: "commit" },
        { text: "Same story: S1 takes a write, its messages are lost, it crashes.", do: writeThenCrash },
        { text: "It never committed, so the client never got OK and will retry. No promise was broken.",
          do: sim => whenLeader(sim, l => l.id !== 0, s => s.clientRequest()) },
        { text: "Followers learn the commit index from the leader's next AppendEntries (faded = not yet committed).", do: sim => sim.restart(0) },
      ],
      notes: "Uncommitted entries are drawn faded and dashed. Majority storage means any future leader will have it (we'll need one more rule for that).",
    },
    {
      kicker: "Demo",
      title: "Catching up a returning server",
      setup: sim => {
        const full = [1, 1, 1, 1, 1, 1];
        sim.preset({ terms: [full, full, full, [1, 1], full], commit: [6, 6, 6, 2, 6] });
        sim.makeLeader(0, 2);
        sim.servers[3].crashed = true;
      },
      panels: ["logs", "sm"],
      frags: [
        { text: "S4 was offline while entries 3–6 were committed, and S1 has just become leader." },
        { text: "A new leader doesn't know how far behind anyone is: it guesses <code>nextIndex</code> = end of its own log." },
        { text: "S4 comes back. AppendEntries is <b>rejected</b>: S4 doesn't have the previous entry.", do: sim => sim.restart(3) },
        { text: "The leader steps <code>nextIndex</code> back one at a time until the logs match…", rule: "backoff" },
        { text: "…then streams the missing entries, and S4 rebuilds its state machine from the log." },
      ],
      notes: "Watch the yellow underline in S4's row walk left. Real implementations skip back faster using a hint from the follower.",
    },
    {
      kicker: "Problem",
      title: "The wrong server wins",
      flags: { electionRestriction: false },
      setup: laggingPair,
      panels: ["logs", "sm", "receipts"],
      frags: [
        { text: "S4 and S5 were down while S1–S3 committed entries 4–6 (term 2)." },
        { text: "S1 crashes just as S4 and S5 return. S5 times out first…", do: wrongWinner },
        { text: "…nobody looks at S5's log, so it wins the election." },
        { text: "Its next entry <b>overwrites committed entries</b> on S2 and S3.",
          do: sim => whenLeader(sim, l => l.term > 2, s => s.clientRequest()) },
      ],
      notes: "Committed meant 'on a majority', but the new leader wasn't part of that majority. Committed data must never be lost.",
    },
    {
      kicker: "Fix",
      title: "Vote only for up-to-date logs",
      setup: laggingPair,
      panels: ["logs", "sm", "receipts"],
      frags: [
        { text: "Refuse to vote for a candidate whose log is <b>behind yours</b>: compare the last entry's term, then log length.", rule: "restrict" },
        { text: "Same story: S1 crashes, S4 and S5 return, S5 times out first…", do: wrongWinner },
        { text: "S2 and S3 refuse. S5 can't reach a majority." },
        { text: "S2 or S3 wins, and every committed entry survives.",
          do: sim => { if (!sim.leader()) sim.forceTimeout(1); whenLeader(sim, l => l.term > 2, s => s.clientRequest()); } },
        { text: "Why it works: committed = on a majority; elected = votes from a majority. They <b>overlap</b>." },
      ],
      notes: "This is the 'election restriction' from §5.4.1 of the paper. S4/S5 keep timing out and bumping the term, which can delay the election; the 4th step nudges S2's timer (shift-click works too).",
    },
    {
      kicker: "Demo",
      title: "Two leaders? Network partitions",
      setup: stableCluster,
      controls: ["partition"],
      panels: ["logs", "sm", "receipts"],
      frags: [
        { text: "The network splits: S1, S2 | S3, S4, S5.", do: sim => sim.setPartition([0, 1]) },
        { text: "S1 still thinks it is leader and accepts a write, but it can't reach a majority, so it <b>never commits</b>.",
          do: sim => sim.clientRequestTo(0) },
        { text: "The majority side elects a leader in a <b>higher term</b> and commits new writes.",
          do: sim => whenLeader(sim, l => l.term > 1, s => s.clientRequest()) },
        { text: "The network heals. S1 sees the higher term, <b>steps down</b>, and its uncommitted entry is replaced.",
          do: sim => sim.heal(), rule: "stepdown" },
      ],
      notes: "Two crowns at once is fine: only one of them can ever commit. Terms tell everyone which leader is current.",
    },
    {
      kicker: "Bonus problem",
      optional: true,
      title: "The subtle one (Figure 8)",
      flags: { currentTermCommit: false },
      setup: figure8,
      panels: ["logs", "receipts"],
      frags: [
        { text: "Earlier: S1 wrote entry 2 in term 2; S5 wrote a different entry 2 in term 3 and went down. S1 is leader again in term 4." },
        { text: "S1 copies its old term-2 entry to a majority and counts it as <b>committed</b>." },
        { text: "S1 crashes. S5 returns: its last term (3) beats everyone's (2), so it is allowed to win…", do: figure8Takeover },
        { text: "…and overwrites the “committed” entry 2 everywhere." },
      ],
      notes: "Figure 8 in the paper. Counting replicas is not enough for entries from an older term.",
    },
    {
      kicker: "Bonus fix",
      optional: true,
      title: "Only count replicas for the current term",
      setup: figure8,
      panels: ["logs", "receipts"],
      frags: [
        { text: "A leader only commits by counting replicas for entries from its <b>own term</b>.", rule: "curterm" },
        { text: "S1 copies entry 2 to a majority, but it stays uncommitted." },
        { text: "S1 commits a new term-4 entry; that commits entry 2 with it.", do: sim => sim.clientRequest() },
        { text: "Now S5's last term (3) is behind the majority's (4): it can't win.", do: figure8Takeover },
      ],
      notes: "Older entries get committed indirectly, via the log matching property.",
    },
    {
      layout: "recap",
      kicker: "Recap",
      title: "That's Raft",
      notes: "Point at how each rule came from a failure we saw. Mention the parts we skipped.",
    },
    {
      layout: "sandbox",
      kicker: "Try it",
      title: "Sandbox",
      notes: "Take questions; reproduce scenarios live.",
    },
  ];

  global.TALK = { SLIDES, RULES };
})(window);
