import Foundation
import AVFoundation
import CoreGraphics

// Permission probing for Glyph's first-run flow. The sidecar owns AVFoundation
// and the system-audio tap, so it also owns reporting/requesting the two OS
// permissions recording needs: microphone (AVCaptureDevice) and screen/system
// audio recording (CoreGraphics, which gates the Core Audio process tap).
//
// One-shot modes — print a single JSON line to STDOUT and exit, so Rust can
// parse it cleanly (status/level lines stay on stderr):
//   audiocap --check-perms     report current status, no prompts
//   audiocap --request-perms   trigger the OS prompts, then report
enum Permissions {
    static func micStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "undetermined"
        @unknown default: return "undetermined"
        }
    }

    static func screenStatus() -> String {
        // True once the user has granted Screen & System Audio Recording.
        CGPreflightScreenCaptureAccess() ? "granted" : "denied"
    }

    /// Print `{"mic":..,"screen":..}` to stdout and exit.
    static func report() -> Never {
        let obj: [String: Any] = ["mic": micStatus(), "screen": screenStatus()]
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let line = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
        }
        exit(0)
    }

    /// Trigger both OS prompts (blocking), then report. The mic prompt only
    /// appears while status is undetermined; once denied the user must use
    /// System Settings (the app deep-links there). The screen request adds the
    /// app to the list and opens the prompt; the toggle still needs a manual
    /// flip + relaunch, which the onboarding UI explains.
    static func request() -> Never {
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            let sem = DispatchSemaphore(value: 0)
            AVCaptureDevice.requestAccess(for: .audio) { _ in sem.signal() }
            sem.wait()
        }
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
        report()
    }
}
