import { useState } from "react";
import { commands, type CredentialId } from "../lib/ipc";

interface Field {
  id: CredentialId;
  title: string;
  desc: string;
  placeholder: string;
  hint: string;
}

const FIELDS: Field[] = [
  {
    id: "elevenlabs_api_key",
    title: "ElevenLabs",
    desc: "Scribe v2 speech-to-text for live transcription (~$0.28/hr).",
    placeholder: "sk_…",
    hint: "elevenlabs.io → Profile → API Keys",
  },
  {
    id: "anthropic_api_key",
    title: "Anthropic",
    desc: "Claude Haiku 4.5 / Sonnet 4.6 — turns transcripts into structured notes.",
    placeholder: "sk-ant-…",
    hint: "console.anthropic.com → API Keys",
  },
  {
    id: "google_oauth_client_id",
    title: "Google OAuth client ID",
    desc: "Desktop OAuth client for Google Calendar (PKCE — no secret in the app).",
    placeholder: "…apps.googleusercontent.com",
    hint: "console.cloud.google.com → Credentials → OAuth client (Desktop)",
  },
  {
    id: "asana_access_token",
    title: "Asana",
    desc: "Personal Access Token to push action items as assigned, dated tasks.",
    placeholder: "1/12…",
    hint: "app.asana.com → Settings → Apps → Personal access tokens",
  },
];

export default function Credentials({
  status,
  available,
  error,
  onChanged,
}: {
  status: Record<string, boolean>;
  available: boolean;
  error?: string | null;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-3">
      {!available && (
        <div className="px-4 py-3 rounded-r text-[12.5px] text-amber bg-amber-soft border border-amber/20">
          Keychain is only reachable in the desktop app — run{" "}
          <span className="font-semibold">pnpm tauri dev</span> to save keys.
        </div>
      )}
      {available && error && (
        <div className="px-4 py-3 rounded-r text-[12.5px] text-rec bg-rec-soft">
          Couldn’t read the Keychain: {error}. If macOS is asking for your “login”
          keychain password and rejecting it, your login keychain is out of sync —
          reset it in Keychain Access, then reopen Glyph.
        </div>
      )}
      {FIELDS.map((f) => (
        <CredentialCard
          key={f.id}
          field={f}
          present={!!status[f.id]}
          disabled={!available}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function CredentialCard({
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
    <div className="bg-surface border border-line rounded-r shadow-card px-5 py-[18px]">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-[14.5px] font-bold flex items-center gap-[9px]">
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
          <div className="text-[12.5px] text-muted mt-[3px] max-w-[520px] leading-[1.45]">
            {field.desc}
          </div>
          <div className="text-[11.5px] text-faint mt-[3px]">{field.hint}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center bg-bg border border-line rounded-[10px] px-3 focus-within:border-indigo transition-colors">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            disabled={disabled || busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={present ? "•••••••• saved — type to replace" : field.placeholder}
            className="flex-1 bg-transparent border-none outline-none py-[10px] font-sans text-[13px] text-ink"
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
          type="button"
          onClick={save}
          disabled={disabled || busy || !value.trim()}
          className="font-semibold text-[12.5px] px-[15px] py-[10px] rounded-[10px] bg-indigo text-white border border-indigo disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-deep transition-colors"
        >
          Save
        </button>
        {present && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled || busy}
            className="font-semibold text-[12.5px] px-[15px] py-[10px] rounded-[10px] bg-surface text-rec border border-line hover:border-rec disabled:opacity-40 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
