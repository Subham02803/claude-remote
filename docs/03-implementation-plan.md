# Claude Remote — Implementation Plan

**Status:** Ready to build
**Date:** 2026-08-24
**Owner:** Subham Biswas
**Baseline:** `e829eb1` — network-gated access, no sign-in

> Seven steps. Each one ends somewhere you could stop and still have something
> that works, and each one is small enough to finish in a sitting.

---

## 0. The decision this plan is built on

**We drive the real `claude` CLI in a terminal. No SDK, no API key.**

The Agent SDK would bill every run to metered API credits while the Max plan sat
unused. The CLI is already signed in to that plan, so running it is the only
approach where a remote run costs the same as sitting at the desk.

Three things follow, and they shape every step below:

| | |
|---|---|
| **tmux is the session** | `claude` runs inside a tmux session. Browser closes, server restarts, phone dies, you move to the laptop — tmux does not care. Scope P2 ("never lose a session") stops being something we build. |
| **Hooks are the structure** | Claude Code hooks support `type: "http"` and POST JSON to a URL. That gives us blocked / finished / failed / tool-used as **events**, with no terminal-scraping. |
| **The transcript is the history** | Every hook payload carries `transcript_path`, pointing at the session's JSONL on disk. Structured history without parsing one escape sequence. |

```
   browser  ──ws──▶  Fastify  ──node-pty──▶  tmux ──▶ claude (Max plan)
      ▲                  ▲
      │                  └──http──  hooks (PermissionRequest, Stop, …)
      └── xterm.js renders the real TUI
```

### Assumption flagged

This plan assumes **terminal plus a thin phone layer** — xterm.js renders the
real TUI everywhere, and on a phone you additionally get big Approve / Deny
buttons that write keystrokes into the PTY. UC-1 is the reason the product
exists, and hunting for a number key on a 390px screen would kill it.

**If you want raw terminal only, Step 7 is the only step that changes.**
Everything before it is identical.

### What this costs — read once, then decide

A terminal in a browser is **a shell, not a remote control for Claude**. Claude
Code already had a Bash tool, but an approval prompt sat in front of it; a raw
PTY does not, and `!` runs shell commands directly. With no sign-in, **any
device on your tailnet has a full shell as you.**

That is a defensible choice for a personal tool. Two things follow:

- The tailnet gate now does **100%** of the security work. The `Host`/`Origin`
  guard matters *more*, not less — a page that reaches this by DNS rebinding
  gets a shell, not a permission prompt.
- `docs/02-security-model.md` rule **R2** ("confine Claude to declared project
  directories") is no longer enforceable at the app layer. It has to be
  rewritten, not left standing as a rule the design cannot keep.

---

## 1. Fix the documents first &mdash; **done**

Wrong documents are worse than no documents.

| File | Status |
|---|---|
| `design/architecture.html` | **Rewritten** for tmux + PTY + hooks. New diagrams: the two paths, tmux durability, the keystroke approval round-trip, hook-driven states. |
| `docs/02-security-model.md` | **§3 rewritten.** R1 promoted to critical (the socket is now a terminal). **R2 withdrawn** — `cwd` on a tmux session is a convenience, not a boundary, and a rule you cannot enforce is worse than no rule. |
| `design/prototype.html` | Deferred to after Step 3, when we know what a real terminal looks like in that layout. |

---

## Step 2 — WebSocket, with the Origin test written first &mdash; **done**

**Answer to the question this step existed to ask:** yes, the host guard *does*
run on the WebSocket upgrade with `@fastify/websocket@11`. It was worth proving
rather than assuming — and proving it turned up two real bugs that a "looks
fine" assumption would have shipped.

**Built**
- `@fastify/websocket@11`; `WS /api/stream` echoes for now.
- `src/app.ts` — `buildApp()` split out of `index.ts`, so a test can drive the
  real stack instead of a mock. `index.ts` now only loads config, opens the
  database, and listens.
- `src/stream/origin.test.ts` — 8 cases, written before the route existed and
  first run red for the right reason. `pnpm test` at the root, `node --test`
  under the hood, no test framework added.

**Two bugs the test caught**

1. **A refused upgrade leaked its socket.** Node routes `Upgrade` requests
   outside the normal request flow, so a socket refused in `onRequest` is never
   in the set Fastify's `forceCloseConnections` tracks. Replying 403 alone left
   it open forever and shutdown hung on it. The guard now closes the connection
   when it refuses an upgrade.
2. **The `ws` server kept its own client list.** Closing Fastify did not close
   them. An `onClose` hook now terminates them — a terminal never goes idle, so
   waiting for one to is waiting forever.

Both would have looked like "the server sometimes doesn't stop" much later,
with no obvious cause.

**Verified**

| Case | Result |
|---|---|
| `Host: 127.0.0.1` | open |
| `Host: 100.109.114.92:4180` (tailnet) | open |
| `Host: some-new-laptop.tail7b6b35.ts.net` | open |
| `Host: evil.com` (rebound) | **403** |
| `Origin: https://evil.com` | **403** |
| `Origin: null` (sandboxed iframe) | **403** |
| `Host: evil.ts.net.attacker.com` | **403** |
| two sockets at once | both open |

All eight pass in ~310ms, and the same four cases were re-checked through the
container on port 7420.

## Step 3 — The PTY bridge &mdash; **done**

**Goal:** open a browser, see Claude Code, type into it.

**Build**
- Server: `node-pty@1.1.0`. Web: `@xterm/xterm@6` + `@xterm/addon-fit@0.11`.
  *(Verified — xterm moved to the `@xterm/*` scope; the unscoped `xterm` is
  frozen at 5.3.0 and is the wrong one.)*
- One tmux session per remote session:
  ```
  tmux new-session -d -s cr-<id> -c <project path> claude
  tmux attach -t cr-<id>        # what node-pty actually spawns
  ```
- Socket carries three things: output bytes down, keystrokes up, and resize
  (`cols`/`rows`) up.
- Attaching is the *only* way in. Never spawn `claude` directly — going through
  tmux is what makes everything survive.

**Done when** &mdash; **all verified**
- ✅ Claude Code renders in a browser tab, signed in on the Max plan, in the
  project folder. Not a mock: `Opus 5 · Claude Pro`, `~/Projects/claude-remote`.
- ✅ Typing in the browser lands in Claude Code's prompt.
- ✅ Resize propagates (`{t:'r',cols,rows}` → `pty.resize`), wired from the
  first commit rather than after the layout work.
- ✅ **Durability, the whole premise:** typed text survived the browser tab
  closing, the server process being *killed*, a fresh server starting, and a
  new tab opening. Same operation as device handoff (UC-8) — there is no
  separate code path for it.

**Built**
- `src/terminal/tmux.ts` — the thin tmux wrapper. `tmux list-sessions` is the
  source of truth for what exists; nothing caches.
- `src/terminal/bridge.ts` — `tmux attach` in a pty, plus the client message
  parser. Closing a bridge detaches (`Ctrl-B d`); it never stops the work.
- `WS /api/terminal/:id` — server→client is raw terminal bytes; client→server
  is **JSON only** (`{t:'i',d}` / `{t:'r',cols,rows}`), so a stray keystroke can
  never be mistaken for a control message.
- `apps/web/src/screens/Terminal.tsx` — xterm.js, themed to the app palette.
- `TERMINAL_CWD` / `TERMINAL_COMMAND` config. Tests set the command to `bash`
  so proving a header check works does not spend subscription quota.

**Also fixed:** Vite's proxy needed `ws: true`, or it proxies the HTTP request
and silently drops the upgrade.

## Step 4 — Projects and many sessions &mdash; **done**

**Built**
- `PROJECTS=name=/path,name=/path` in config. Declared, never discovered, and
  the server refuses to boot if one is not a directory — a session that dies the
  moment it starts is a worse error than one that never starts.
- Migration `002_sessions.sql`; `src/session/store.ts` holds the reconciliation.
- `GET /api/projects`, `GET /api/sessions`, `POST /api/sessions`,
  `DELETE /api/sessions/:id`.
- `apps/web/src/screens/Workspace.tsx` — the overview, grouped by project.
- Real URLs (`/terminal/:id`) so back works and a session can be bookmarked or
  sent to another device, which is most of what handoff needs.

**The rule that matters:** `tmux list-sessions` decides what exists. The
database holds only what tmux cannot — project, title, originating device.
Verified in both directions:

| What happened | What the app did |
|---|---|
| session killed directly in tmux | shows `ended` |
| session created outside the app | **adopted**, not ignored |
| `POST` with an unknown project | 404 |
| socket to an unknown session | closed 1008 |

**Also changed:** `openBridge` no longer creates sessions. Attaching and
starting are different verbs now, so a typo in a URL cannot quietly spawn a
Claude in an unexpected folder.

**Verified in the browser:** two projects, three sessions, opened each in turn —
`pwd` in one showed the demo folder and the other `/tmp`, with no crossed
streams. Ended sessions render dimmed with no End button.

**One bug found and fixed:** a dead `.card` rule left behind by the old Home
screen was overriding the new one (`flex-direction: column`), pushing every End
button below its card. Home was already unreachable, so it and its styles are
gone.

## Step 5 — Hooks: honest status without reading the screen &mdash; **done**

**The decision this step turned on:** `claude --settings <file>` exists. So hook
config goes in a file *we* generate, passed only to sessions *we* start. It
touches neither `~/.claude/settings.json` nor your project folders — the
question about where hook config lives is moot.

**And it solves the mapping trap for free.** One settings file per session means
the hook URL can carry our own session id (`/api/hooks/:id`). No correlating on
`cwd`, which was never a unique key.

### Two findings from testing, both load-bearing

1. **`SessionStart` never fires over `type: "http"`.** Verified three times.
   `command` hooks fire for every event; http works for PreToolUse, PostToolUse,
   Stop and UserPromptSubmit but not SessionStart. So **everything uses `command`
   hooks** (a `curl` that forwards stdin) — one transport, one failure mode.
   Hook failures are swallowed (`|| true`): a hook that cannot reach us must
   never be why a session stalls.
2. **Auto mode changes what "waiting on you" means.** Your Claude runs with
   `⏵⏵ auto mode on`, which auto-approves tools — so a Bash call produced
   `PreToolUse`, and **`PermissionRequest` never fired at all.** The blocked
   state depends on the permission mode the session runs in. This matters for
   step 7 and is worth deciding deliberately: auto mode is fewer interruptions
   and no unblock-from-phone.

**Built**
- `src/hooks/settings.ts` — generates the per-session settings file.
- `src/hooks/routes.ts` — `POST /api/hooks/:id`, the status machine, event log.
- Migration `003_hooks.sql` — status columns plus an append-only
  `session_events` table.
- `SessionStatus` narrowed from `live|ended` to
  `starting|working|waiting|done|failed|ended`. Narrowing it caught every place
  that had assumed a binary.
- Status badges in the overview, coloured by state.

**Verified end to end**, twice — once by API, once through the UI:

```
SessionStart → UserPromptSubmit → PreToolUse Bash → PostToolUse Bash → Stop
   working         working          running Bash       finished Bash     done
```

The UI showed a green **DONE** badge and "finished · nothing is waiting on you"
without reading one byte of the terminal. Claude's own `session_id` is captured
at `SessionStart`, which is the key the on-disk transcript is filed under — what
the Changes tab will read in step 8.

## Step 6 — Push notifications &mdash; **done**

**Built**
- `web-push@3`, migration `004_push.sql`, `src/push/send.ts` + `src/push/routes.ts`.
- VAPID pair generated on first use and kept in `meta` — generated, not chosen,
  and regenerating it would silently invalidate every subscribed device.
- `apps/web/public/sw.js` — shows the notification, and on tap **reuses an open
  tab** rather than opening a second copy of the app.
- An `alerts on/off` toggle in the overview, which sends a test notification the
  moment it is switched on.

**The rule, enforced by code rather than by a setting.** Only `blocked` and
`failed` may interrupt you. Verified by firing every event at a live
subscription:

| Hook | Status | Pushed? |
|---|---|---|
| UserPromptSubmit | working | no |
| PreToolUse | working | no |
| PostToolUse | working | no |
| Stop | done | no |
| **PermissionRequest** | **waiting** | **yes** |
| **StopFailure** | **failed** | **yes** |

**Also verified:** a dead subscription (404/410) is marked `gone_at` instead of
being retried forever, `sent: 0` comes back cleanly, and the server does not
flinch — a push that cannot be delivered must never break the thing that
triggered it. Alerts are fired with `void`, never awaited: a slow push service
holding up a hook would hold up Claude.

**`localhost` is a secure context**, so service workers and push work in
development with no tunnel. `tailscale serve` is only needed to reach a phone.

**One step needs a human:** granting notification permission is a browser prompt
that cannot be clicked programmatically. Everything up to it is verified — the
worker registers, the key is served, subscribe/unsubscribe round-trip, and the
send path handles both success and dead endpoints. Click **alerts off** in the
overview to finish it.

## Step 7 — The phone layer &mdash; **done**

**Built**
- Migration `005_asks.sql`; one open ask per session, enforced.
- `PermissionRequest` opens an ask; **any event that moves the session on closes
  it** — so a button can never point at a prompt that has already advanced.
- `src/terminal/keys.ts` — `tmux send-keys` reaches a session without a terminal
  socket open, which is what makes answering from a phone a two-tap operation.
- `POST /api/sessions/:id/decision` — refuses with **409** unless an ask is
  genuinely open. That check is the difference between answering a question and
  typing a stray `1` into whatever the terminal happens to be showing.
- The approval card: full command untruncated, **Deny the same size and beside
  Approve** (scope §10 — the safe answer must be as easy to hit), End hidden
  while a question is open.
- Every decision writes to `audit_log`: what, which tool, from which device.

**We never send `2`.** Claude Code's prompt offers a "don't ask again" option.
Pre-approving everything from a phone is the one control that turns a mistap
into unrestricted execution, so `ANSWER` has two entries and that is not one of
them.

**Verified end to end**, API and UI:

| | |
|---|---|
| decision with nothing open | **409** |
| PermissionRequest | status `waiting`, ask carries the full command |
| approve | `1` lands in the real terminal, ask closed `from=this browser` |
| answering twice | **409** |
| deny (clicked in the UI) | Escape delivered, `doing = taking another route` |
| audit log | `ask.approve`, `ask.deny`, with the exact command |

**Still true from step 5:** in `⏵⏵ auto mode`, Claude approves its own tools and
`PermissionRequest` never fires — so this screen stays empty. The machinery is
right; whether you ever see it is a permission-mode decision.

## Step 8 — The rest of the workspace &mdash; **done**

**Built**
- **Prompt composer** — a text box under the terminal that writes into the
  session via `tmux send-keys -l`. Scope §5.1 asks for less typing on a phone,
  and a full-width box beats a virtual keyboard fighting an xterm. Enter sends,
  Shift-Enter is a newline.
- **Stop** — `Ctrl-C`, which interrupts the run and **leaves the session open**.
  Ending it for real is still `DELETE`. Verified the session survives.
- **Changes** — `GET /api/sessions/:id/changes`, derived from `PostToolUse` hook
  events, not from the screen.

**Verified end to end** against a real Claude session:

| | |
|---|---|
| prompt via API | Claude received and answered it; hook reported `done` |
| stop | session survived, `doing = stopped by you` |
| changes after a `Write` | `/tmp/cr-write-test.txt`, edits 1, tool Write |

**An honest limitation, found by testing.** Asked to create a file, Claude used
**Bash**, and Changes stayed empty — correctly, because a shell command is not a
file-tool event. So **Changes lists files touched by Write/Edit/NotebookEdit and
will miss anything written through Bash.** The richer source is Claude Code's own
transcript JSONL, whose path we already capture at `SessionStart`
(`src/session/changes.ts` has the reader). Worth doing when the gap actually
bites; documented rather than papered over.

## Step 9 — Make the UI match the prototype &mdash; **done**

Steps 4–8 built the behaviour and put a plain list in front of it. Comparing the
class names side by side showed almost no overlap with `design/prototype.html` —
two different interfaces wearing the same colours.

**Rebuilt to the prototype's structure:**
- `styles.css` is now **ported from the prototype** rather than written
  alongside it, so the two share one vocabulary. Only what the clickable demo
  needed (device frames, page chrome, fake modals) was left behind.
- `components/Shell.tsx` — topbar, the waiting/calm **banner**, and the project
  **rail** with `all projects`, per-project dots and counts, and nested session
  links.
- Cards regained their coloured **status rail**, pill, and elapsed time; a
  waiting card is amber-bordered and shows the command it is blocked on.
- `screens/SessionView.tsx` — the session **tabs** (Terminal / Waiting for you /
  Changes) around the terminal. The terminal stays **mounted but hidden** when
  another tab is shown: unmounting would detach and reattach, redrawing the
  screen every time you glanced at Changes.
- The rail hides below 720px, where the prototype's phone layout drops it too.

**One naming collision worth remembering:** the screen component and the shared
type were both `Session`, which lint caught. The component is `SessionView`.

**Verified against the prototype, side by side in two tabs.** The phone layout
is asserted by CSS but *not* verified at a real narrow viewport — an early check
was flawed (constraining an element does not trigger a viewport media query),
and the honest test needs `tailscale serve` and an actual phone.

## Fix — Stop was broken on ended sessions

Reported from the UI: Stop looked live on a session showing **ENDED**, and did
nothing. Three bugs, one on each side.

**1. The server 500'd.** `sessions.get()` returns the row, and rows are kept
after a session ends so they can still be read back — so the `404` guard passed,
and `send-keys` then ran against a tmux session that was not there:

```
HTTP 500  Command failed: tmux send-keys -t cr-febab67eb9 C-c
          no server running on /private/tmp/tmux-501/default
```

A surviving row is not a running session. `/stop` and `/prompt` now check tmux —
the source of truth — and return **409 `session_ended`**. `/stop` also gained
the `try/catch` that `/decision` and `/prompt` already had; it was the only one
of the three without it.

**2. The button was offered when it could do nothing.** Now rendered only while
the session is live.

**3. The failure was invisible.** `onClick={() => void api.stopSession(id)}`
swallowed the 500 whole — no error, no confirmation, nothing. Silence reads as
"broken" even when it works. Stop now reports either way, and says
**"Interrupted. The session is still open."** on success — which is also the
sentence that stops anyone thinking Stop ends a session.

**Verified:** 409 on an ended session, 200 on a live one, session survives,
`doing = stopped by you`, Stop absent on ended sessions and present on live
ones, green confirmation shown.

**Not cleanly demonstrated:** Ctrl-C landing mid-generation. Claude either
finished first or backgrounded the command both times I tried. Keystroke
delivery itself is proven — the same `sendKeys` path puts `1` and Escape into
the terminal visibly in the step 7 tests — but the interrupt-mid-thought case is
still unproven.

## Build order at a glance

| Step | Ends with | Depends on |
|---|---|---|
| 1 | Documents that match reality | — |
| 2 | A socket that rejects a foreign Origin | — |
| 3 | A working terminal in the browser | 2 |
| 4 | Projects, many sessions, survives everything | 3 |
| 5 | Honest status from hooks | 3 |
| 6 | The phone buzzes when blocked | 5, `tailscale serve` |
| 7 | One-tap approve from a phone | 5, 6 |
| 8 | The rest of the screens | 4, 5 |

Steps 4 and 5 are independent of each other and can be done in either order.

---

## Before Step 2 — things to settle

1. **Where hook config lives** (Step 5). Global settings, per-project local
   settings, or something else. Affects whether we write into your project
   folders.
2. **Whether tmux sessions are locked down.** The tmux prefix lets you open new
   windows, so the "session" is not a sandbox. Either accept that — consistent
   with the shell reality above — or ship a restricted tmux config.
3. **Raw terminal or phone layer** (Step 7). This plan assumes the layer.

## Not doing

- **No Agent SDK, no API key.** The whole point.
- **No terminal scraping for state.** Hooks or nothing. If a hook cannot tell
  us something, we do not display it.
- **No second process.** One Fastify owns the PTYs. tmux owns the durability.
- **No `--dangerously-skip-permissions`.** The permission prompt is the last
  gate that still exists.
