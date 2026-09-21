# Connection state (phone)

The source of truth for how the Android app connects to a laptop, and when it stops trying. Implementation: `app/lib/net/connection.dart` (`LaptopConnection`), `app/lib/net/link_state.dart`, `app/lib/net/backoff.dart`, `app/lib/net/address_race.dart`. Design: spec §6.

## What the user sees

Connection state is shown with **two icon buttons and no words** (design: `.stitch/DESIGN.md` §6). Green = on, grey = off; the glyph also differs (solid vs slashed) and each button has an accessible label.

| Control | On (green) | Off (grey) | Tap |
|---|---|---|---|
| Wi-Fi | connected **and** reaching the laptop over the local network | anything else (including Tailscale) | shows the route as a tooltip |
| Link | connected to the laptop (a live session) | not connected | **connects** (grey) or **disconnects** (green) |

Over Tailscale the Wi-Fi control is grey and the link control green; "via Tailscale" is only a tooltip. The words *Paired* / *Not paired* / *Identity changed* describe pairing, never the connection.

## States (`LinkState`)

| State | Meaning | Link icon |
|---|---|---|
| `notPaired` | seen on the network or added by address, never approved | grey (tap starts pairing) |
| `paired` | paired, no connection wanted | grey |
| `connecting` | attempting; spinner in the link control | spinner |
| `connected` | live session and event stream | green |
| `disconnecting` | ending the session | spinner |
| `unreachable` | connection wanted but the laptop cannot be reached; retrying (or paused in the background) | grey |
| `certChanged` | the laptop presented a different certificate than the pinned one. **Terminal** | grey, problem screen |
| `unpaired` | the laptop no longer knows this phone (revoked or forgotten). **Terminal** | grey, problem screen |

```
notPaired --pair--> paired --connect--> connecting --ok--> connected
                       ^                    |                  |
                       |                    +--unreachable-----+--lost link--> unreachable --retry--> connecting
                  disconnect                +--DEVICE_NOT_PAIRED / UNAUTHORIZED / revoked--> unpaired
                       |                    +--certificate mismatch--> certChanged
                 (intent cleared)
```

## Connect intent

The connection holds an **intent** to be connected.

- **Disconnect** clears the intent: nothing reconnects until the user taps the link again.
- **Network loss, a dead event stream, a laptop restart** keep the intent and reconnect.
- **Terminal states** clear the intent.
- With the setting *Reconnect automatically* off, a failed attempt is not retried.

## Reconnect rules

| Situation | Behaviour |
|---|---|
| Laptop unreachable | retry after **2 s, 4 s, 8 s, 16 s, 32 s, then every 60 s** (capped); reset after a success |
| App in the background | no retries and no event stream; on return: reconnect at once if disconnected, or refetch the list and reopen the stream if connected |
| `SESSION_EXPIRED` (session ended or replaced) | reconnect **immediately** with the device secret (at most twice in a row, then normal backoff) |
| `RATE_LIMITED` | wait the `Retry-After` the laptop gave |
| `DEVICE_NOT_PAIRED` or `UNAUTHORIZED` on connect, or an `expired` event with reason `revoked` | **stop**; state `unpaired`; offer Re-pair or Forget |
| Certificate mismatch | **stop**; state `certChanged`; **the device secret is never sent**; offer Forget and pair again |
| An address answers as a different laptop (another ID) | treated as unreachable; the secret is not sent there |

## Choosing the address

Each laptop keeps a list of **saved addresses** (from the last pairing or connect: Wi-Fi, Tailscale, plus any typed by hand) and the **last verified** one.

1. All saved addresses are probed **in parallel** (`GET /v1/hello` over the pinned TLS client), **3 seconds per candidate**.
2. The first that passes pin verification and reports the expected laptop ID wins; **every other attempt is cancelled at once**.
3. Only then is the device secret sent, on that pinned connection.
4. After every successful connect the list is refreshed from the laptop, keeping typed addresses. A saved laptop seen by discovery at a new address learns it.

The route (Wi-Fi vs Tailscale) comes from the winning address: 100.64.0.0/10 and `*.ts.net` are Tailscale.

## Events and history

The event stream is opened **before** the list is fetched (the laptop does not replay events, so the other order could miss one), and is open only while the app is in the foreground and connected. Live `item-added` / `item-deleted` update the list and the local cache. An `expired` event ends the session: `revoked` is terminal, other reasons reconnect at once. History is cached per laptop (metadata and received images) so **Messages, Images and Files are readable offline**; sending needs a connection.

## Re-pair and Forget

- **Re-pair** starts a new pairing at the laptop's last address. Nothing is forgotten first: on approval the old credentials are replaced (and the old certificate pin with them); cancelling leaves things as they were.
- **Forget** tells the laptop (best effort), then deletes the saved laptop, its secret, its pinned certificate and its cached history.

## Only one laptop at a time

Connecting a laptop disconnects any other. Share-to-FlashPush sends to the connected laptop; with none connected it asks to connect first.

## Resuming after an app or server restart

The connect intent is persisted as `activeLaptopId` (non-secret settings, `data/app_settings.dart`):

| Event | `activeLaptopId` |
|---|---|
| user connects a laptop (link icon, or right after pairing) | set to that laptop |
| user connects another laptop | moves to the other laptop |
| user taps Disconnect on it | cleared |
| user forgets it | cleared |
| app or laptop server restarts | unchanged |

At start (`AppController.init`) the app reconnects the remembered laptop if **auto-reconnect** is on. With it off the laptop starts as *paired, not connected*. While the app is in the background the loop stays paused and resumes when it returns to the foreground; a laptop server restart is handled by the normal reconnect loop (the old session simply expires, `SESSION_EXPIRED` → reconnect with the device secret). Both header icons therefore return to green by themselves; the Wi-Fi icon needs the laptop to be reachable over Wi-Fi, the link icon needs the session.
