# claude-remote

Drive Claude Code on your own machine from any browser.

The work happens on your machine, in your projects, with your setup. This is a
remote control for it — so a run does not sit idle for an hour waiting for you
to answer one question.

> Status: early. The skeleton is done; the terminal, projects and sessions are
> next. See `docs/01-product-scope.md` for what this is and is not,
> `docs/02-security-model.md` for how access is controlled, and
> `design/prototype.html` for the interface it is being built towards.

## Requirements

- Node 22 or newer
- pnpm 9 (`npm i -g pnpm`)
- Optional, for access from your phone or another computer:
  [Tailscale](https://tailscale.com/download) on both this machine and that device

## Running it

```bash
pnpm install
cp .env.example .env
pnpm dev
```

That starts everything on one port: open <http://127.0.0.1:4180>. The API, the
terminal socket and the web app share that origin — in development the assets
come from Vite running inside the server process, so hot reload works as usual
and there is no second address to pick between.

Out of the box that is reachable from this machine only, and needs no `.env` at
all. To reach it from your phone, see below.

## Reaching it from your phone or another computer

There is no sign-in. The network is the gate: the server binds where only your
own devices can reach it, and Tailscale decides which devices those are. See
`docs/02-security-model.md` for why, and for the one thing that model does not
cover.

`HOST` must be a loopback address or this machine's Tailscale address. Anything
else — `0.0.0.0` above all — is refused at boot, because it would put an
unauthenticated server on the local network.

### Recommended: `tailscale serve`

The server keeps binding to `127.0.0.1`; Tailscale terminates TLS inside your
tailnet and proxies to it. Nothing new listens on any network, and you get a
real certificate, which matters for more than eavesdropping — passkeys, service
workers and web push all need a secure context.

1. Enable **HTTPS Certificates** once, at
   <https://login.tailscale.com/admin/dns>.
2. Run it alongside `pnpm dev`:
   ```bash
   tailscale serve --bg 4180
   ```
3. Open `https://<your-machine>.<your-tailnet>.ts.net` on any device signed in
   to your tailnet.

> ⚠️ `tailscale serve` is tailnet-only. **`tailscale funnel` publishes to the
> entire internet** — one word apart. Never run funnel against this app.

### Simpler: bind to the tailnet address

No certificate, no setup, plain HTTP:

```bash
tailscale ip -4                 # e.g. 100.109.114.92
echo "HOST=100.109.114.92" >> .env
```

Then open `http://100.109.114.92:4180` from your phone.

### Which devices can connect

Any device on your tailnet, with no configuration. The server checks the host
*name* a request carries, never the address it came from — so loopback, the
whole Tailscale range (`100.64.0.0/10`) and every `*.ts.net` name are allowed
automatically, and a device you add tomorrow just works. What it rejects is a
page on the open web re-resolving its own name to a local address to script
requests at your server. Add other names with `ALLOWED_HOSTS`.

## Running it in Docker

```bash
docker compose up --build      # → http://127.0.0.1:7420
docker compose down
```

Port 7420 because 3000, 8000 and 8080 are already taken here. Inside the
container the server still listens on 4180; only the published port differs.
The image builds the web app and Fastify serves it, so the whole thing is one
origin on one port.

Two things in `docker-compose.yml` that are load-bearing rather than cosmetic:

- **`"127.0.0.1:7420:4180"`** — the `127.0.0.1:` prefix. Without it Docker
  publishes on every host interface, which would put a server with no sign-in
  on whatever network you are attached to. That is exactly what `config.ts`
  refuses to do on the host, and Docker will happily do it for you.
- **`BIND_ANY=true`** — set only inside the container, where `0.0.0.0` means the
  container's own namespace and the port mapping is what actually decides
  exposure. Setting it on the host is the mistake the bind rule exists to stop.

> ⚠️ From Step 3 of `docs/03-implementation-plan.md` onward, this app runs
> `claude` in tmux **on your machine**, with your Max-plan credentials and your
> project folders. A container has none of those. `docker-compose.yml` lists the
> three ways to resolve that; the simplest is to keep the terminal on the host
> and use `pnpm dev`.

## Layout

```
apps/server        Fastify API, database, host guard, and (soon) the bridge
                   to Claude Code
apps/web           React app
packages/shared    Types used by both, so the two cannot drift
design             Interface prototype
docs               Scope and decisions
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Everything on port 4180, watching |
| `pnpm dev:server` | The same thing without the wrapper script |
| `pnpm dev:web` | Vite alone on 5173, proxying the API — rarely needed |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm check` / `pnpm format` | Lint / lint and fix |
| `docker compose up --build` | The whole app in a container on 7420 |

## Configuration

Every value is documented in `.env.example`. The server validates all of it on
boot and refuses to start with a readable list of problems rather than running
half-configured.

## Licence

MIT
