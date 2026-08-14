# View-only listener

RC Scanner runs one Node process and listens on two HTTP ports by default:

- `3000`: full scanner control and gateway administration.
- `3001`: read-only scanner display with WebRTC audio playback.

The view-only listener shares the same USB serial connection, audio device, and Cloudflare TURN configuration as the full control listener. It does not start a second scanner gateway process.

## View-only routes

Port `3001` provides only the viewer application, model configuration, the read-only `/display` WebSocket, and WebRTC audio endpoints.

It does not provide the control WebSocket, scanner keypad commands, audio input selection, raw MP3/WAV streams, or test audio endpoint. After the initial display tap enables audio, later display taps send only the VFO-push command for scanner beep feedback.

The disabled keypad overlay is only a visual indicator, not the security boundary. The viewer server accepts one text command only (`KEY,^,P` for VFO push), rejects binary and all other commands, and rate-limits VFO push requests to one every 350 ms. Removing browser CSS or changing client-side JavaScript cannot grant configuration or keypad control. Protect the view hostname with Cloudflare Access as well, to control who can view or listen.

## Configuration

The listener is enabled by default. Configure it in `server/config.json` if needed:

```json
{
  "nodejs": {
    "viewer": {
      "enabled": true,
      "host": "0.0.0.0",
      "port": 3001
    }
  }
}
```

Environment overrides are `NODE_VIEWER_ENABLED` and `NODE_VIEWER_PORT`.

## Cloudflare Tunnel

Publish separate hostnames to keep the two interfaces separate:

```yaml
ingress:
  - hostname: scan.example.com
    service: http://mac-lan-address:3001
  - hostname: scan-admin.example.com
    service: http://mac-lan-address:3000
```

Protect both hostnames with Cloudflare Access. Give the view hostname a listening-only policy and reserve the admin hostname for scanner operators.
