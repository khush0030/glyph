import Foundation
import AppKit
import CoreAudio
import Darwin

// audiocap --detect — headless meeting-join detector for Glyph. Captures NO
// audio. Once a second it reads two signals:
//   1. is some process using the default input device?
//      (kAudioDevicePropertyDeviceIsRunningSomewhere — public device metadata,
//      cheap, read every tick)
//   2. the running-process list, to attribute the call to a platform
//      (Zoom's in-meeting helper `CptHost`, Microsoft Teams, a browser).
// Signal 2 costs a proc_name syscall per PID (~500-800 of them), so it is NOT
// enumerated every tick. It runs when it can change the outcome — the mic is
// busy, a call is up, a start/end debounce is in flight — and otherwise only
// every `scanEveryNTicks` ticks, so a muted-mic Zoom (CptHost with no mic) is
// still picked up within ~4 s. Skipped ticks reuse the last scan.
// After 3 s of continuous activity it prints one JSON line to stdout:
//   {"evt":"call_started","platform":"zoom|teams|browser|unknown"}
// and after 10 s of inactivity:
//   {"evt":"call_ended"}
// Status / error lines stay on stderr via Log, like the other modes.
enum Detect {
    static let pollInterval: TimeInterval = 1
    static let startDebounce: TimeInterval = 3
    static let endDebounce: TimeInterval = 10
    /// Idle-state process-scan cadence, in ticks (~4 s at a 1 s poll).
    static let scanEveryNTicks = 4

    private static var inCall = false
    private static var activeSince: Date?
    private static var idleSince: Date?
    private static var tickCount = 0
    private static var lastProcs: Set<String> = []

    static func run() -> Never {
        Log.status("detect mode")
        let timer = Timer(timeInterval: pollInterval, repeats: true) { _ in tick() }
        RunLoop.main.add(timer, forMode: .common)
        RunLoop.main.run()
        exit(0)
    }

    static func tick() {
        tickCount &+= 1
        let busy = micBusy()
        // Refresh the process list only when it matters: while the mic is busy,
        // while a call is up, while a start debounce is pending (so a stale
        // CptHost can't debounce its way into a phantom call_started), and
        // otherwise on the slow idle cadence.
        if busy || inCall || activeSince != nil || tickCount % scanEveryNTicks == 0 {
            lastProcs = processNames()
        }
        let procs = lastProcs
        let zoomInMeeting = procs.contains("CptHost")
        let active = zoomInMeeting || busy
        let now = Date()

        if active {
            idleSince = nil
            if activeSince == nil { activeSince = now }
            if !inCall, let since = activeSince, now.timeIntervalSince(since) >= startDebounce {
                inCall = true
                emit(["evt": "call_started", "platform": platform(procs: procs, zoom: zoomInMeeting)])
            }
        } else {
            activeSince = nil
            guard inCall else { return }
            if idleSince == nil { idleSince = now }
            if let since = idleSince, now.timeIntervalSince(since) >= endDebounce {
                inCall = false
                idleSince = nil
                emit(["evt": "call_ended"])
            }
        }
    }

    /// True when any process has the default input device running.
    static func micBusy() -> Bool {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var dev = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let st = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev)
        guard st == noErr, dev != 0 else { return false }

        addr.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
        var running: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &running) == noErr else {
            return false
        }
        return running != 0
    }

    /// Short names of every running process (libproc; no extra permissions).
    static func processNames() -> Set<String> {
        var names = Set<String>()
        let count = proc_listallpids(nil, 0)
        guard count > 0 else { return names }
        var pids = [pid_t](repeating: 0, count: Int(count) * 2)
        let bytes = Int32(pids.count * MemoryLayout<pid_t>.size)
        let got = proc_listallpids(&pids, bytes)
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        for pid in pids.prefix(Int(max(got, 0))) where pid > 0 {
            let n = buf.withUnsafeMutableBufferPointer { p -> Int32 in
                proc_name(pid, p.baseAddress, UInt32(p.count))
            }
            if n > 0 { names.insert(String(cString: buf)) }
        }
        return names
    }

    static let teamsNames: Set<String> = ["Microsoft Teams", "MSTeams", "Teams"]
    static let browserNames: Set<String> = [
        "Google Chrome", "Safari", "Arc", "Microsoft Edge", "Brave Browser", "Firefox",
    ]

    /// Attribute the call. Zoom is certain (CptHost); otherwise prefer whatever
    /// app is frontmost, then fall back to "is it running at all".
    static func platform(procs: Set<String>, zoom: Bool) -> String {
        if zoom { return "zoom" }
        if let front = NSWorkspace.shared.frontmostApplication?.localizedName {
            if teamsNames.contains(front) { return "teams" }
            if browserNames.contains(front) { return "browser" }
        }
        if !procs.isDisjoint(with: teamsNames) { return "teams" }
        if !procs.isDisjoint(with: browserNames) { return "browser" }
        return "unknown"
    }

    static func emit(_ obj: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: obj),
            let line = String(data: data, encoding: .utf8)
        else { return }
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
}
