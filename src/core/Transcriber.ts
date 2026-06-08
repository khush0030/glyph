// Transcriber — PCM → segments. Cloud: ElevenLabs Scribe v2 Realtime (M2).
// Local: Whisper (Private Mode, M8). Always language = multi; never translate.

export interface Segment {
  text: string;
  /** BCP-47-ish language tag from the STT, e.g. "hi", "en". */
  lang: string;
  startMs: number;
  endMs: number;
  /** False for partial (interim) hypotheses, true once finalized. */
  isFinal: boolean;
}

export interface Transcriber {
  /** Open the STT stream (WS for Scribe). */
  open(): Promise<void>;
  /** Push a frame of 16 kHz mono Int16 PCM. */
  push(pcm: Int16Array): void;
  /** Subscribe to partial + final segments; returns an unsubscribe fn. */
  onSegment(cb: (seg: Segment) => void): () => void;
  /** Flush and close the stream. */
  close(): Promise<void>;
}
