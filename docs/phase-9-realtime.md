# Phase 9 — realtime collaboration

Server-Sent Events driven by MongoDB change streams (§23). No vendor, no extra
account, no extra secret, no new dependency — Atlas change streams and the
browser's native `EventSource` were both already available.

## Shape

```
editor writes → route handler → MongoDB
                                  │  change stream (db.watch)
                                  ↓
                        GET /api/stream  (text/event-stream)
                              ↙        ↘
                        editor B      editor C
```

**One change stream per connection**, watching the database rather than four
collections separately, so a connected editor costs one Atlas cursor instead of
four. Updates flow server → client only; writes go over ordinary `fetch`, so a
bidirectional socket would buy nothing (and Vercel's serverless functions do not
support raw WebSockets anyway).

Events carry the changed **document**, not a "something changed, refetch" nudge.
One edit is a few hundred bytes where a refetch is the whole working set on
every keystroke somebody else makes (§47). Clients apply the document they are
given, so every browser converges on server truth rather than on its own
arithmetic.

## Verified end to end

| Check | Result |
|---|---|
| SSE headers | `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no` |
| Change propagation | edit from a separate connection appeared in an open browser with **no reload** (34 → 35 entries) |
| Footer stays in step | "Indrani Debnath (12)" updated live from another session |
| Actor naming | badge read "**Test admin** just made a change" |
| Unknown actor | degrades to "Someone" rather than failing |
| Own edits | applied, but **not** announced back to the author |
| Resume | an edit made *while disconnected* was replayed on reconnect |
| Malformed token | ignored, stream starts fresh |
| Dead token | server resets `Last-Event-ID` and recovers; stream stays open and keeps delivering |
| Unauthenticated | `GET /api/stream` → **401** |

## The recycle, and why resume matters

Serverless functions have a maximum duration, and a stream that runs into it is
killed mid-flight. So the connection closes itself deliberately at 4 minutes
(`STREAM_LIFETIME_MS`, under `maxDuration = 300`) and emits a `cycle` event; the
client reconnects immediately rather than waiting out EventSource's backoff.

`EventSource` replays `Last-Event-ID` on reconnect, and that id **is** the
change-stream resume token — so the new stream picks up exactly where the old
one stopped. Nothing is lost across a recycle. A 25-second heartbeat comment
keeps proxies from dropping an idle connection.

### The loop this avoids

A resume token only fails when the stream is *used*, not when it is constructed.
The realistic failure is a laptop closed over a weekend: by the time it wakes,
the token has fallen off the oplog. Naively the server errors, the client
reconnects replaying the same dead id, and the two loop forever.

The server instead sends an **empty `id:` field**, which per the SSE spec resets
the client's `Last-Event-ID`, then reopens the stream without a token. Verified:
a deliberately dead token now yields `id: ` followed by a live stream that keeps
delivering changes.

## Fallback, not design

After two failed connection attempts the client degrades to re-reading
`/api/bootstrap` every 15 seconds and **says so** in a badge — "Live updates
unavailable — refreshing every 15s". §23 rules polling out as the primary
mechanism; this is §43's realtime-failure path. It keeps retrying the stream, so
a recovered network upgrades back to live on its own.

The badge is silent while everything works. A permanent "connected" indicator is
noise; the state worth surfacing is the one where updates have stopped arriving.

## Honest limits

- One held-open invocation and one Atlas cursor per connected editor. Sized for
  the **~5–20 concurrent editors** an institute with three roster sections has,
  not for thousands.
- Change streams require a replica set. Every Atlas tier including M0 qualifies;
  a plain local `mongod` does not (see `docs/local-testing.md`).
- Conflicts are still resolved by the version check from §24 — realtime makes
  them rarer, not impossible.
