# Optional injected audio

RC Scanner can mix one server-side MPEG audio stream into the scanner audio
before it reaches WebRTC. Both the full-control listener (`3000`) and the
view/listen-only listener (`3001`) receive the same mixed result.

The remote stream URL stays on the server. Browsers receive only the configured
label, or the live Icecast `StreamTitle` when title metadata is enabled.

## Configuration

Add this inside `rcScanner.audio` in `server/config.json`:

```json
{
  "injectedStream": {
    "enabled": true,
    "url": "https://audio.example.net/live.mp3",
    "label": "Fireground relay",
    "useStreamTitle": false,
    "volume": 0.35
  }
}
```

For multiple possible feeds, keep the entries in `server/streams.json`:

```json
[
  {
    "number": 1,
    "url": "https://audio.example.net/live.mp3",
    "label": "Fireground relay"
  },
  {
    "number": 2,
    "url": "https://audio.example.net/backup.mp3",
    "label": "Backup relay"
  }
]
```

Then select an entry from `server/config.json`:

```json
{
  "injectedStream": {
    "enabled": true,
    "useStreamList": true,
    "streamNumber": 1,
    "useStreamTitle": false,
    "label": "Fallback label"
  }
}
```

When `useStreamList` is `true`, the numbered entry supplies the URL and label.
When it is `false`, the URL and label in `config.json` are used as before. A
missing numbered entry disables the injected stream rather than silently using
an unintended feed.

- `enabled`: must be `true` to start the mixer.
- `url`: HTTP(S) MPEG/MP3 stream URL decoded by FFmpeg.
- `label`: public text shown on both browser interfaces. Do not place the URL
  or credentials in this label.
- `useStreamTitle`: when `true`, use the live Icecast `StreamTitle` metadata
  when available; `label` remains the fallback until a title is received.
- `useStreamList`: select the URL and label from `server/streams.json`.
- `streamNumber`: numbered `streams.json` entry to use when `useStreamList` is
  `true`.
- `volume`: injected stream gain from `0` (silent) to `1` (equal to scanner
  input); `0.35` is the default.

Restart the gateway after changing this configuration. The server logs
`Injected audio active` when FFmpeg produces the first mixed frame. While a
remote stream is connecting or reconnecting, scanner audio continues normally;
the mixer retries using the existing audio reconnect interval.

When stream-title mode is enabled, the metadata connection remains open for up
to one minute to allow delayed `StreamTitle` blocks to arrive. It closes sooner
when a title is captured, and the audio connection is not affected.

This is an audio mix, not a second selectable browser stream. It is therefore
included in WebRTC, MP3 fallback, WAV, and raw PCM output consistently.
