import Foundation

/// Status + log lines go to stderr as one JSON object per line, so Rust can
/// parse them while stdout stays a clean PCM byte stream.
enum Log {
    static func emit(_ kind: String, _ fields: [String: Any] = [:]) {
        var obj: [String: Any] = ["kind": kind]
        for (k, v) in fields { obj[k] = v }
        guard
            let data = try? JSONSerialization.data(withJSONObject: obj),
            var line = String(data: data, encoding: .utf8)
        else { return }
        line += "\n"
        FileHandle.standardError.write(line.data(using: .utf8)!)
    }

    static func status(_ msg: String) { emit("status", ["msg": msg]) }
    static func error(_ msg: String) { emit("error", ["msg": msg]) }
    static func level(_ rms: Float) { emit("level", ["rms": rms]) }
}
