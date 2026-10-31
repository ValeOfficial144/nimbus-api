# nimbus-api
if you liked stratus, you'll like this even more!

# what is this?
a cloud gaming API that auto-creates sorastream accounts and streams games to a browser via native WebRTC. no iframes, no embeds — just raw WebRTC video with full keyboard + mouse input forwarding.

built with bun + fastify. hit `localhost:3000` and you get a game catalog, click a game, and it streams.

# how it works
1. creates a temp email via mail.tm
2. signs up on sorastream, verifies email, activates free trial
3. loads the game catalog (~400 free games)
4. when you click a game, starts a session and negotiates WebRTC directly to the game server
5. binary input (mouse/keyboard) is forwarded over the data channel

# project structure
```
api/
  index.ts        — fastify app, registers all routes
  accounts.ts     — POST /api/accounts — auto-creates sorastream account
  catalog.ts      — GET  /api/catalog/games, /genres, /games/:id
  stream.ts       — POST /api/stream — starts game session (SSE queue updates)
  signal.ts       — GET  /api/signal?server= (WebSocket) — proxies WebRTC signaling
  mail/
    useOther.ts   — mail.tm client
public/
  embed.html      — full UI: game grid + native WebRTC player with input
```

# how to run
1. clone the repo
2. install deps
```bash
bun install
```
3. run it
```bash
bun run dev
```
4. open `http://localhost:3000`

# production deployment
```bash
pm2 start "bun run start" --name nimbus
pm2 save
```

reverse proxy with caddy:
```Caddyfile
:443 {
    handle /api/nimbus* {
        reverse_proxy 127.0.0.1:3000
    }
}
```

# license
source-available with required attribution. see [LICENSE](LICENSE). if you use this, you must credit me visibly.
