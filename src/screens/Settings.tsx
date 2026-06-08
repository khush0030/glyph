import type { ReactNode } from "react";
import PageHeader from "../components/PageHeader";
import { Card, SectionHead, Seg, ConnPill } from "../components/ui";
import Credentials from "../components/Credentials";
import { CalendarIcon, AsanaIcon } from "../components/Icons";
import { useSettings } from "../lib/useSettings";
import { useCredentials } from "../lib/useCredentials";

// One settings row (.srow): title + description left, control right.
function SRow({
  title,
  desc,
  control,
  icon,
}: {
  title: string;
  desc: string;
  control: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 px-5 py-[17px] border-b border-line-soft last:border-b-0">
      <div className="flex items-start gap-3">
        {icon && <div className="text-indigo mt-[1px]">{icon}</div>}
        <div>
          <div className="text-[14px] font-semibold">{title}</div>
          <div className="text-[12.5px] text-muted mt-[2px] max-w-[460px] leading-[1.45]">
            {desc}
          </div>
        </div>
      </div>
      {control}
    </div>
  );
}

const idx = (arr: string[], v: string) => Math.max(0, arr.indexOf(v));

export default function Settings() {
  const { values, set } = useSettings();
  const creds = useCredentials();

  return (
    <div className="animate-fade">
      <PageHeader title="Settings" sub="Engines, integrations & privacy" />

      <SectionHead title="Transcription & analysis" />
      <Card>
        <SRow
          title="Transcription engine"
          desc="Cloud uses ElevenLabs Scribe v2 (~$0.28/hr, best accuracy). Private Mode runs Whisper locally — nothing leaves your Mac."
          control={
            <Seg
              options={["Cloud", "Private"]}
              value={idx(["cloud", "private"], values.engine)}
              onChange={(i) => set("engine", ["cloud", "private"][i])}
            />
          }
        />
        <SRow
          title="Analysis model"
          desc="Haiku 4.5 for everyday notes (~2¢/meeting). Sonnet 4.6 for sharper action items on important calls."
          control={
            <Seg
              options={["Haiku 4.5", "Sonnet 4.6"]}
              value={idx(["claude-haiku-4-5", "claude-sonnet-4-6"], values.analysis_model)}
              onChange={(i) =>
                set("analysis_model", ["claude-haiku-4-5", "claude-sonnet-4-6"][i])
              }
            />
          }
        />
        <SRow
          title="Language"
          desc="Auto-detect handles Hindi, English and Hinglish. Transcripts keep their original script — never translated."
          control={
            <Seg
              options={["Auto", <span className="dev">हिं</span>, "EN"]}
              value={idx(["auto", "hi", "en"], values.language)}
              onChange={(i) => set("language", ["auto", "hi", "en"][i])}
            />
          }
        />
      </Card>

      <SectionHead title="API keys & credentials" />
      <Credentials
        status={creds.status}
        available={creds.available}
        error={creds.error}
        onChanged={creds.refresh}
      />

      <SectionHead title="Integrations" />
      <Card>
        <SRow
          icon={<CalendarIcon className="w-[18px] h-[18px]" />}
          title="Google Calendar"
          desc="Pulls upcoming meetings and detects video links to trigger recording."
          control={
            creds.isSet("google_oauth_client_id") ? (
              <ConnPill>Connected</ConnPill>
            ) : (
              <span className="text-[12.5px] font-semibold text-faint">
                Add client ID above
              </span>
            )
          }
        />
        <SRow
          icon={<AsanaIcon className="w-[18px] h-[18px]" />}
          title="Asana"
          desc="Push action items as tasks with assignees and due dates, into client or internal projects."
          control={
            creds.isSet("asana_access_token") ? (
              <ConnPill>Connected</ConnPill>
            ) : (
              <span className="text-[12.5px] font-semibold text-faint">
                Add token above
              </span>
            )
          }
        />
      </Card>

      <SectionHead title="Recording & privacy" />
      <Card>
        <SRow
          title="Auto-record meetings"
          desc={'For calendar meetings with a video link. "Ask first" shows a one-tap prompt at start time.'}
          control={
            <Seg
              options={["Ask first", "Auto all"]}
              value={idx(["ask", "auto"], values.auto_record)}
              onChange={(i) => set("auto_record", ["ask", "auto"][i])}
            />
          }
        />
        <SRow
          title="Audio retention"
          desc="Keep recordings, or delete audio automatically once a meeting is transcribed."
          control={
            <Seg
              options={["Keep", "Delete after"]}
              value={idx(["keep", "delete"], values.audio_retention)}
              onChange={(i) => set("audio_retention", ["keep", "delete"][i])}
            />
          }
        />
        <SRow
          title="Permissions"
          desc="Microphone and system-audio access are requested the first time you record."
          control={
            <span className="text-[12.5px] font-semibold text-faint">
              Prompted on first record
            </span>
          }
        />
      </Card>
    </div>
  );
}
