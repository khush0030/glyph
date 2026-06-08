import Foundation

/// Minimal 16 kHz mono Int16 WAV writer — used by validation mode (`--wav`) so
/// a recording can be listened to before wiring the sidecar into Tauri (M1
/// "validate by writing a WAV and listening").
final class WavWriter {
    private let handle: FileHandle
    private let sampleRate: UInt32
    private var dataBytes: UInt32 = 0

    init?(path: String, sampleRate: UInt32 = 16_000) {
        FileManager.default.createFile(atPath: path, contents: nil)
        guard let h = FileHandle(forWritingAtPath: path) else { return nil }
        self.handle = h
        self.sampleRate = sampleRate
        writeHeader(dataLength: 0) // placeholder, patched on close
    }

    func write(_ samples: [Int16]) {
        var copy = samples
        let data = copy.withUnsafeBytes { Data($0) }
        let end = handle.seekToEndOfFile()
        handle.write(data)
        dataBytes += UInt32(data.count)
        // Patch the header in place each frame so an abrupt kill (Rust sends
        // SIGKILL on Stop) still leaves a valid, playable WAV — then seek back
        // to the end for the next append.
        handle.seek(toFileOffset: 0)
        writeHeader(dataLength: dataBytes)
        handle.seek(toFileOffset: end + UInt64(data.count))
    }

    func close() {
        // Patch RIFF + data chunk sizes now that the total is known.
        handle.seek(toFileOffset: 0)
        writeHeader(dataLength: dataBytes)
        try? handle.close()
    }

    private func writeHeader(dataLength: UInt32) {
        let channels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let byteRate = sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)

        var header = Data()
        func append(_ s: String) { header.append(s.data(using: .ascii)!) }
        func append32(_ v: UInt32) { var x = v.littleEndian; header.append(Data(bytes: &x, count: 4)) }
        func append16(_ v: UInt16) { var x = v.littleEndian; header.append(Data(bytes: &x, count: 2)) }

        append("RIFF")
        append32(36 + dataLength)
        append("WAVE")
        append("fmt ")
        append32(16)
        append16(1) // PCM
        append16(channels)
        append32(sampleRate)
        append32(byteRate)
        append16(blockAlign)
        append16(bitsPerSample)
        append("data")
        append32(dataLength)

        handle.write(header)
    }
}
