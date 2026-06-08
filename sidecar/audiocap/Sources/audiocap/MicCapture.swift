import Foundation
import AVFoundation

/// Microphone capture via AVAudioEngine's input node. Installs a tap and hands
/// each buffer to the Mixer. Independent of the system-audio tap.
final class MicCapture {
    private let engine = AVAudioEngine()
    private let onBuffer: (AVAudioPCMBuffer) -> Void

    init(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) {
        self.onBuffer = onBuffer
    }

    func start() throws {
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        Log.status("mic format \(Int(format.sampleRate)) Hz, \(format.channelCount) ch")
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { [weak self] buf, _ in
            self?.onBuffer(buf)
        }
        engine.prepare()
        try engine.start()
        Log.status("mic started")
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
