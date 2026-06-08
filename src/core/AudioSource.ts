// AudioSource — emits 16 kHz mono PCM (+ RMS level). Always the native Swift
// sidecar (`audiocap`). Built & wired in M1, the make-or-break spike.

export type RecordMode = "manual" | "calendar";

export interface AudioLevel {
  /** RMS amplitude 0..1 for the live recording indicator. */
  rms: number;
}

export interface AudioSource {
  /** Spawn the sidecar and begin streaming PCM. */
  start(mode: RecordMode): Promise<void>;
  /** Stop capture and tear down the sidecar. */
  stop(): Promise<void>;
  /** Subscribe to live level updates; returns an unsubscribe fn. */
  onLevel(cb: (level: AudioLevel) => void): () => void;
}
