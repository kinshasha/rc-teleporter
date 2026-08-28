# RC Teleporter

RC Teleporter is a progressive web interface for remotely controlling a Uniden scanner and receiving its audio, on desktop and mobile.

Issues: https://github.com/kinshasha/rc-teleporter/issues


## What changed from original rc-scanner

This tree started as [chuot/rc-scanner](https://github.com/chuot/rc-scanner). Chuot archived that repository on July 31, 2026. RC Teleporter respects it as the upstream lineage, but this fork is a fresh continuation that recreates many concepts from scratch rather than tracking an active upstream. `main` is the Mac BCD436HP gateway that is actually in use. The Icom PCR1000 prototype lives on the `pcr1000` branch, not here.

Working differences versus the original project:

* **macOS serial auto-detect.** USB scanners show up as `/dev/cu.usbserial*` or `/dev/cu.usbmodem*`. Leave `com.port` as `auto` (or `RC_COM_PORT=auto`) and the gateway picks the first matching port, including Linux `ttyUSB` / `ttyACM`.
* **Two listeners in one process.** Port `3000` is full control. Port `3001` is display plus audio only. View-only command rejection is enforced on the server, not just by hiding buttons. See `docs/view-only.md`.
* **WebRTC audio with Cloudflare TURN.** Low-latency Opus to the browser. TURN credentials are minted on the server and never include the API token. Without TURN, LAN WebRTC still works and remote clients can fall back to MP3. See `docs/cloudflare-turn.md`.
* **Audio input selection.** Choose the PortAudio capture device instead of hoping device `0` is the scanner.
* **Optional injected audio.** Mix one server-side MPEG stream into the scanner audio before WebRTC (and the fallbacks). Browsers only see a label, not the stream URL. See `docs/injected-audio.md`.
* **iOS Safari screen-wake.** Inline-video fallback with an on/off control so the display does not sleep mid-call.
* **BCD436HP display.** Responsive layout fixes for the 436 faceplate in the browser.
* **Backup / restore groundwork.** Scope for snapshotting live serial state (not a full memory dump). See `docs/backup-restore-scope.md`.
* **BCD436HP command backlog.** Next serial commands worth wiring into the UI. See `docs/serial-command-backlog.md`.
* **SBC rebuild notes.** `BACKEND_REBUILD_SPEC.md` describes replacing the Node backend later without rewriting the client.

## Supported models

At the moment, *RC Teleporter* only works with a limited number of radio scanners.

Supported models:

* Uniden BCD436HP (stable)
* Uniden BCD396T (stable)

Other scanner models can be added on request as long as I can get one. Any lease or donation of such a scanner model is welcome.

## Supported platforms

Since *RC Teleporter* uses [Node SerialPort](https://serialport.io/) and [Naudiodon2](https://github.com/csukuangfj/naudiodon2), which are both multiplatform, it should run on other hosts without much trouble. Please open an issue with what you tried.

On macOS, USB-connected scanners usually show up as `/dev/cu.usbserial*` or `/dev/cu.usbmodem*` devices. Leave `com.port` set to `auto` in `server/config.json`, or set `RC_COM_PORT=auto`, and RC Teleporter will pick the first matching serial device it finds.

## Features

* Remote control your radio scanner with very low latency (you can even get audio feedback)

* Care has been taken to minimize data transfer to the client application

  * Screen updates suspended while application isn't focused
  * Audio stream suspended if no audio output on the scanner (squelch adjustable)

## Screenshot (BCD436HP)

![BCD436HP](./docs/bcd436hp/rc_scanner_bcd436hp.png)

## Quick start

It is fairly easy to have *RC Teleporter* up and running.

Ensure that your operating system is fully updated and that the prerequisites are installed:

* [Git](https://git-scm.com/downloads)
* [Node.js LTS or higher](https://nodejs.org/en/download/)
* [npm](https://www.npmjs.com/get-npm)
* [python](https://www.python.org/downloads/)
* openssl

Then clone the *RC Teleporter* code and run it:

```bash
$ git clone https://github.com/kinshasha/rc-teleporter.git
Cloning into 'rc-teleporter'...
remote: Enumerating objects: 3821, done.
remote: Counting objects: 100% (3821/3821), done.
remote: Compressing objects: 100% (2975/2975), done.
Receiving objects: 100% (3821/3821), 6.87 MiB | 10.65 MiB/s, done.
remote: Total 3821 (delta 1693), reused 2156 (delta 662)
Resolving deltas: 100% (1693/1693), done.

$ cd rc-teleporter

$ Installing node modules... done
Building client app... done
Server is running at http://0.0.0.0:3000
Connected to /dev/ttyUSB0
```

Note that the first time you start *RC Teleporter*, it will be longer to do so as it has to install required node modules and build the progressive web app.

Root-level `npm start` records launcher and server exits in `server/npm-start.log`
for troubleshooting. The file is local-only and ignored by Git.

A default configuration file `server/.env` will be created.

At this point, you should review the configuration file to ensure that it is conform to your setup.

When done, re-run again `node run.js` to launch the application.
