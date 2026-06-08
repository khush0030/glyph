import { useEffect, useState } from "react";
import { commands, type CredentialId, type CredentialStatus } from "../lib/ipc";

interface Field {
  id: CredentialId;
  title: string;
  desc: string;
  placeholder: string;
  /** Where to get the credential, shown as a hint link target. */
  hint: string;
}

const FIELDS: Field[] = [
  {
    id: "elevenlabs_api_key",
    title: "ElevenLabs API key",
    desc: "Scribe v2 speech-to-text (~$0.28/hr). Used for cloud transcription.",
    placeholder: "sk_…",
    hint: "elevenlabs.io → Profile → API Keys",
  },
  {
    id: "anthropic_api_key",
    title: "Anthropic API key",
    desc: "Claude Haiku 4.5 / Sonnet 4.6 — folds transcripts into structured notes.",
    placeholder: "sk-ant-…",
    hint: "console.anthropic.com → API Keys",
  },
  {
    id: "google_oauth_client_id",
    title: "Google OAuth client ID",
    desc: "Desktop OAuth client for Google Calendar (PKCE, no secret in the app).",
    placeholder: "…apps.googleusercontent.com",
    hint: "console.cloud.google.com → Credentials → OAuth client (Desktop)",
  },
  {
    id: "asana_access_token",
    title: "Asana access token",
    desc: "Personal Access Token to push action items as tasks with assignees.",
    placeholder: "1/12…",
    hint: "app.asana.com → Settings → Apps → Personal access tokens",
  },
];

export default function Credentials() {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [available, setAvailable] = useState(true);

  async function refresh() {
    try {
      const list: CredentialStatus[] = await commands.credentialStatus();
      setStatus(Object.fromEntries(list.map((s) => [s.id, s.present])));
    } catch {
      // Not running inside Tauri (e.g. plain `vite` preview) — Keychain absent.
      setAvailable(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="bg-surface border border-line rounded-r shadow-card overflow-hidden">
      {!available && (
        <div className="px-5 py-3 text-[12.5px] text-amber bg-amber-soft">
          Keychain is only reachable in the desktop app — run
          <span className="font-semibold"> pnpm tauri dev</span> to save keys.
        </div>
      )}
      {FIELDS.map((f) => (
        <CredentialRow
          key={f.id}
          field={f}
          present={!!status[f.id]}
          disabled={!available}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

function CredentialRow({
  field,
  present,
  disabled,
  onChanged,
}: {
  field: Field;
  present: boolean;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await commands.setCredential(field.id, value.trim());
      setValue("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await commands.deleteCredential(field.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-[17px] border-b border-line-soft last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-semibold flex items-center gap-[9px]">
            {field.title}
            {present ? (
              <span className="inline-flex items-center gap-[6px] text-[11px] font-semibold text-green bg-green-soft px-[9px] py-[2px] rounded-[20px]">
                <span className="w-[6px] h-[6px] rounded-full bg-green" /> Saved
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-faint bg-line-soft px-[9px] py-[2px] rounded-[20px]">
                Not set
              </span>
            )}
          </div>
          <div className="text-[12.5px] text-muted mt-[2px] max-w-[520px] leading-[1.45]">
            {field.desc} <span className="text-faint">· {field.hint}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 flex items-center bg-bg border border-line rounded-[10px] px-3 focus-within:border-indigo">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            disabled={disabled || busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={present ? "•••••••• (saved — type to replace)" : field.placeholder}
            className="flex-1 bg-transparent border-none outline-none py-[9px] font-sans text-[13px] text-ink"
          />
          {value && (
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="text-[11px] font-semibold text-faint hover:text-muted px-1"
            >
              {reveal ? "Hide" : "Show"}
            </button>
          )}
        </div>
        <button
          onClick={save}
          disabled={disabled || busy || !value.trim()}
          className="font-semibold text-[12.5px] px-[14px] py-[9px] rounded-[10px] bg-indigo text-white border border-indigo disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-deep"
        >
          Save
        </button>
        {present && (
          <button
            onClick={clear}
            disabled={disabled || busy}
            className="font-semibold text-[12.5px] px-[14px] py-[9px] rounded-[10px] bg-surface text-rec border border-line hover:border-rec disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
