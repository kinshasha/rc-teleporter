# Cloudflare TURN

Low-latency WebRTC audio uses Cloudflare TURN when the scanner gateway is reached through a Cloudflare Tunnel.

1. In Cloudflare, create a TURN key named `rc-scanner`.
2. Create a Cloudflare API token restricted to `Calls Write` for the account that owns the TURN key.
3. Set these environment variables on the Mac before starting the gateway:

```sh
export CF_TURN_KEY_ID='your-turn-key-id'
export CF_TURN_API_TOKEN='your-turn-key-api-token'
npm start
```

The gateway exchanges the long-lived TURN key for one-hour ICE credentials. It never sends the TURN API token to a browser.

Protect the published scanner hostname with Cloudflare Access before enabling this endpoint. The browser receives short-lived relay credentials, so the Access policy is the control that prevents unauthorised relay use.

Without these variables, WebRTC uses direct LAN candidates. This keeps low-latency audio working locally while using the MP3 fallback for remote clients that cannot establish a direct peer connection.
