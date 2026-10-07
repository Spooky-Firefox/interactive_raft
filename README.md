# Interactive Raft

A talk about the Raft consensus algorithm (see `raft.pdf`, Ongaro & Ousterhout),
given as an interactive website instead of slides, plus a free-play sandbox.

Open `site/index.html` (the presentation) or `site/sandbox.html` in a browser.
There is no build step and no dependencies.

## The presentation

The talk starts from an empty system and builds Raft one failure at a time:
each slide shows something going wrong live, then adds the rule that fixes it.
The rules collect in a "Rules so far" sidebar, which ends up as Raft's rulebook.

| # | Slide | Rule added |
|---|---|---|
| 1 | The goal: a replicated, deterministic log | Same log, same order ⇒ same state |
| 2 | Problem: everyone accepts writes | One leader decides the order |
| 3 | Why a majority? *(optional)* | Decisions need 3 of 5 |
| 4 | Problem: naive election, split vote forever | Terms, one vote per term |
| 5 | Fix: randomized timeouts, heartbeats, leader failover | Random timeouts + heartbeats |
| 6 | Problem: fire-and-forget replication on a lossy network | |
| 7 | Fix: previous-entry check, acks, retries | Append only if previous entry matches |
| 8 | Problem: applying too early loses an acknowledged write | |
| 9 | Fix: commit before apply | Apply only committed entries |
| 10 | Demo: a returning server catches up | nextIndex walks back |
| 11 | Problem: a lagging server wins and overwrites committed data | |
| 12 | Fix: vote only for up-to-date logs | Election restriction |
| 13 | Demo: network partition, two leaders | Higher term wins |
| 14–15 | Bonus: committing old-term entries (Figure 8) *(optional)* | Count only current-term entries |
| 16 | Recap and what was skipped | |
| 17 | Sandbox | |

Each demo is scripted and uses seeded randomness, so it plays out the same way
every rehearsal, but servers can still be clicked live.

**Keys:** `→`/`Space`/`PageDown` next step · `←` previous slide · `R` replay the slide ·
`P` pause · `+`/`−` speed · `C` client write · `N` speaker notes · `#/7` in the URL jumps
to a slide. Click a server to crash/restart it, shift-click to force its election timeout.
Optional slides are hatched in the progress bar.

## The sandbox

The full simulator: five servers, animated RPCs, logs, state machines, the client's
acknowledged writes, a network partition toggle and a lossy-network mode.

## Code

- `site/raft-sim.js`: the Raft engine. Each mechanism can be switched off with a flag, which is how the "problem" slides break things.
- `site/raft-view.js`: canvas and panel rendering
- `site/slides.js`: the talk's content and scripted scenarios
- `site/deck.js`: presentation controller
- `tests/slides.test.js`: plays every slide headlessly and checks each one shows its failure or its fix (`node tests/slides.test.js`, needs Playwright)

## Deploying to k3s with ArgoCD

The site is served by nginx (`nginx-unprivileged`) from a ConfigMap that
kustomize generates from the files in `site/`, so there is no image to build or
registry to push to. Every push to `main` changes the ConfigMap's hash and ArgoCD rolls
the Deployment.

1. Edit the host in `deploy/ingress.yaml` (k3s's bundled Traefik serves it).
2. If the repo is private, add it under ArgoCD → Settings → Repositories.
3. Register the app once:

   ```sh
   kubectl apply -n argocd -f argocd/application.yaml
   ```

Preview the rendered manifests with `kubectl kustomize .`.
