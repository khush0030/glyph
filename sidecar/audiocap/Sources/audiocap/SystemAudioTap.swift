import Foundation
import AVFoundation
import CoreAudio

/// System-audio capture via the macOS 14.4+ Core Audio process-tap API
/// (SPEC §5): a global mono tap (excluding our own process) is wrapped in a
/// private aggregate device, and an IO proc delivers the tapped samples.
///
/// Best-effort: if the tap can't be created (e.g. TCC denied, or no output
/// device), `start()` throws and the caller falls back to mic-only.
@available(macOS 14.2, *)
final class SystemAudioTap {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let onBuffer: (AVAudioPCMBuffer) -> Void
    private var format: AVAudioFormat?

    init(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) {
        self.onBuffer = onBuffer
    }

    func start() throws {
        // 1. Global mono tap, exclude no processes (we emit no audio ourselves).
        let desc = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        desc.name = "Glyph System Tap"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted

        var err = AudioHardwareCreateProcessTap(desc, &tapID)
        guard err == noErr, tapID != kAudioObjectUnknown else {
            throw TapError.create("AudioHardwareCreateProcessTap", err)
        }

        // 2. Resolve the tap's UID and stream format.
        let tapUID = try stringProperty(tapID, kAudioTapPropertyUID)
        let asbd = try tapFormat(tapID)
        guard let fmt = AVAudioFormat(streamDescription: &asbd.pointee) else {
            throw TapError.message("could not build AVAudioFormat from tap ASBD")
        }
        format = fmt
        Log.status("system tap format \(Int(fmt.sampleRate)) Hz, \(fmt.channelCount) ch")

        // 3. Private aggregate device wrapping the tap.
        let aggUID = "ai.oltaflock.glyph.agg.\(ProcessInfo.processInfo.processIdentifier)"
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "Glyph Aggregate",
            kAudioAggregateDeviceUIDKey as String: aggUID,
            kAudioAggregateDeviceIsPrivateKey as String: true,
            kAudioAggregateDeviceIsStackedKey as String: false,
            kAudioAggregateDeviceTapAutoStartKey as String: true,
            kAudioAggregateDeviceTapListKey as String: [
                [
                    kAudioSubTapUIDKey as String: tapUID,
                    kAudioSubTapDriftCompensationKey as String: true,
                ]
            ],
        ]
        err = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
        guard err == noErr, aggregateID != kAudioObjectUnknown else {
            throw TapError.create("AudioHardwareCreateAggregateDevice", err)
        }

        // 4. IO proc — delivers tapped samples on a dedicated queue.
        let queue = DispatchQueue(label: "ai.oltaflock.glyph.systemtap")
        err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) {
            [weak self] _, inInputData, _, _, _ in
            self?.handle(inInputData)
        }
        guard err == noErr, procID != nil else {
            throw TapError.create("AudioDeviceCreateIOProcIDWithBlock", err)
        }

        err = AudioDeviceStart(aggregateID, procID)
        guard err == noErr else { throw TapError.create("AudioDeviceStart", err) }
        Log.status("system tap started")
    }

    func stop() {
        if let procID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, procID)
            AudioDeviceDestroyIOProcID(aggregateID, procID)
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
        }
    }

    // MARK: - IO

    private func handle(_ inInputData: UnsafePointer<AudioBufferList>) {
        guard let fmt = format else { return }
        let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
        guard let first = abl.first, first.mDataByteSize > 0 else { return }
        let frames = first.mDataByteSize / UInt32(fmt.streamDescription.pointee.mBytesPerFrame)
        guard frames > 0,
              let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames)
        else { return }
        buf.frameLength = frames
        // Copy the tapped bytes into the PCM buffer (formats match by construction).
        let dst = buf.mutableAudioBufferList
        let dstABL = UnsafeMutableAudioBufferListPointer(dst)
        for i in 0..<min(abl.count, dstABL.count) {
            if let src = abl[i].mData, let d = dstABL[i].mData {
                let n = Int(min(abl[i].mDataByteSize, dstABL[i].mDataByteSize))
                memcpy(d, src, n)
                dstABL[i].mDataByteSize = UInt32(n)
            }
        }
        onBuffer(buf)
    }

    // MARK: - property helpers

    private func stringProperty(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> String {
        var addr = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(MemoryLayout<CFString>.size)
        var value: CFString = "" as CFString
        let err = withUnsafeMutablePointer(to: &value) {
            AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, $0)
        }
        guard err == noErr else { throw TapError.create("get UID", err) }
        return value as String
    }

    /// Returns a heap pointer to the tap's ASBD (caller passes it straight into
    /// AVAudioFormat, then it is freed when the closure returns).
    private func tapFormat(_ obj: AudioObjectID) throws -> UnsafeMutablePointer<AudioStreamBasicDescription> {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let ptr = UnsafeMutablePointer<AudioStreamBasicDescription>.allocate(capacity: 1)
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let err = AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, ptr)
        guard err == noErr else {
            ptr.deallocate()
            throw TapError.create("get tap format", err)
        }
        return ptr
    }

    enum TapError: Error, CustomStringConvertible {
        case create(String, OSStatus)
        case message(String)
        var description: String {
            switch self {
            case let .create(what, status): return "\(what) failed: OSStatus \(status)"
            case let .message(m): return m
            }
        }
    }
}
