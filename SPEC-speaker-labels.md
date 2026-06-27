# SPEC — Speaker Labels & Attendee-Grounded Naming

Status: **planned / not built**. This is a self-contained implementation spec so the
feature can be picked up later without re-deriving the design. Written 2026-06-27.

## Goal
Make Glyph attribute *who said what* and *who owns each action item*, using real
names. Two independent mechanisms that compose:

1. **Attendee-roster grounding** (cheap, prompt-side) — feed the meeting's known
   participants (from the linked calendar event) into note generation so owners /
   speaker names come from a real list instead of being guessed. Works for **online
   and in-person** meetings, as long as the meeting is linked to a calendar event.
2. **"You vs Others" channel split** (acoustic, local) — stop mixing mic + system
   audio; transcribe each channel separately so segments are labelled You / Others.
   Works for **online calls** only (mic vs call audio).

They stack: the channel split says *which side* spoke; the roster lets the LLM put
*real names* on it. Tier 2 (per-person diarization) is a later extension noted at the
end.

Primary use case (per product owner): **mostly online calls.** So Mechanism 1 +
Mechanism 2 deliver most of the value. Build Mechanism 1 first — it is the cheapest
and also fixes the existing "action items have no assignee" complaint.

---

## Mechanism 1 — Attendee-roster grounding (do this first)

### Why
Today `generate_notes(transcript, scratch, model, depth)` gets no participant
context, so owner extraction depends on names happening to appear in the (speaker-less)
transcript. Supplying the roster lets the model assign owners reliably and spell names
correctly, even when the transcript is messy.

### What already exists
- `calendar::Event { attendees: Vec<String>, attendee_emails: Vec<String>, account_email }`
  in [src-tauri/src/calendar/mod.rs](src-tauri/src/calendar/mod.rs).
- Command `calendar_attendees(title) -> Vec<String>` (emails), matched by title —
  see [src/components/EmailModal.tsx](src/components/EmailModal.tsx) usage.
- `CalendarEvent { attendees, attendeeEmails }` in [src/lib/ipc.ts](src/lib/ipc.ts).
- Connected-account email is known (`first_account_email`) → that's **"You"**.

### Changes
1. **Resolve a roster at generation time.** When a note is generated, gather:
   - the user's own display name + email (the connected Google account / app profile),
   - the linked event's `attendees` (display names) and `attendee_emails`
     (derive a name from the local-part when no display name, e.g.
     `vineet.shah@x.com` → "Vineet").
   Dedupe into a `participants: Vec<{ name, email, isSelf }>`.
   - If the note isn't linked to a calendar event, fall back to a best-effort
     title match (reuse the `calendar_attendees` matching) or skip grounding.

2. **Extend the IPC + Rust signature:**
   `generate_notes(transcript, scratch, model, depth, participants?)`.
   - TS: add optional `participants` to `generateNotes` in `ipc.ts`.
   - Rust: thread `participants` into `notes::generate_notes`.

3. **Prompt injection** (in [src-tauri/src/notes/mod.rs](src-tauri/src/notes/mod.rs)).
   When participants are present, prepend to the user message (NOT the system prompt):
   ```
   KNOWN PARTICIPANTS (assign owners and speaker names ONLY from this list,
   matching by first name; "You" = <self name>):
   - Khush (self)
   - Malayka
   - Vineet
   ```
   And tighten the action_items instruction: "Assign `assignee` to the participant
   who owns the task, chosen from KNOWN PARTICIPANTS. Use their exact name as given.
   Never invent a name not on the list."

4. **Faithfulness guard.** Keep "omit owner if genuinely unclear" — grounding should
   raise precision, not force a guess. Names not on the roster must not be emitted.

### Effort
~2–3h. Pure prompt + plumbing; no audio, no migration. Existing notes benefit on
**Regenerate**.

### Caveats
- Needs the meeting linked to a calendar event with attendees; manual ad-hoc
  recordings get no roster (degrade gracefully).
- Google attendee lists are emails; display names aren't always present → local-part
  heuristic for the name.

---

## Mechanism 2 — "You vs Others" channel split (online calls)

### The key fact
The sidecar already captures mic and system audio as **two separate queues** and only
merges them at [Mixer.swift](sidecar/audiocap/Sources/audiocap/Mixer.swift) ~L120:
```swift
let s = mic[i] + sys[i]   // mic = you, sys = everyone else — merged here
```
Keep them apart end-to-end → speaker labels with **no ML, fully local**.

### Pipeline today
`Mixer` (mono mix) → `FrameWriter` streams 16 kHz PCM to stdout →
[src-tauri/src/audio/mod.rs](src-tauri/src/audio/mod.rs) writes one mono WAV → on stop,
Whisper batch-transcribes → `StoredSegment[]` → DB → Transcript UI + notes.

### Changes (5 touch points)
1. **Sidecar — emit stereo instead of mono.** In `Mixer.pull()`, interleave
   **L = mic, R = system** into a stereo Int16 frame; keep the summed value only to
   compute the RMS level meter. `FrameWriter` streams 2-channel; the `--wav` validation
   path may stay mono. (`Mixer.swift`, `FrameWriter.swift`, `main.swift`.)

2. **Rust — stereo WAV + dual transcription.** `audio/wav.rs` writes a 2-channel WAV.
   On stop: de-interleave into two mono tracks, run Whisper **twice** (once per channel),
   tag mic segments `speaker = "You"` (or the self name from Mechanism 1) and system
   segments `speaker = "Others"`. **Merge by `startMs`** into one ordered transcript.

3. **Data model — add `speaker`.** `StoredSegment` gains `speaker: Option<String>`
   (Rust struct + TS `StoredSegment` in `ipc.ts`). SQLite migration: add nullable
   `speaker` column to the segments table (old recordings unaffected).

4. **Transcript UI.** [src/components/Transcript.tsx](src/components/Transcript.tsx):
   render a speaker chip per segment (You / Others) using the existing `avatarFor`
   colors; group consecutive same-speaker lines.

5. **Notes generation.** Feed the speaker-prefixed transcript ("You: …" / "Others: …")
   to the summarizer. Combined with Mechanism 1's roster, the model attributes your
   tasks to you and maps remote speakers to attendee names with much higher accuracy.

### Effort
~1–1.5 days: ~2h sidecar (Swift), ~3–4h Rust (stereo WAV + dual transcribe + merge),
~1h migration + types, ~2h Transcript UI, ~1h notes wiring + testing.

### Caveats
- **Headphones matter.** Without them the mic also picks up the call audio (bleed/echo),
  so "Others" voices leak onto the "You" channel. Clean with headphones — add a one-line
  UI tip. Optionally gate the feature on the recording source being an online call
  (system audio present).
- **"Others" is a single bucket** — does not separate multiple remote people (that's
  Tier 2).
- **~2× transcription time** (two Whisper passes); still sub-minute for a 20-min meeting
  on Metal.
- **In-person (mic-only) gets nothing** from this — rely on Mechanism 1 there.

---

## Tier 2 — Per-person diarization (future, optional)
Replace the single "Others" channel with true speaker separation:
- Run a local diarization model on the system-audio channel — e.g. **sherpa-onnx**
  segmentation + speaker-embedding clustering (small ONNX models bundled with the app,
  callable from Rust). Output: `Speaker 1 / 2 / 3` turns with timestamps.
- **Name the clusters** by either (a) a lightweight "label this voice" UI, or (b) LLM
  inference from content + the attendee roster ("thanks, Vineet" → cluster = Vineet).
- Effort: several days; new model assets, alignment, clustering tuning. Only pursue if
  in-person multi-speaker naming becomes a real need.

## Suggested build order
1. **Mechanism 1** (roster grounding) — biggest accuracy gain per hour; ship standalone.
2. **Mechanism 2** (You vs Others) — for the primary online-call case.
3. **Tier 2** — only if per-remote-person naming is needed.

## Acceptance criteria
- M1: an online or in-person meeting linked to a calendar event produces action items
  whose `assignee` values are real attendee names from the roster, and the PDF's
  "who does what" grouping shows those people (not all "Unassigned").
- M2: an online-call recording produces a transcript where mic-only speech is labelled
  "You" and call audio is labelled "Others", interleaved in time order, visible in the
  Transcript tab and reflected in note attribution.
