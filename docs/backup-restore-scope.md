# Backup / Restore Scope for the Realtime Scanner Interface

## Goal

Define a practical backup and restore feature for the live web interface that works with the current serial-driven scanner control flow.

The key constraint is simple: the existing app is a realtime controller, not a full scanner programming suite. That means the safest scope is to capture and replay the state that is already visible over the serial session, then decide later whether deeper programming export/import is worth the protocol work.

## What “Backup” Should Mean

For this project, backup should mean one of three things:

1. Capture the live operating state of the scanner.
2. Save that state to a file or browser download.
3. Restore the scanner back to that operating state later.

That is different from a full device image.

## What Is Probably Feasible

### Live session snapshot

This is the most realistic first step.

Capture the state that the scanner already exposes during normal operation, such as:

- Current screen text
- Active model
- Current mode or channel
- System / department / group identifiers when visible
- Squelch / volume style runtime values if they are exposed
- Lockout / hold / scan state if the protocol reports it
- Any other fields already present in the realtime status stream

### Restore of live state

If the protocol exposes enough control commands, the app can replay a subset of the captured state.

That could include:

- Return to a known system or channel
- Restore scan / hold state
- Restore selected runtime settings that are exposed by command
- Re-establish the last known operating screen or mode

This is a “best effort” restore, not a magic full clone.

## What Is Probably Not Feasible From the Realtime Stream Alone

These are the things that should be treated as out of scope unless we later add a separate programming/file-format path:

- Full favorites list backup
- Complete scanner memory dump
- Entire SD card or database clone
- Sentinel-style library export/import
- Restoration of settings that are never exposed by the serial protocol

If the goal is “put the scanner back exactly as it was after a reset,” the realtime interface alone probably will not be enough.

## Recommended Scope Split

### Phase 1: Snapshot Backup

Build a recorder that listens to the serial status stream and saves normalized state as JSON.

Expected output:

- Timestamped snapshots
- Human-readable JSON export
- A small amount of metadata about model, firmware, and session

### Phase 2: Limited Restore

Add a restore workflow that replays only commands that are known to be safe and supported.

Expected behavior:

- Restore only the fields we can confidently control
- Skip unsupported fields instead of failing the whole restore
- Show partial restore results to the user

### Phase 3: Optional Deeper Programming Support

If the scanner protocol or file formats allow it, add a separate import/export path for programming data.

That would be a bigger project and should be treated as its own workstream.

## Suggested Technical Shape

### Data capture layer

Normalize serial events into a structured state object instead of only rendering the screen.

### Backup format

Store backups as JSON with:

- Device model
- Timestamp
- Firmware or protocol version if available
- Current state object
- Raw serial transcript optionally, if the user wants an audit trail

### Restore engine

Replay commands from the structured state.

Use a command map so that:

- Known fields can be restored
- Unknown fields are skipped
- Dangerous writes are blocked unless explicitly enabled

## Risks

- The protocol may not expose enough state for a satisfying restore.
- Some fields may be readable but not writable.
- A restore workflow that blindly replays serial data could put the scanner into a bad state.
- Different scanner models may need separate serializers and restore maps.

## Acceptance Criteria

The feature is ready for v1 when:

- A user can download a backup snapshot from the web UI.
- A user can see what the backup contains.
- A user can restore the scanner to a prior live state.
- Unsupported fields are clearly reported.
- The backup format is stable and human-readable.

## Recommendation

Start with live-state backup and partial restore.

Do not promise a full programming backup until we confirm a separate data path for scanner memory or file-based programming.
