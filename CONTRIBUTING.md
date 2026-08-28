# Contributing to RC Teleporter

This is the working BCD436HP gateway at https://github.com/kinshasha/rc-teleporter

`main` is the Mac scanner box. The Icom PCR1000 prototype is on the `pcr1000` branch.

## How to help

Open an issue on this repo first, then a pull request against `main` (or `pcr1000` if the change is PCR-only).

Do not send support questions to the archived chuot/rc-scanner project or the old Gitter lobby.

## Bugs

Include:

* scanner model and firmware if you know it
* host OS (this gateway currently runs on macOS)
* `server/config.json` with secrets removed
* what you did, what you expected, what happened

## Features

Describe the use case. Serial-protocol ideas belong in `docs/serial-command-backlog.md` if they are BCD436HP remote commands.

## License

Original rc-scanner is GPL-3.0. Keep new files under the same license. See `LICENSE` and `COPYRIGHT`.
