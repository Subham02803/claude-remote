# claude-remote

Drive Claude Code on your own machine from any browser.

The work happens on your machine, in your projects, with your setup. This is a
remote control for it — so a run does not sit idle for an hour waiting for you
to answer one question.

> Status: early. The skeleton and authentication are done; the terminal, projects
> and sessions are next. See `docs/01-product-scope.md` for what this is and is
> not, and `design/prototype.html` for the interface it is being built towards.

## Requirements

- Node 22 or newer
- pnpm 9 (`npm i -g pnpm`)
- Optional, for access from outside your machine: [ngrok](https://ngrok.com/download)

## Running it

```bash
pnpm install
cp .env.example .env
pnpm dev
```

That starts the API on <http://127.0.0.1:4180> and the web app on
<http://127.0.0.1:5173>. Open the second one.

Out of the box `AUTH_MODE=none`, which means no sign-in — fine while it is only
reachable from your own machine, and refused by the server if you try to bind it
anywhere else.

## Sign-in modes

Set `AUTH_MODE` in `.env`:

| Mode | First layer | Second layer | Needs |
| --- | --- | --- | --- |
| `none` | — | — | Nothing. Loopback binding only. |
| `local` | A password you set | Authenticator code | `SESSION_SECRET` |
| `google` | Google sign-in | Authenticator code | Google OAuth client, `ALLOWED_EMAIL`, `PUBLIC_URL` |

A code from an authenticator app is always required for `local` and `google` —
proving who you are never grants access on its own. Google is entirely optional;
nothing about the app depends on having a Google account.

### Claiming the installation

The first time you start with `AUTH_MODE` set to `local` or `google`, the server
prints a **setup token** to its own console:

```
────────────────────────────────────────────────────────────────────
  This installation has no owner yet.

  Open  http://127.0.0.1:4180
  Setup token:  4CjBIhc3cHJuP2aikEXzvMTUlXSMuzgu
────────────────────────────────────────────────────────────────────
```

Opening the app then asks for that token before it will let anyone enrol. This
matters because the app is meant to be reachable through a tunnel: without it,
whoever loaded the address first would become the owner. Needing a value that
only appears on the machine's own console means you have to already have access
to the machine to claim it.

After the token comes your identity (Google, or an email and password), then a
QR code for your authenticator app. Scanning it and entering one code completes
setup and spends the token.

To start over, stop the server and delete `data/claude-remote.db`.

### Sessions

Sessions are held server side, so revoking really revokes. A browser marked as
trusted stays signed in for 30 days; one that is not lasts 12 hours. **Lock all
access** signs every browser out at once, including the one you are using.

Eight wrong codes within fifteen minutes locks the second layer for the rest of
that window, valid codes included.

## Reaching it from outside (ngrok)

1. Reserve a free static domain at <https://dashboard.ngrok.com/domains>.
   A reserved domain matters: without one, ngrok gives you a different URL on
   every restart, and Google needs one redirect URI that never changes.
2. Put it in `.env`:
   ```
   PUBLIC_URL=https://your-name.ngrok-free.app
   ```
3. Run the tunnel alongside `pnpm dev`:
   ```bash
   pnpm tunnel
   ```

Anything reachable through the tunnel is reachable by anyone who has the URL.
Do not open a tunnel with `AUTH_MODE=none` — the server refuses to bind anywhere
but loopback in that mode for exactly this reason.

## Setting up Google sign-in

Each installation uses its own Google project — there is no shared app, and no
credentials ship with this repository.

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. **APIs & Services → OAuth consent screen**: User type *External*, publishing
   status *Testing*, and add your own address under *Test users*.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   application type *Web application*.
4. Under *Authorised redirect URIs* add exactly:
   ```
   https://your-name.ngrok-free.app/auth/google/callback
   ```
5. Copy the client ID and secret into `.env`, and set `ALLOWED_EMAIL` to the one
   address allowed to sign in.

Leaving the consent screen in *Testing* is fine. This app only uses Google to
learn who you are at sign-in; it never asks for a refresh token, so the
seven-day testing-mode expiry does not affect it.

## Layout

```
apps/server        Fastify API, authentication, database, and (soon) the
                   bridge to Claude Code
apps/web           React app
packages/shared    Types used by both, so the two cannot drift
design             Interface prototype
docs               Scope and decisions
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | API and web app together, both watching |
| `pnpm dev:server` / `pnpm dev:web` | One at a time |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm check` / `pnpm format` | Lint / lint and fix |
| `pnpm tunnel` | ngrok on the domain in `PUBLIC_URL` |

## Configuration

Every value is documented in `.env.example`. The server validates all of it on
boot and refuses to start with a readable list of problems rather than running
half-configured.

## Licence

MIT
