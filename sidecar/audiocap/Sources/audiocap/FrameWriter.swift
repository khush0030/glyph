import Foundation

/// Length-framed PCM on stdout: `[u32 LE byte-length][Int16 LE samples]` per
/// ~100 ms frame (SPEC §5). Rust reads this stream straight into the
/// Transcriber. Writes are serialized so frames never interleave.
final class FrameWriter {
    private let handle = FileHandle.standardOutput
    private let lock = NSLock()

    func write(_ samples: [Int16]) {
        lock.lock(); defer { lock.unlock() }
        var copy = samples
        let payload = copy.withUnsafeBytes { Data($0) }
        var len = UInt32(payload.count).littleEndian
        handle.write(Data(bytes: &len, count: 4))
        handle.write(payload)
    }
}
