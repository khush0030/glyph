import Foundation

/// Streams ~100 ms PCM frames to stdout as newline-terminated JSON lines:
/// `{"kind":"pcm","b64":"<base64 of Int16 LE samples>"}`. Text-only output
/// keeps stdout safe across the IPC boundary (no raw binary), and the base64 is
/// exactly what the Scribe v2 WebSocket wants (`audio_base_64`), so Rust
/// forwards it with minimal work. Writes are serialized.
final class FrameWriter {
    private let handle = FileHandle.standardOutput
    private let lock = NSLock()

    func write(_ samples: [Int16]) {
        lock.lock(); defer { lock.unlock() }
        var copy = samples
        let raw = copy.withUnsafeBytes { Data($0) }
        let b64 = raw.base64EncodedString()
        let line = "{\"kind\":\"pcm\",\"b64\":\"\(b64)\"}\n"
        handle.write(line.data(using: .utf8)!)
    }
}
