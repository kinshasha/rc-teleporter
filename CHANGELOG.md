# Changelog

## RC Teleporter (this fork)

Working tree is https://github.com/kinshasha/rc-teleporter. `main` is the Mac BCD436HP Uniden gateway. The Icom PCR1000 prototype is on the `pcr1000` branch, not here.

Package version remains 0.10.5 (same as the last upstream rc-scanner label) until the next real feature bump.

Fork changes versus archived [chuot/rc-scanner](https://github.com/chuot/rc-scanner):

- Renamed the project to RC Teleporter.
- Parked PCR1000 on `pcr1000` and stripped it from `main`.
- macOS serial auto-detect (`/dev/cu.usbserial*`, `/dev/cu.usbmodem*`, plus Linux `ttyUSB` / `ttyACM`) when `com.port` is `auto`.
- Two listeners in one process: port 3000 full control, port 3001 view-only (enforced on the server).
- WebRTC audio with Cloudflare TURN, plus MP3 fallback.
- Audio input selection (PortAudio device, not always device 0).
- Optional injected MPEG mix before WebRTC.
- iOS Safari screen-wake fallback (0.10.5).
- BCD436HP responsive display fixes and backup/restore groundwork (0.10.4).
- SBC rebuild notes in `BACKEND_REBUILD_SPEC.md`.

---

## Upstream rc-scanner history

The notes below are from the original rc-scanner project.

# Version 0.10

- Add compatibility to model Uniden BCD386T.
- Configuration is now done through a config.json file. Make sure to delete your `.env` file after running the server at least once.

_v0.10.1_

- Client now on angular 12

_v0.10.2_

- Node modules updated for security fixes.

_v0.10.3_

- Improvements to audio handling on the server side.
- Node modules updated for security fixes.

_v0.10.4_

- Local scanner gateway release with audio input selection, backup and restore groundwork, and responsive BCD436HP display fixes.

_v0.10.5_

- Add an iOS Safari inline-video screen wake fallback with an on/off control.

# Version 0.9

- First public beta version.
