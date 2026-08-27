# RC Scanner Backend Rebuild Specification

## Purpose

Rebuild the backend on a new platform without changing the existing client-facing application directory or its user experience. The replacement may use Go, Rust, Python, or another efficient runtime; Node is not a requirement.

The service controls a locally attached radio scanner, mirrors its LCD and keypad in a browser, and delivers low-latency scanner audio to authenticated remote clients.

## Public Interfaces

| Interface | Port | Purpose |
| --- | --- | --- |
| Full control | 3000 | Existing interactive UI: display, keypad, settings, audio control, additional-audio toggle. |
| View/listen only | 3001 | Existing viewer UI: live display and audio only. It must never accept radio-control commands. |

Serve the existing built client assets unchanged. Preserve its HTTP routes, WebSocket paths, JSON payloads, and WebRTC offer/answer endpoints so no client rewrite is required.

## Required Backend Services

1. **Radio adapter**
   - Open a USB/serial radio connection with configurable baud, data bits, parity, stop bits, flow control, terminator, auto-port discovery, retries, and health status.
   - Poll and/or subscribe to the Uniden BCD436HP serial status feed; publish raw/current display state to both interfaces.
   - Accept only the defined front-panel command set on port 3000. Port 3001 may optionally send one harmless `VFO push` on a display tap to enable/confirm audio, but no configuration-changing command.
   - Keep the adapter modelled as an interface so Icom PCR1000 control can be added as another implementation without changing transport, security, or client code.

2. **Display/control fan-out**
   - Broadcast display/status changes promptly over WebSocket.
   - Maintain a control WebSocket for port 3000 and a distinct observer-only WebSocket for port 3001.
   - Log connection, disconnection, source IP, elapsed session time, control use, audio transport, and failures with timestamps.

3. **Scanner audio capture**
   - On macOS, use **PortAudio** for the scanner USB interface. The known-good BCD436HP configuration is PortAudio device ID `1`, mono signed 16-bit PCM at `44.1 kHz`, with squelch gate default `100`.
   - **Do not use AVFoundation/FFmpeg capture for this scanner by default.** It produced materially poorer, crunchy digital-voice audio despite the same USB interface and WebRTC delivery path.
   - Any alternative capture backend must be accepted only after side-by-side intelligibility testing against PortAudio using the same scanner transmission and browser receiver.
   - Do not drop or burst PCM when a downstream process is back-pressured. Timestamp/pace frames in 10 ms (`480` sample) WebRTC blocks.
   - Capture must be restartable after device loss and must never leave duplicate capture processes alive.

4. **Audio delivery**
   - Primary transport: one WebRTC/Opus audio track per browser session, mono, `48 kHz`; support concurrent listeners on both ports.
   - Obtain ICE servers from Cloudflare TURN credentials held only in server environment/config. Fall back to direct/STUN WebRTC when TURN is unavailable and log the fallback in red terminal output.
   - Browser reconnect/restart handling must recreate WebRTC automatically after server restart.
   - Retain `/audio.wav`, raw PCM WebSocket, and low-bitrate MP3 fallback endpoints for diagnostics/legacy fallback. Do not make fallback the normal mobile path.
   - Keep a short browser test-tone endpoint separate from scanner audio.

5. **Optional additional audio stream**
   - Configurable remote stream URL, label, enabled default, and volume.
   - Modes: `off`, `mix` (scanner plus stream), and `additionalOnly` (scanner muted, stream only).
   - Feed the selected result through the same WebRTC delivery service. Keep the scanner path usable when the remote stream fails or reconnects.
   - The full-control UI controls this state via its existing square LED: grey/off, green/mix, amber/additional-only. The UI text follows the state.

6. **Configuration and backup**
   - Use a local config file plus environment variables/secrets. Never expose TURN API tokens, radio serial number (when hidden), or tunnel credentials to browsers.
   - Preserve settings for ports, hosts, TLS, model, serial, audio device/backend/rate/squelch, injected stream, and WebSocket retry/keepalive.
   - Scope a backup/restore facility for radio programming and local gateway configuration. Prefer supported radio export/programming methods; if unavailable, capture/replay a documented serial-flow backup with explicit compatibility and restore-risk warnings.

## Security and Deployment

- Bind locally to the LAN as configured; expose externally only through separate Cloudflare Tunnel public hostnames for `3000` and `3001`.
- Apply Cloudflare Access/authentication before either hostname. The view-only hostname needs separate, narrower access policy.
- Use Cloudflare TURN for remote WebRTC relay. No nginx is required when Cloudflare Tunnel proxies directly to each local port.
- Treat the server as an authority boundary: browser overlays and disabled buttons are not security controls. Enforce view-only restrictions in backend routing and WebSocket command handling.
- Firewall rules should permit the chosen LAN/tunnel ingress only; serial and audio devices remain local to the host.

## Operational Requirements

- Start the interactive/control service before optional features; scanner display should be usable even if TURN, injected audio, or audio-device listing is delayed.
- Start audio capture lazily on the first listener if practical, and stop it after a brief idle period.
- Keep runtime dependencies outside synchronised/indexed folders such as `~/Documents` when macOS file-provider or provenance delays occur. Production startup must not require frontend build tooling or nodemon.
- Provide health/readiness endpoints for display adapter, serial link, capture process, audio clients, and TURN status.
- On macOS, avoid creating child-process storms; use supervised single instances for capture and injected-stream decoding.

## Acceptance Checks

- A BCD436HP connected by USB updates both screens and responds to controls on `3000`.
- `3001` receives display and WebRTC audio but cannot execute a control command even if browser JavaScript is modified.
- iOS Safari and desktop Chrome can start audio from a user gesture, recover after backend restart, and use TURN when direct WebRTC is unavailable.
- Scanner audio remains intelligible for digital voice, including while the optional stream is enabled/disabled.
- Logs identify each browser, port, audio transport, fallback, and session duration.
- Existing client directory remains untouched and works against the replacement backend.
