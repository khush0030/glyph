import Foundation
import AVFoundation

/// Accepts mic and system-audio buffers (any rate / channel count), converts
/// each to 16 kHz mono Float32, and mixes them into fixed ~100 ms frames of
/// Int16. Mic and system arrive on independent threads at different rates, so
/// each feeds a locked sample queue and a timer pulls aligned chunks from both.
final class Mixer {
    enum Track { case mic, system }

    private let outRate: Double = 16_000
    private let frameSamples = 1_600 // 100 ms at 16 kHz

    private let lock = NSLock()
    private var micQueue: [Float] = []
    private var sysQueue: [Float] = []

    // Per-track converters to 16 kHz mono Float32, lazily built from the first
    // buffer's format (the input format isn't known until audio starts).
    private var micConverter: AVAudioConverter?
    private var sysConverter: AVAudioConverter?
    private let outFormat: AVAudioFormat

    private let onFrame: ([Int16], Float) -> Void
    private var timer: DispatchSourceTimer?
    private let pullQueue = DispatchQueue(label: "ai.oltaflock.glyph.mixer")

    init(onFrame: @escaping ([Int16], Float) -> Void) {
        self.onFrame = onFrame
        self.outFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: outRate,
            channels: 1,
            interleaved: false
        )!
    }

    func start() {
        let t = DispatchSource.makeTimerSource(queue: pullQueue)
        t.schedule(deadline: .now() + 0.1, repeating: 0.1)
        t.setEventHandler { [weak self] in self?.pull() }
        timer = t
        t.resume()
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    func feed(_ track: Track, _ buffer: AVAudioPCMBuffer) {
        guard let mono = convert(track, buffer) else { return }
        lock.lock()
        switch track {
        case .mic: micQueue.append(contentsOf: mono)
        case .system: sysQueue.append(contentsOf: mono)
        }
        lock.unlock()
    }

    // MARK: - internals

    private func convert(_ track: Track, _ buffer: AVAudioPCMBuffer) -> [Float]? {
        let converter: AVAudioConverter?
        switch track {
        case .mic:
            if micConverter == nil {
                micConverter = AVAudioConverter(from: buffer.format, to: outFormat)
            }
            converter = micConverter
        case .system:
            if sysConverter == nil {
                sysConverter = AVAudioConverter(from: buffer.format, to: outFormat)
            }
            converter = sysConverter
        }
        guard let conv = converter else { return nil }

        let ratio = outRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else {
            return nil
        }

        var fed = false
        var err: NSError?
        let status = conv.convert(to: out, error: &err) { _, outStatus in
            if fed {
                outStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            outStatus.pointee = .haveData
            return buffer
        }
        if status == .error {
            if let err { Log.error("convert failed: \(err.localizedDescription)") }
            return nil
        }
        guard let ch = out.floatChannelData else { return nil }
        let n = Int(out.frameLength)
        return Array(UnsafeBufferPointer(start: ch[0], count: n))
    }

    private func pull() {
        lock.lock()
        let haveMic = micQueue.count >= frameSamples
        let haveSys = sysQueue.count >= frameSamples
        // Only emit once at least one track has a full frame; drain the other
        // up to the same length (zero-pad if short) so they stay aligned.
        guard haveMic || haveSys else { lock.unlock(); return }

        let mic = take(&micQueue, frameSamples)
        let sys = take(&sysQueue, frameSamples)
        lock.unlock()

        var mixed = [Int16](repeating: 0, count: frameSamples)
        var sumSq: Float = 0
        for i in 0..<frameSamples {
            let s = mic[i] + sys[i]
            let clamped = max(-1.0, min(1.0, s)) // light clipping guard
            sumSq += clamped * clamped
            mixed[i] = Int16(clamped * Float(Int16.max))
        }
        let rms = (sumSq / Float(frameSamples)).squareRoot()
        onFrame(mixed, rms)
    }

    /// Remove up to `n` samples from the front of `q`, zero-padding to `n`.
    private func take(_ q: inout [Float], _ n: Int) -> [Float] {
        if q.isEmpty { return [Float](repeating: 0, count: n) }
        let count = min(n, q.count)
        var out = Array(q[0..<count])
        q.removeFirst(count)
        if out.count < n { out.append(contentsOf: [Float](repeating: 0, count: n - out.count)) }
        return out
    }
}
