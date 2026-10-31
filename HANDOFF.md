# nimbus-api — AI Handoff Document

## What this is

A Fastify/Bun TypeScript API that auto-creates Sorastream accounts and streams games to a browser via native WebRTC (no iframes). The browser at `localhost:3000/embed.html` auto-boots: creates an account, loads the catalog, and when the user clicks a game, negotiates WebRTC directly to the game server.

**Stack:** Bun runtime, Fastify v5, TypeScript, axios, @fastify/websocket  
**Run:** `bun run dev` (watches files, port 3000)  
**Test page:** `http://localhost:3000/embed.html`

---

## Project layout

```
api/
  index.ts        — Fastify app, registers all plugins/routes
  accounts.ts     — POST /api/accounts — creates Sorastream account
  catalog.ts      — GET  /api/catalog/games, /genres, /games/:id
  stream.ts       — POST /api/stream — starts game exec session (with queue retry)
  signal.ts       — GET  /api/signal?server= (WebSocket) — proxies WebRTC signaling
  mail/
    useOther.ts   — mail.tm client (getDomains, createMailbox, waitForMessage)
public/
  embed.html      — full test UI: catalog grid + native WebRTC player
```

---

## Platform: Sorastream / Ludiumlab

- **Sorastream** (`www.sorastream.com`) is a cloud gaming platform built on **Ludiumlab** (`ludiumlab.com`)
- REST API base: `https://www.sorastream.com/api/`
- All API responses: `{ status: "OK"|"error", data: {...} }`
- Auth: JWT stored in cookies (`token=`, `userId=`, `profileId=`)
- S3 image CDN: `https://ludium-public-resources.s3-eu-west-1.amazonaws.com`

---

## Account creation flow (`api/accounts.ts`)

1. `getDomains()` → pick `temp.tf` or fallback from mail.tm
2. `createMailbox()` → get temp email address
3. `POST /api/signup` with Basic auth + user/profile body
   - Response sets `token=`, `userId=`, `profileId=` cookies (SameSite=Strict — can't use cookie jar, must extract manually from `set-cookie` header)
4. `waitForMessage({ timeout: 60s })` → any email to the mailbox
5. Extract 4–8 digit code from email body/subject with `/\b(\d{4,8})\b/`
6. `GET /api/self/login-methods/email/verify-code?token={code}` — marks email confirmed server-side (JWT doesn't change, but server unlocks the account)
7. `POST /api/self/purchases/free-trial` — activates free trial subscription
8. Returns `{ email, password, token, userId, profileId }`

**Known quirk:** `axios` types `set-cookie` as `string[]` only, so the TypeScript else-branch for the cookie string extraction shows a TS error (harmless — at runtime it's always an array).

---

## Catalog (`api/catalog.ts`)

Proxies `GET /api/games` (no auth needed). Key fields on each game object:
- `game_id` — UUID used in exec calls
- `title` — display name
- `type` — `"ludium"` | `"steam"` | `"standalone"` | `"battlenet"` | `"epic"`
- `thumb_vertical.esc_150_url` — portrait thumbnail path (prefix with S3 URL)
- `blur_for_guests` — boolean, true = premium-only

**Free membership filter:** Only `type === "ludium" && !blur_for_guests` games work with a free trial account. Steam/battlenet/epic/standalone games either require platform ownership or give `IrisErrnoGameNotAvailableInMembership` (errno 197).

~400 ludium games out of 519 total. The UI fetches `size=200` and filters client-side.

---

## Game session / streaming (`api/stream.ts`)

`POST /api/stream` body: `{ token, userId, profileId, gameId, gameName?, lang? }`

Calls `POST /api/profiles/{profileId}/execs` with:
```json
{ "data": { "client_id": "WebBrowser", "region_code": "US", "lang_code": "en-US", "entry_id": "{gameId}" } }
```
Cookie: `token={token}; userId={userId}; profileId={profileId}`

**Success:** returns `{ exec_ip: "notable-ocelot.ludiumlab.com", exec_token: "..." }`

**Queue handling:** Server is often busy → Sorastream returns `IrisErrnoUserHasBeenEnqueued` (errno 303) with `retry_in: 5` seconds and `position: N`. The code loops for up to 10 minutes waiting for a slot.

Returns: `{ server: "stg-plt-1.ludiumlab.com", execToken: "..." }`

---

## WebRTC signaling protocol (reverse-engineered from `html.sorastream.com/main.*.js`)

The game player at `html.sorastream.com` connects to the game server via WebRTC with a custom signaling WebSocket.

**Signaling flow:**
1. Client opens `wss://{exec_ip}` with subprotocol `"sorartc-1.0"`, binaryType = arraybuffer
2. Server sends: `{"type":"offer","sdp":"..."}` (text JSON)
3. Client creates `RTCPeerConnection`, calls `setRemoteDescription(offer)`, `createAnswer()`, `setLocalDescription(answer)`
4. Client waits for `iceGatheringState === "complete"` (non-trickle ICE — all candidates bundled in SDP)
5. Client sends: `{"id":"server","type":"answer","sdp":"..."}` (text JSON)
6. WebRTC P2P connection establishes, server-initiated data channel opens

**ICE servers** (hardcoded in ludiumlab's JS, work for all sessions):
```js
[
  { urls: `stun:${server}:3478` },
  { urls: `turn:${server}:3478`, username: "1830297600", credential: "soQ5kv5gWwPwF2bZcqKZbDqds0k=" }
]
```

**Data channel protocol** (after DC opens, binary messages with uint32LE length prefix):
```
[4 bytes: uint32LE length][UTF-8 JSON bytes]
```
Messages to send in order (wait for `ack: "ok"` between each):
1. `{ action: "auth", method: "classic", token: execToken }`
2. `{ action: "appconfigure", screen_size: [W, H], quality_mode: 3, audio_fmt: 4, video_fmt: 1, audio_stream_enabled: 1, video_stream_enabled: 1, fps: 60, session_type: 0, gamepads: 1 }`
3. `{ action: "apprun", game: gameName }`

**Important:** `audio_fmt` and `video_fmt` are numeric enums, not strings:
- `audio_fmt`: NONE=0, AAC=1, MP3=2, OGG=3, OGG_OPUS=4
- `video_fmt`: NONE=0, H264=1, MPEG=2

After apprun ack, the server transitions to PLAYING state and video tracks stream to `pc.ontrack`.

---

## Signal proxy (`api/signal.ts`)

`GET /api/signal?server={exec_ip}` — WebSocket endpoint (registered with `@fastify/websocket`).

- Opens `new WebSocket("wss://{server}", ["sorartc-1.0"])` using Bun's global WebSocket
- Proxies text messages bidirectionally
- **Critical:** `@fastify/websocket` delivers incoming client messages as `Buffer` — must call `.toString()` before forwarding to the upstream, otherwise the game server receives binary and ignores the SDP answer

---

## Frontend (`public/embed.html`)

Single HTML file, no build step.

**Boot sequence:**
1. Parallel: `POST /api/accounts` + `GET /api/catalog/games?size=200`
2. Filter catalog to `type === "ludium" && !blur_for_guests`
3. Show game grid

**Player (native WebRTC):**
- Full-screen overlay (`#player`)
- `<canvas class="ambient">` — blurred copy of video for ambient lighting effect (rAF loop)
- `<video>` element for the stream
- On game click: POST /api/stream (SSE) → get `{server, execToken}` → open WebSocket to `/api/signal?server=` → negotiate WebRTC → data channel auth → appconfigure → apprun → video appears
- ESC key closes player

---

## Current status

**Working end-to-end.** Account creation → catalog → game session → WebRTC signaling → data channel auth/config/apprun → video streaming with input forwarding all functional.

### Remaining improvements

1. **Account registration has no pooling.** Every page load creates a brand-new Sorastream account (~4s). Could add a pre-warmed account pool.

2. **`extractCode` regex is fragile.** Uses `/\b(\d{4,8})\b/` which could match dates. Works in practice because the verification email body is short.

3. **mail.tm can be flaky.** Domain availability and rate limits cause intermittent account creation failures. A retry or fallback domain strategy would help.

---

## Dependencies

```json
{
  "@fastify/static": "^10.1.5",
  "@fastify/websocket": "^11.3.4",
  "axios": "^1.20.0",
  "axios-cookiejar-support": "^7.0.0",
  "fastify": "^5.12.5",
  "tough-cookie": "^6.0.2"
}
```
