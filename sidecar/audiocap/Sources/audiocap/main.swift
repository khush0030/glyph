import Foundation
import AVFoundation

// audiocap — Glyph's native audio sidecar.
//
// Modes:
//   audiocap                       stream length-framed 16 kHz PCM to stdout
//   audiocap --wav OUT [--seconds N]   write a WAV for listening (M1 validation)
//   flags: --no-system   capture mic only (skip the system-audio tap)
//
// Status / level / error lines are JSON on stderr.

struct Args {
    var wavPath: String?
    var seconds: Double = 15
    var system = true
}

func parseArgs() -> Args {
    var a = Args()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = it.next() {
        switch arg {
        case "--wav": a.wavPath = it.next()
        case "--seconds": if let s = it.next(), let v = Double(s) { a.seconds = v }
        case "--no-system": a.system = false
        default: Log.error("unknown arg: \(arg)")
        }
    }
    return a
}

let args = parseArgs()

let wav: WavWriter?
let frames: FrameWriter?
if let path = args.wavPath {
    guard let w = WavWriter(path: path) else {
        Log.error("could not open WAV at \(args.wavPath ?? "")")
        exit(1)
    }
    wav = w
    frames = nil
    Log.status("validation mode → \(path) for \(Int(args.seconds))s")
} else {
    wav = nil
    frames = FrameWriter()
    Log.status("stream mode")
}

// Mixer emits 100 ms frames; route to WAV or stdout, and report level.
let mixer = Mixer { samples, rms in
    wav?.write(samples)
    frames?.write(samples)
    Log.level(rms)
}

let mic = MicCapture { buf in mixer.feed(.mic, buf) }
// SystemAudioTap is gated to macOS 14.2+; held as Any so this file builds on
// the package's 14.0 floor, with the real type used behind an availability check.
var systemTap: AnyObject?

mixer.start()

do {
    try mic.start()
} catch {
    Log.error("mic start failed: \(error)")
    exit(1)
}

if args.system {
    if #available(macOS 14.2, *) {
        let tap = SystemAudioTap { buf in mixer.feed(.system, buf) }
        do {
            try tap.start()
            systemTap = tap
        } catch {
            // Best-effort: continue mic-only if the tap can't be created.
            Log.error("system tap unavailable, continuing mic-only: \(error)")
        }
    } else {
        Log.error("system tap needs macOS 14.2+, continuing mic-only")
    }
}

Log.emit("ready", ["system": systemTap != nil])

func shutdown() -> Never {
    mixer.stop()
    mic.stop()
    if #available(macOS 14.2, *) {
        (systemTap as? SystemAudioTap)?.stop()
    }
    wav?.close()
    Log.status("stopped")
    exit(0)
}

// Clean stop on SIGINT/SIGTERM (Rust kills the sidecar on Stop). Sources are
// retained in `signalSources` for the process lifetime so handlers stay armed.
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { shutdown() }
    src.resume()
    signalSources.append(src)
}

// Validation mode stops itself after the requested duration.
if args.wavPath != nil {
    DispatchQueue.main.asyncAfter(deadline: .now() + args.seconds) { shutdown() }
}

RunLoop.main.run()
