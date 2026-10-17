// Speaker notes, keyed by slide title. Shown in the presenter window (press S)
// and exported to Typst/PDF by tools/export-notes.js.
//
//   min:   suggested minutes for the slide
//   open:  what to say when the slide appears, before the first click
//   steps: one entry per click (fragment), said as that point appears
//   watch: what to point at on screen
(function (global) {
  "use strict";
  global.NOTES = {
    "Raft, one failure at a time": {
      min: 0.5,
      open: "Hi. We are presenting the Raft paper by Ongaro and Ousterhout. Plan: why the paper exists, then we rebuild Raft live, one failure at a time, then how the authors tested it, their results, and what we think.",
    },
    "Why this paper?": {
      min: 1.5,
      open: "Start with the problem the paper attacks.",
      steps: [
        "Any database or config store with copies on many machines needs this. Kubernetes stores its state this way.",
        "Paxos is the classic solution. Even the authors needed almost a year to understand all of it. Point at the Google quote.",
        "This is the research question. Understandability is unusual as a primary goal in systems research.",
        "Say the key results now: students did better on Raft, it is formally specified, and it is as fast. We show the details later.",
      ],
    },
    "How they designed for understandability": {
      min: 1,
      steps: [
        "Three parts you can learn one at a time: leader election, log replication, safety.",
        "Examples: one strong leader instead of equal peers, logs that can't have holes, and randomness instead of complicated tie-break rules.",
        "From here on the simulator does the talking. Every rule we add is from the paper; the sidebar on the right collects them.",
      ],
    },
    "A replicated, deterministic log": {
      min: 1,
      open: "Five servers, each with a log and a tiny key-value store.",
      steps: [
        "Deterministic means: same input, same output. No randomness, no clocks inside the state machine.",
        "Watch the client send three writes. Each server appends them and applies them in order.",
        "So the whole problem becomes: agree on the log.",
        "And we want to survive failures. With five servers, any two can be down.",
      ],
      watch: "The logs table and the state machines filling up identically.",
    },
    "Everyone accepts writes": {
      min: 1,
      open: "First idea: let every server accept writes.",
      steps: [
        "Client A on the left writes x=1, client B on the right writes x=2, at the same time.",
        "Messages travel different distances, so the left servers get A first and the right servers get B first.",
        "Point at the red values: half the servers think x=1, the others x=2. Nobody did anything wrong.",
        "So someone has to decide the order. That's the leader.",
      ],
      watch: "Left vs right servers; red cells in the state machines.",
    },
    "Why a majority?": {
      min: 1,
      open: "Optional slide. Skip it if short on time.",
      steps: [
        "Every decision in Raft needs three of five.",
        "Blue is one majority, orange is another. They always share at least one server, here S3.",
        "That shared server is why two conflicting decisions can't both win. Every safety rule later uses this.",
        "Two servers crash. Three are left, still a majority, so the cluster keeps working.",
      ],
    },
    "Electing a leader, naively": {
      min: 1,
      open: "We need a leader. How do we pick one?",
      steps: [
        "If a server hears nothing for a while, it assumes there is no leader and runs for election.",
        "Terms are like election numbers. One vote per server per term, and a majority wins.",
        "Now give every server the same timeout. Watch the timer rings.",
        "Everyone times out together, everyone votes for itself, nobody gets three votes. The term number keeps climbing. This never ends.",
      ],
      watch: "Term numbers climbing on all five servers; the events list.",
    },
    "Randomized election timeouts": {
      min: 1.5,
      open: "The fix is almost embarrassingly simple.",
      steps: [
        "Each server picks a random timeout. Point at the rings: they now run out at different times.",
        "The first one to wake up asks for votes, and the others vote for it before their own timers run out.",
        "The leader keeps sending small heartbeat messages. Each one refills the followers' timers, so no new election starts.",
        "Now kill the leader. Heartbeats stop, a timer runs out, and we get a new leader in a higher term.",
      ],
      watch: "The crown; rings refilling with each heartbeat; the term going up after the crash.",
    },
    "Replicating the log, fire-and-forget": {
      min: 1,
      open: "We have a leader. Now it has to copy its log to the followers.",
      steps: [
        "Simplest version: send each new command once and hope.",
        "Point at the red crosses: those messages were lost.",
        "Followers just append what arrives, so after one lost message everything later sits at the wrong index.",
        "Red outlines in the log table, red values in the state machines. The copies have diverged.",
      ],
      watch: "Red crosses on the links; S3 and S5 rows.",
    },
    "Say where it goes, acknowledge, retry": {
      min: 1.5,
      open: "Same lost messages as before, three small changes.",
      steps: [
        "Every message says what entry comes right before the new ones. If the follower doesn't have that entry, it refuses.",
        "Followers answer. The yellow underline is where the leader thinks each follower is.",
        "No answer means the leader sends it again with the next heartbeat.",
        "Same losses as last slide, but now every log ends up identical. Lost messages only cost time.",
      ],
      watch: "Logs converging; all state machines equal at the end.",
    },
    "Applying too early": {
      min: 1.5,
      open: "So far a server applies an entry as soon as it has it. That is a problem.",
      steps: [
        "Look at the bottom panel: that's what the client was promised.",
        "Client writes, S1 applies it and says OK, its messages get lost, and S1 crashes.",
        "Wait for the new leader. It never saw that write.",
        "The next write takes the same spot in the log. Point at the receipt: struck out, LOST. The client was told OK and the data is gone.",
        "Bring S1 back: its log gets fixed, but its state machine already applied the lost value.",
      ],
      watch: "The \"Client was told OK\" panel.",
    },
    "Commit before you apply": {
      min: 1.5,
      open: "The fix: a write only counts once a majority has it.",
      steps: [
        "Committed means stored on a majority. Only then apply it, and only then tell the client OK.",
        "Exact same scenario as before.",
        "S1 never got a majority, so the client never got OK. The client knows to retry. No broken promise.",
        "Faded entries are not yet committed. Followers learn the commit point from the leader's next message.",
      ],
      watch: "Faded vs solid cells; the receipts panel stays clean.",
    },
    "Catching up a returning server": {
      min: 1,
      open: "What happens when a server comes back after being away?",
      steps: [
        "S4 missed four entries, and S1 became leader while it was gone.",
        "A new leader just guesses: everyone is up to date.",
        "S4 comes back and says no: it doesn't have the entry before the new ones.",
        "Point at the yellow underline in S4's row: it steps left, one entry per rejection.",
        "Once they match, the leader sends everything S4 is missing, and S4 rebuilds its key-value store.",
      ],
      watch: "S4's row and its yellow underline walking left.",
    },
    "The wrong server wins": {
      min: 1.5,
      open: "Now a nasty one. Look at the logs: S4 and S5 are missing three committed entries.",
      steps: [
        "They were down while S1 to S3 committed entries 4 to 6.",
        "S1 crashes, S4 and S5 come back, and S5 times out first.",
        "Nobody checks how complete S5's log is, so it gets votes and wins.",
        "Its next entry overwrites committed entries on S2 and S3. Red banner, and the receipts show the client's data is lost. Committed data must never disappear.",
      ],
      watch: "The red banner; LOST receipts.",
    },
    "Vote only for up-to-date logs": {
      min: 1.5,
      open: "Fix: be picky about who you vote for.",
      steps: [
        "Compare the last entry: higher term wins; same term, longer log wins. Never vote for someone behind you.",
        "Same story as before.",
        "S2 and S3 refuse. Point at the events list: \"refuses vote, log is behind\".",
        "So S2 or S3 becomes leader, and nothing committed is lost. If it takes a while, shift-click S2.",
        "The reason it works: committed means on a majority, winning needs votes from a majority, and those two majorities share a server that refuses.",
      ],
      watch: "\"refuses vote\" lines in the events; no red banner.",
    },
    "Two leaders? Network partitions": {
      min: 1.5,
      open: "Last failure: the network splits.",
      steps: [
        "Red dashed links: S1 and S2 can't talk to the other three.",
        "S1 still thinks it's leader and accepts a write, but only S2 can store it, so it stays faded and uncommitted. The client never gets OK.",
        "The other side elects its own leader in a higher term. Two crowns at once. That's fine: only one can commit.",
        "Heal it. S1 sees the higher term, steps down, and its uncommitted entry is replaced. Terms tell everyone which leader is current.",
      ],
      watch: "Two crowns; S1's faded entry being replaced.",
    },
    "The subtle one (Figure 8)": {
      min: 1.5,
      open: "Optional, a famous corner case from the paper, Figure 8.",
      steps: [
        "The history is already set up: two short-lived leaders wrote different entries at index 2.",
        "S1 copies its old entry to a majority and calls it committed.",
        "S1 crashes. S5's last entry has term 3, newer than everyone's term 2, so it is allowed to win.",
        "And it overwrites the entry we called committed. Red banner.",
      ],
    },
    "Only count replicas for the current term": {
      min: 1,
      open: "Optional. The fix is one more rule.",
      steps: [
        "Only count copies for entries from your own term.",
        "S1 copies entry 2 to a majority, but does not call it committed yet.",
        "S1 commits a new entry from its own term; everything before it becomes committed too.",
        "Now S5 is behind the majority and can't win.",
      ],
    },
    "How the authors evaluated Raft": {
      min: 1,
      open: "That was the algorithm. Now: how did the authors show it is actually better?",
      steps: [
        "43 students at Stanford and Berkeley, video lectures and a quiz on each algorithm. Half did Paxos first, so order doesn't decide the result.",
        "A formal TLA+ specification and proofs.",
        "Their own implementation: crash the leader again and again and time the election.",
      ],
    },
    "Students understood Raft better": {
      min: 1.5,
      open: "The first result: understandability. This is the paper's own figure.",
      steps: [
        "Two video lectures and two quizzes per student. Half started with Paxos, so the order can't decide the result.",
        "Point at the diagonal: every point above it is a student who did better on Raft. That's 33 of 43.",
        "So the difference is statistically significant, not luck.",
        "The model predicts an even bigger gap, 12.5 points. Strange detail: students who took the Paxos quiz first scored lower on Raft, and the authors don't know why.",
      ],
      watch: "The diagonal line in the scatter plot; red + is Raft first, blue x is Paxos first.",
    },
    "Correctness: specified, (mostly) proven": {
      min: 1,
      open: "Second result: correctness.",
      steps: [
        "TLA+ is a language for writing an exact description of an algorithm.",
        "In plain words: once an entry is committed, every future leader will contain it. That's what you saw protected in our demo.",
        "And: two servers can never apply different commands at the same log index. That's the guarantee clients care about.",
        "Be honest about the limit: the machine-checked proof rests on invariants that were not themselves proven.",
      ],
      watch: "The two property cards.",
    },
    "Leader election is fast, with randomness": {
      min: 1,
      steps: [
        "In normal operation each entry takes one round trip to a majority, same as Paxos.",
        "Without randomness, elections took over ten seconds. That's exactly the endless split vote we showed.",
        "5 ms of randomness gives a 287 ms median. Shorter timeouts mean faster failover, until heartbeats can't arrive in time.",
      ],
    },
    "What the authors conclude": {
      min: 1,
      open: "This slide is only the authors' claims, not ours.",
      steps: [
        "Same performance as Paxos, easier to understand.",
        "Understandability can be designed for and measured.",
        "Further optimizations are future work.",
      ],
    },
    "The user study": {
      min: 1.5,
      open: "Now our discussion. First, the user study.",
      steps: [
        "We think it is well designed: the order was balanced and the results were analysed with statistics.",
        "Point at the table: same lecturer, a longer Paxos lecture, paired quiz questions, and grading in random order.",
        "Our main concern: the survey is subjective, and the authors themselves say participants may have been biased by knowing the hypothesis.",
      ],
      watch: "The rows of the bias table.",
    },
    "Correctness and performance": {
      min: 1.5,
      open: "Then correctness and performance.",
      steps: [
        "A formal specification plus a proof is much stronger evidence than testing alone.",
        "But they say themselves that not every invariant was checked, so part of the proof rests on assumptions.",
        "The performance section shows randomized elections work, but it never compares Raft against other Paxos variants in general.",
        "They use the minimum number of messages for replication, and leave further optimizations to future work.",
      ],
    },
    "Our takeaways": {
      min: 1.5,
      open: "Two more thoughts of our own, beyond the written review.",
      steps: [
        "A quiz right after a lecture measures how easy Raft is to teach. Building a correct implementation is a different, harder test.",
        "The best evidence came after the paper: etcd, the store behind Kubernetes, Consul, CockroachDB and TiKV all use Raft.",
        "From building this demo: the normal case is easy. The safety corner cases are where all the subtlety is.",
      ],
    },
    "That's Raft": {
      min: 1,
      open: "These are all the rules we added. Each one came from a failure you saw. We skipped snapshots, membership changes, and client details. Thank you.",
    },
    "Sandbox": {
      min: 2,
      open: "Questions? We can reproduce any scenario live here: click servers to crash them, split the network, send writes.",
    },
  };
})(window);
