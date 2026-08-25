# Claude Remote — Security Model

**Status:** Decided v1
**Date:** 2026-08-24 · revised 2026-08-25 for the terminal bridge
**Owner:** Subham Biswas

> Short by design. It records one decision, the single gap that decision leaves,
> and the two rules that step 2 must follow. Everything that used to be here
> about OAuth, TOTP, lockouts and session handling is gone with the code it
> described — recoverable from git at `574ba4f` if it is ever wanted back.

---

## 1. The Decision

**The network is the gate. There is no sign-in.**

Tailscale decides which devices exist; every one of them is trusted completely.
The server binds where only those devices can reach it — `127.0.0.1` (reached
via `tailscale serve`) or the machine's own `100.x.y.z` address. `config.ts`
refuses to start on any other address, `0.0.0.0` above all, because that would
put an unauthenticated server on the local network.

This replaced a two-layer scheme (Google OAuth or password, then TOTP) built for
a public ngrok URL. Once there is no public URL, most of what that scheme
defended against stops existing: nobody can find the address, and WireGuard keys
already authenticate the device. Trading ~700 lines for a network boundary is a
good trade for a personal tool.

**What this buys:** no public listener, no third-party auth dependency, no
secrets in `.env`, no sign-in friction from a phone.

**What it costs:** any device on the tailnet has full access, with no second
layer — and because the bridge is a terminal, that access is a shell (§3). A
lost unlocked phone is a full compromise of the machine. That is accepted.

## 2. The Gap Tailscale Does Not Close

Tailscale protects against everyone on the network. It cannot protect against a
request the owner's own browser is tricked into making.

**DNS rebinding.** A page on `evil.com` re-resolves its own name to `127.0.0.1`
and scripts requests at this server. The packets genuinely originate from a
trusted device, so no network rule sees anything wrong.

This is the one thing app-layer code still has to handle, and it is why
`src/security/` exists. It checks the **name in the request** (`Host`, and
`Origin` when present) rather than the address it arrived from. That distinction
is the entire design: judging names costs nothing in reach, so loopback, the
whole Tailscale range (`100.64.0.0/10`) and any `*.ts.net` name are allowed
automatically. **A device added to the tailnet tomorrow needs no configuration.**
`ALLOWED_HOSTS` covers anything else.

Verified behaviour:

| Request | Result |
|---|---|
| `Host: 127.0.0.1:4180` | allowed |
| `Host: 100.109.114.92:4180` | allowed |
| `Host: any-new-device.tail7b6b35.ts.net` | allowed |
| `Host: evil.com` (rebound to loopback) | **403** |
| `Origin: https://evil.com` | **403** |
| `Origin: null` (sandboxed iframe) | **403** |
| `Host: evil.ts.net.attacker.com` | **403** |
| `Host: 192.168.1.50:4180` (LAN) | **403** |

## 3. Rules For The Terminal Bridge

We drive the real `claude` CLI in a PTY rather than the Agent SDK, so the work
runs on the Max subscription (see `docs/03-implementation-plan.md` §0). That
choice changes what this document can honestly promise.

### The bridge is a shell, not a remote control

Claude Code always had a Bash tool, but a permission prompt sat in front of it.
A raw PTY does not, and `!` runs shell commands directly. So:

**Any device on the tailnet has a full interactive shell as you.**

That is accepted, and it is the price of the subscription billing. But it means
the honest description of this product is "a terminal on my machine, reachable
from my tailnet" — not "a door to Claude". Every judgement below follows from
that sentence rather than from the softer one.

### R1 — The WebSocket upgrade gets the same host check *(now the critical one)*

`SameSite` does not protect WebSocket handshakes and WebSocket has no CORS. A
socket endpoint that skips the guard reopens the DNS-rebinding hole `src/security/`
exists to close — and under this design that hole reaches **a shell**, not a
permission prompt.

`registerHostGuard` is a global `onRequest` hook, so HTTP is covered
automatically. Whether it fires on the upgrade depends on how the WebSocket
plugin is wired. **Verify it by test, written before the socket works.** It is
the cheapest insurance in the project and it guards the worst outcome.

### R2 — ~~Confine Claude to declared project directories~~ *(withdrawn)*

This rule was written for the Agent SDK design, where `cwd` and `disallowedTools`
were enforced by the harness. With a terminal there is no harness: `cd` works,
`!` works, and the tmux prefix opens new windows.

**`cwd` on a tmux session is a convenience, not a boundary.** The rule is
withdrawn rather than left standing as something the design cannot keep. A rule
you cannot enforce is worse than no rule, because it invites you to believe you
are protected.

What remains, and is real:

- The permission prompt still gates Claude's own tool use. Never run with
  `--dangerously-skip-permissions`.
- The tailnet is the boundary. Keep it small, and audit the device list the way
  you would once have audited a session list.

## 4. Standing Principles

- **Never make an authorization decision from a client-supplied header.**
  `trustProxy` is set to `['127.0.0.1', '::1']`, not `true`, so only the
  `tailscale serve` hop can set `X-Forwarded-For`. With `true`, any caller could
  choose what `req.ip` said about them.
- **A loopback check does not mean what it looks like under a proxy.** With
  `tailscale serve` every request arrives from `127.0.0.1`, so gating on the
  socket address would pass for the entire tailnet while reading as though it
  did not. `/api/health/detail` is open by design instead, and keeps genuinely
  sensitive values (such as filesystem paths) out of its response.
- **Fail closed.** The guard is a global hook, not a per-route opt-in.
- **`tailscale serve` is tailnet-only. `tailscale funnel` publishes to the whole
  internet.** One word apart. Never run funnel against this app.

## 5. If This Ever Needs To Be Public Again

Restore from `574ba4f` and re-read the findings recorded there. The four that
mattered, none of which are fixed in the deleted code: `trustProxy: true` made
`req.ip` spoofable; the failure lockout was global and let a stranger lock the
owner out; the session token was not rotated when TOTP elevated it; and TOTP is
phishable in a way passkeys are not.
