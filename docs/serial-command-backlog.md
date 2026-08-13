# Serial Command Backlog for BCD436HP / BCDx36HP

This backlog breaks the Uniden remote-command surface into work we can realistically add to the live web interface.

The app already does one thing well: it watches the realtime status stream and sends keypad-style commands back to the scanner. The items below build on that pattern.

## Legend

- `Easy` means the current protocol flow already suggests a clean implementation path.
- `Medium` means the command probably works, but the UI, state handling, or return format needs some care.
- `Probably not worth it` means the command exists in Uniden documentation, but it does not fit the realtime control model cleanly.

## Easy

### `MDL` Get model info

Why it matters:

- Useful for confirming the connected scanner model without relying only on config.
- Good fit for startup diagnostics and UI display.

What the UI could show:

- Model name
- Firmware context if paired with `VER`

Risk:

- Low

### `VER` Get firmware version

Why it matters:

- Lets the web UI show the scanner firmware version.
- Useful for support and compatibility checks.

What the UI could show:

- Main firmware version
- Possibly sub-version details if returned by the scanner

Risk:

- Low

### `PSI` Scanner info

Why it matters:

- Likely a good source for richer device status.
- Useful for an info panel or debug drawer.

What the UI could show:

- Serial number / identifier fields if exposed
- Device-specific state summary

Risk:

- Low to medium, depending on the exact response shape

### `NXT` and `PRV`

Why it matters:

- Matches the current remote-control model.
- Good for moving through search/hold contexts or UI navigation.

What the UI could show:

- Next / previous buttons
- Keyboard shortcuts

Risk:

- Low

### `JNT` Jump number tag

Why it matters:

- Fits the existing “jump” style of realtime control.
- Useful for power users who already know the jump target.

What the UI could show:

- Jump-to dialog
- Recent jump history

Risk:

- Low to medium

## Medium

### `QSH` Quick search hold

Why it matters:

- Useful if the user wants a one-tap way to enter quick-search behavior.
- Fits the app’s existing control-first design.

What the UI could show:

- Dedicated quick-search button
- Status indicator for hold/search mode

Risk:

- Medium, because mode transitions can be scanner-state-sensitive

### `FQK` Favorites list quick keys

Why it matters:

- Lets the UI read and maybe toggle favorites list activation.
- Very relevant if we want the web app to feel like a real control surface.

What the UI could show:

- Quick-key matrix
- Enabled / disabled status for favorites lists

Risk:

- Medium, because the response format and write semantics need to be confirmed carefully

### `SQK` System quick keys

Why it matters:

- Useful for controlling which systems are active while scanning.
- Strong candidate for a status strip or quick toggle panel.

What the UI could show:

- System quick-key grid
- Active / inactive indicators

Risk:

- Medium

### `DQK` Department quick keys

Why it matters:

- Same value as `SQK`, but one layer deeper.
- Good for advanced users who want fast control over department-level scanning.

What the UI could show:

- Department quick-key grid
- Bulk enable / disable controls

Risk:

- Medium

### `EPG` and other firmware-adjacent remote behavior

Why it matters:

- There are firmware references to `EPG` and related remote behavior.
- Could improve compatibility with existing scanner workflows.

What the UI could show:

- Advanced actions menu

Risk:

- Medium to high, because the command surface here is less obviously stable

## Probably Not Worth It

### Full programming-mode editing

Why not:

- The command spec exists, but once we cross into large-scale editing, we are reimplementing a programming tool.
- That overlaps heavily with Sentinel-style file/database workflows.

Risk:

- High implementation cost
- High chance of partial coverage

### Full favorites / systems / departments backup

Why not:

- The live command surface is not the same thing as a full configuration export.
- A serial snapshot can capture state, but not necessarily everything needed for a perfect restore.

Risk:

- High user expectation risk

### SD-card or database imaging from serial

Why not:

- This is a different class of problem.
- It is much closer to file transfer or mass-storage access than to live control.

Risk:

- Very high

## Recommended Order

### Phase 1

- `MDL`
- `VER`
- `PSI`
- Better control/status header in the UI

### Phase 2

- `NXT`
- `PRV`
- `JNT`
- `QSH`

### Phase 3

- `FQK`
- `SQK`
- `DQK`

### Phase 4

- Reassess whether any programming-mode commands are worth the complexity
- Decide whether to stop at live control or branch into file-based programming support

## Suggested Acceptance Criteria

- The web UI can show model and firmware version.
- The web UI can expose search/navigation controls beyond the keypad.
- Quick-key state can be read and displayed.
- Unsupported commands fail gracefully and do not break the scanner session.
- Any write action is clearly labeled as live control, not full programming.

## Recommendation

Start with the read-only commands first.

That gives immediate value, proves the response formats, and keeps the app from drifting into a half-built programming suite before we know the protocol boundaries.
