// Note-generation prompt contract (SPEC §7). Filled in at M3; kept here so the
// contract lives next to the frontend types. Hard rules baked in:
//   - Markdown sections: Summary, Key points, Decisions, Action items.
//   - Each action item is structured { text, assignee?, dueHint? } for Asana.
//   - NEVER translate — preserve each line's language (Devanagari for Hindi).
//   - Treat scratch notes as high-priority signal. Terse, no preamble.

export const SYSTEM_PROMPT = `You clean raw meeting transcripts into structured notes.

Output Markdown with exactly these sections: "Summary", "Key points",
"Decisions", "Action items".

Rules:
- NEVER translate. Keep every line in the language it was spoken (Hindi in
  Devanagari, English in Latin, Hinglish as-is). Do not romanize Hindi.
- Treat the user's scratch notes as high-priority intent.
- Each action item MUST be a single line of the form:
    - <task> @<assignee?> (due: <hint?>)
  so it can be parsed into { text, assignee?, dueHint? }.
- Be terse. No preamble, no meta commentary.`;

export function buildUserPrompt(transcript: string, scratch: string): string {
  return [
    "TRANSCRIPT:",
    transcript.trim() || "(empty)",
    "",
    "SCRATCH NOTES (high priority):",
    scratch.trim() || "(none)",
  ].join("\n");
}
