# RH96 to BCD436HP Input Bridge

## Purpose

Add a physical UBC-RH96 control head as an alternative input device for the
BCD436HP gateway. The first release is deliberately input-only: the existing
RC Teleporter server remains authoritative for scanner state and the existing
iOS/desktop display remains the only display that must be supported.

The bridge must allow the RH96 buttons and rotary controls to operate the
scanner locally and through the existing Teleporter web interface without
requiring RH96 display emulation.

## Scope

### In scope

- RH96 power and control-cable interface.
- RH96 button, rotary-left, rotary-right, and rotary-push events.
- Translation into Teleporter logical input events.
- BCD436HP control through the existing serial driver.
- Local operation with no network dependency.
- Optional network operation through the SBC-hosted Teleporter server.
- Serial capture and diagnostic logging.
- Safe rejection of unsupported RH96 actions.

### Out of scope for first release

- Driving the RH96 LCD.
- Reproducing BCD436HP display state on the RH96.
- Full RH96 menu compatibility.
- Programming or memory backup through the RH96.
- RH96 firmware modification.
- Audio through the RH96 cable.

## Evidence and References

The RH96 is documented as compatible with older Uniden models including the
BCD396XT and BCD996XT, but not the BCD436HP. The RadioReference community has
demonstrated an inline Arduino converter for the BCD996P2 that changes the
scanner model response from `BCD996P2` to `BCD996XT`; the published design uses
an RS232/TTL converter and works through the normal RH96 control cable.

- [RadioReference RH96-to-BCD996P2 converter](https://forums.radioreference.com/threads/rh96-on-a-bcd996p2-yep.381622/)
- [RadioReference converter USB variant and schematic discussion](https://forums.radioreference.com/threads/rh96-on-a-bcd996p2-yep.381622/page-2)
- [BCD996XT protocol specification](https://info.uniden.com/twiki/pub/UnidenMan4/BCD996XTFirmwareUpdate/BCD996XT_v1.04.00_Protocol.pdf)
- [BCD436HP/BCD536HP remote command specification](https://info.uniden.com/twiki/pub/UnidenMan4/BCD536HPFirmwareUpdate/BCDx36HP_RemoteCommand_Specification_V1_03.pdf)
- [RH96 owner documentation](https://www.uniden.info/download/ompdf/BC-RH96om.pdf)

The XT and BCD436HP protocols are both ASCII, comma-separated, carriage-return
terminated command protocols, but their key meanings and status responses are
not identical. The bridge therefore must translate into logical events rather
than blindly forwarding every RH96 command.

## Proposed Architecture

```text
UBC-RH96
  |
  | normal RH96 remote cable
  |
RH96 electrical interface
  |
Arduino Nano / RP2040, or SBC serial interface
  |
RH96 input decoder
  |
Teleporter logical input API
  |
Existing BCD436HP serial driver
  |
BCD436HP
```

For the preferred SBC build:

```text
Rock Pi E or Raspberry Pi
  |-- RH96 serial adapter
  |-- BCD436HP USB serial connection
  |-- Teleporter server
  |-- optional Tailscale / phone tethering
```

An Arduino or RP2040 may be used as a dedicated RH96 front-end if reliable
serial timing or level conversion is easier there. It should expose decoded
events to the SBC using a small private protocol rather than containing
BCD436HP-specific behavior.

## Electrical Design Requirements

- Use the proven RH96 control-cable arrangement as the starting point.
- Provide explicit RX, TX, and ground identification.
- Use level-safe RS232/TTL conversion; do not connect the RH96 cable directly
  to a 3.3 V GPIO pin until the signal levels are measured.
- Power the RH96 from its required DC supply independently of the SBC.
- Keep the RH96 firmware-update port out of the normal control path.
- Add a fuse or current-limited supply in a vehicle installation.
- Provide a physical disconnect for the RH96 during initial testing.

The BCD996P2 community converter is a useful hardware reference, but its exact
component wiring must be checked against the available cable and the chosen SBC
before reproduction.

## Logical Input Contract

The RH96 adapter should emit only these logical events initially:

```text
MENU
FUNC
HOLD
SCAN
AVOID
PRI
WX
GPS
REPLAY
SYSTEM
DEPARTMENT
CHANNEL
RANGE
BACKLIGHT
VOLUME_PUSH
SQUELCH_PUSH
DIGIT_0 through DIGIT_9
DOT
ENTER
ROTARY_LEFT
ROTARY_RIGHT
ROTARY_PUSH
```

Each event should include:

```json
{
  "event": "MENU",
  "action": "press",
  "timestamp": "2026-08-31T00:00:00.000Z",
  "source": "rh96"
}
```

Long presses and releases should be represented separately where the RH96
protocol exposes them. The bridge must not infer a long press merely from a
slow network response.

## Initial Mapping Policy

The first pass should map RH96 inputs to Teleporter logical controls, then let
the existing BCD436HP driver produce the correct BCD436HP serial command.

| RH96 control | Logical event | First-pass behavior |
| --- | --- | --- |
| MENU | `MENU` | Existing menu action |
| FUNC | `FUNC` | Existing function action |
| HOLD | `HOLD` | Existing hold action |
| SCAN/SEARCH | `SCAN` | Existing scan action |
| L/O | `AVOID` | Existing avoid action |
| 0-9 | `DIGIT_0` ... `DIGIT_9` | Direct numeric input |
| . / NO | `DOT` | Direct dot/no input |
| E / YES | `ENTER` | Direct enter/yes input |
| VFO left | `ROTARY_LEFT` | Existing VFO-down/left action |
| VFO right | `ROTARY_RIGHT` | Existing VFO-up/right action |
| VFO push | `ROTARY_PUSH` | Existing VFO-push action |
| RH96 special key | Configurable | Pass through only when BCD436HP supports it |

The RH96 `F`, `V`, and `Q` key codes must not be assumed to have identical
meaning on the BCD436HP. The BCD436HP command specification assigns different
functions to some of these codes, so the mapping must be explicit and tested
per action.

Unsupported controls should return a logged `unsupported` result and must not
send an invented serial command to the scanner.

## Protocol Handling

The RH96-facing adapter should:

1. Read complete carriage-return-terminated messages.
2. Preserve raw bytes in a capture log during development.
3. Parse the command name and fields without modifying unknown messages.
4. Convert recognized commands into logical events.
5. Queue events through one ordered Teleporter command scheduler.
6. Wait for the BCD436HP command response before sending the next command.
7. Return success, rejection, or timeout to the adapter log.

The queue is important because the XT specification requires the controller to
wait for a scanner response before issuing another command.

## Concurrency and Ownership

The browser and RH96 are two input sources for one scanner session.

- The server owns scanner state.
- All physical and browser commands enter the same serialized command queue.
- Commands are tagged with `source: rh96`, `source: web`, or `source: system`.
- A disconnected RH96 must not block browser control.
- A browser command must not be duplicated because of an RH96 acknowledgement.
- Reconnect must reset the RH96 parser without resetting scanner state.

## Configuration

Proposed optional configuration:

```json
{
  "rh96": {
    "enabled": false,
    "transport": "sbc-serial",
    "port": "auto",
    "baudRate": 115200,
    "inputOnly": true,
    "logRaw": false
  }
}
```

`inputOnly` must remain true for the first implementation. Any future RH96 LCD
support should be a separate capability flag.

## Development Milestones

### Milestone 1: hardware and capture

- Confirm RH96 power and cable wiring.
- Capture startup and individual button actions.
- Determine baud rate, framing, direction, and timing.
- Confirm the RH96 produces ordinary serial command traffic.

### Milestone 2: standalone input decoder

- Decode buttons and rotary events without connecting the BCD436HP.
- Print normalized logical events.
- Verify press, release, repeat, and long-press behavior.

### Milestone 3: Teleporter integration

- Add the RH96 input source beside browser input.
- Route normalized events into the existing command scheduler.
- Add source-tagged logging.
- Keep the existing iOS display unchanged.

### Milestone 4: scanner validation

- Test menu, scan, hold, avoid, digits, dot, enter, rotary actions, and VFO
  push.
- Confirm scanner responses and browser display updates.
- Test simultaneous browser and RH96 use.
- Test disconnect and reconnect without restarting Teleporter.

## Acceptance Criteria

- RH96 can control the BCD436HP without RH96 LCD emulation.
- Existing 3000 and 3001 pages continue to work unchanged.
- iOS display remains the authoritative scanner display.
- At least menu, scan, hold, avoid, digits, dot, enter, rotary, and VFO push
  work reliably.
- Unsupported RH96 actions are logged and safely ignored.
- No command is sent while a previous scanner command is awaiting a response.
- RH96 disconnect/reconnect does not wedge browser control.
- Raw protocol logging can be enabled without exposing credentials or audio
  stream URLs.

## Risks

- RH96 cable voltage levels may not be GPIO-safe.
- Some RH96 functions may be generated locally and never appear as simple
  commands.
- BCD436HP key semantics differ from XT semantics.
- The BCD436HP may reject commands that are valid on XT scanners.
- Rapid rotary input may require rate limiting or event coalescing.
- A future RH96 display implementation would require a separate status
  translation layer and should not be mixed into this first milestone.

## Recommendation

Build the first prototype as an SBC-hosted RH96 input adapter, using the
RadioReference Arduino converter as the electrical and protocol reference. Keep
the adapter unaware of BCD436HP command details wherever possible. Emit logical
Teleporter events and reuse the existing BCD436HP driver and iOS display path.

This gives the shortest route to the desired outcome: physical RH96 controls
working against the already-successful mobile interface, without taking on the
much larger problem of making the RH96 LCD understand BCD436HP status data.
