# Optional injected audio

RC Scanner can mix one server-side MPEG audio stream into the scanner audio
before it reaches WebRTC. Both the full-control listener (`3000`) and the
view/listen-only listener (`3001`) receive the same mixed result.

The remote stream URL stays on the server. Browsers receive only the configured
label, shown as `Additional audio: <label>` while the feature is enabled.

## Configuration

Add this inside `rcScanner.audio` in `server/config.json`:

```json
{
  "injectedStream": {
    "enabled": true,
    "url": "https://audio.example.net/live.mp3",
    "label": "Fireground relay",
    "volume": 0.35
  }
}
```

- `enabled`: must be `true` to start the mixer.
- `url`: HTTP(S) MPEG/MP3 stream URL decoded by FFmpeg.
- `label`: public text shown on both browser interfaces. Do not place the URL
  or credentials in this label.
- `volume`: injected stream gain from `0` (silent) to `1` (equal to scanner
  input); `0.35` is the default.

Restart the gateway after changing this configuration. The server logs
`Injected audio active` when FFmpeg produces the first mixed frame. While a
remote stream is connecting or reconnecting, scanner audio continues normally;
the mixer retries using the existing audio reconnect interval.

This is an audio mix, not a second selectable browser stream. It is therefore
included in WebRTC, MP3 fallback, WAV, and raw PCM output consistently.
