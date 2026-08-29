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

Then enable list mode in `server/config.json`:

```json
{
    "injectedStream": {
    "enabled": true,
    "useStreamList": true,
    "useStreamTitle": false,
    "label": "Fallback label"
  }
}
```

When `useStreamList` is `true`, the client selector starts at stream `1` and
the numbered entry supplies the URL and label. The selected number is runtime
state and is not written into `config.json`. When it is `false`, the single URL
and label in `config.json` are used as before. A missing numbered entry disables
the injected stream rather than silently using an unintended feed.

### Broadcastify credentials

Broadcastify entries use the committed, credential-free template:

```text
https://USERNAME:PASSWORD@audio.broadcastify.com/STREAMID.mp3
```

Copy `server/broadcastify.conf.example` to `server/broadcastify.conf` and set:

```text
username=your_broadcastify_username
password=your_broadcastify_password
```

The `.conf` file is ignored by Git. The server substitutes and URL-encodes the
values in memory only; credentials are not written to `config.json`, sent to
the browser, or included in logs. If the file is absent or incomplete,
Broadcastify entries remain unavailable but other stream entries continue to
work.

- `enabled`: must be `true` to start the mixer.
- `url`: HTTP(S) MPEG/MP3 stream URL decoded by FFmpeg.
- `label`: public text shown on both browser interfaces. Do not place the URL
  or credentials in this label.
- `useStreamTitle`: when `true`, use the live Icecast `StreamTitle` metadata
  when available; `label` remains the fallback until a title is received.
- `useStreamList`: select the URL and label from `server/streams.json`.
- `volume`: injected stream gain from `0` (silent) to `1` (equal to scanner
  input); `0.35` is the default.

Restart the gateway after changing this configuration. The server logs
`Injected audio active` when FFmpeg produces the first mixed frame. While a
remote stream is connecting or reconnecting, scanner audio continues normally;
the mixer retries using the existing audio reconnect interval.

When stream-title mode is enabled, the metadata connection remains open for the
life of the selected injected stream, allowing later `StreamTitle` changes to
update the browser label. It is closed when the stream is disabled, replaced,
or the server shuts down; if the metadata connection ends unexpectedly, the
server reconnects it using the normal audio reconnect interval. The audio
connection is separate.

This is an audio mix, not a second selectable browser stream. It is therefore
included in WebRTC, MP3 fallback, WAV, and raw PCM output consistently.
