# Interactive Raft

A talk about the Raft consensus algorithm (see `raft.pdf`, Ongaro & Ousterhout),
given as an interactive website instead of slides, plus a free-play sandbox.

Live at https://raft.ronstad.se (presentation) and https://raft.ronstad.se/sandbox.html.
Locally, open `site/index.html` or `site/sandbox.html` in a browser.
There is no build step and no dependencies.

## The presentation

A seminar review of the paper, structured as IMRAD (Introduction, Methods,
Results, Discussion). The paper's artifact, Raft itself, is presented live:
the talk builds Raft from nothing, one failure at a time. Each demo slide shows
something going wrong in the simulator, then adds the rule that fixes it, and the
rules collect in a "Rules so far" sidebar.

| Section | Slides |
|---|---|
| Introduction | Consensus and Paxos → what's wrong with Paxos → understandability as the goal (key results up front) |
| Methods: design | How that shaped Raft: decomposition, state-space reduction (Paxos vs Raft) |
| Methods: the artifact, rebuilt live | Replicated log → everyone writes → *why a majority* → split votes → randomized timeouts → lossy replication → prev-entry check and retries → applying too early → commit → catch-up → wrong server wins → election restriction → partitions → *Figure 8 bonus* |
| Methods: evaluation | User study, TLA+ proofs, election timing |
| Results | User study (25.7 vs 20.8 of 60), correctness, election performance |
| Discussion | What the authors conclude, then our reflections |
| Summary, Questions | Recap of the rules; sandbox |

*Italic* slides are optional and hatched in the progress bar. Each demo is
scripted with seeded randomness, so it plays out the same way in every rehearsal,
but servers can still be clicked live. Set the presenters' names in `PRESENTERS`
at the top of the figures section in `site/slides.js`.

**Keys:** `→`/`Space`/`PageDown` next step · `←` previous slide · `R` replay the slide ·
`P` pause · `+`/`−` speed · `C` client write · `N` speaker notes · `#/7` in the URL jumps
to a slide. Click a server to crash/restart it, shift-click to force its election timeout.

**Speaker view:** press `S` (or the "Speaker view" button) to open a second window
with the talk timer, time per slide vs plan, what to say now, what to point at, the
next click, and a big light showing whether the animation is still running or done.
Its buttons and arrow keys drive the slides, so the deck can go on the projector while
you present from the laptop screen (both windows must be in the same browser). The
deck also shows a small "running / ✓ done" chip next to the demo controls.

**Speaker notes:** written in `site/notes.js` (one line per click). `node tools/export-notes.js`
turns them into `notes/speaker-notes.typ`; compile with `typst compile notes/speaker-notes.typ`
for the printable `notes/speaker-notes.pdf`.
The spoken script for the Introduction (slides 1–5) is also kept as prose in `notes/intro-manuscript.txt`.

**PDF for Canvas:** `node tools/export-pdf.js` writes `export/slides.pdf`, one page
per slide, each fully revealed, with the demos played to their outcome.

## The sandbox

The full simulator: five servers, animated RPCs, logs, state machines, the client's
acknowledged writes, a network partition toggle and a lossy-network mode.

## Code

- `site/raft-sim.js`: the Raft engine. Each mechanism can be switched off with a flag, which is how the "problem" slides break things.
- `site/raft-view.js`: canvas and panel rendering
- `site/slides.js`: the talk's content and scripted scenarios
- `site/deck.js`: presentation controller
- `site/notes.js`, `site/presenter.html`: speaker notes and the speaker view
- `tools/export-pdf.js`: exports the slides to PDF
- `tools/export-notes.js`: exports the speaker notes to Typst
- `tests/slides.test.js`: plays every slide headlessly and checks each one shows its failure or its fix (`node tests/slides.test.js`, needs Playwright)

## Deploying to k3s with ArgoCD

The site is served by nginx (`nginx-unprivileged`) from a ConfigMap that
kustomize generates from the files in `site/`, so there is no image to build or
registry to push to. Every push to `main` changes the ConfigMap's hash and ArgoCD rolls
the Deployment.

1. The site is served at https://raft.ronstad.se (host in `deploy/ingress.yaml`; Traefik + cert-manager).
2. If the repo is private, add it under ArgoCD → Settings → Repositories.
3. Register the app once:

   ```sh
   kubectl apply -n argocd -f argocd/application.yaml
   ```

Preview the rendered manifests with `kubectl kustomize .`.
