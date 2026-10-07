# Interactive Raft

A browser-based, interactive visualization of the Raft consensus algorithm
(see `raft.pdf`, Ongaro & Ousterhout) running on a 5-server cluster.

Open `index.html` in any modern browser — no build step or dependencies.

## What you see

- **Cluster view**: five servers colored by role (follower / candidate / leader),
  their current term, and a ring showing each one's randomized election timer.
  RPCs are animated as they travel: `RequestVote` (amber), `AppendEntries` (blue,
  number = entries carried, empty = heartbeat), replies drawn hollow
  (red = rejected), and client commands (purple).
- **Replicated logs**: every server's log, one cell per entry, colored by term.
  Committed entries are solid, uncommitted ones are faded. The leader's
  `nextIndex/matchIndex` for each follower is shown alongside.
- **State machines**: the key/value store each server builds by applying committed
  entries, plus a live check that all applied entries agree across servers.
- **Event log**: elections, commits, log truncations, crashes and restarts.

## Interacting

- **Click a server** to take it offline; click again to restart it. A restart keeps
  the persistent state (`currentTerm`, `votedFor`, log) and loses the volatile
  state (commit index, state machine), which it rebuilds from the leader.
- **Shift-click** a server to force its election timeout.
- **Client request** sends a random `key=value` command to the current leader;
  enable **auto requests** to generate a steady stream.
- Pause, reset and change simulation speed with the controls.

## Deploying to k3s with ArgoCD

The page is served by nginx (`nginx-unprivileged`) from a ConfigMap that
kustomize generates from `index.html`, so there is no image to build or registry
to push to. Every push to `main` changes the ConfigMap's hash and ArgoCD rolls
the Deployment.

1. Edit the host in `deploy/ingress.yaml` (k3s's bundled Traefik serves it).
2. If the repo is private, add it under ArgoCD → Settings → Repositories.
3. Register the app once:

   ```sh
   kubectl apply -n argocd -f argocd/application.yaml
   ```

Preview the rendered manifests with `kubectl kustomize .`.
