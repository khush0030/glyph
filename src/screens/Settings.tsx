import PageHeader from "../components/PageHeader";
import { Card, SectionHead, Seg, ConnPill } from "../components/ui";
import Credentials from "../components/Credentials";
import type { ReactNode } from "react";

// One settings row (.srow): title + description left, control right.
function SRow({
  title,
  desc,
  control,
}: {
  title: string;
  desc: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 px-5 py-[17px] border-b border-line-soft last:border-b-0">
      <div>
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[12.5px] text-muted mt-[2px] max-w-[460px] leading-[1.45]">
          {desc}
        </div>
      </div>
      {control}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="animate-fade">
      <PageHeader title="Settings" sub="Engines, integrations & privacy" />

      <SectionHead title="Transcription & analysis" />
      <Card>
        <SRow
          title="Transcription engine"
          desc="Cloud uses ElevenLabs Scribe v2 (~$0.28/hr, best accuracy). Private Mode runs Whisper locally — nothing leaves your Mac."
          control={<Seg options={["Cloud", "Private"]} />}
        />
        <SRow
          title="Analysis model"
          desc="Haiku 4.5 for everyday notes (~2¢/meeting). Sonnet 4.6 for sharper action items on important calls."
          control={<Seg options={["Haiku 4.5", "Sonnet 4.6"]} />}
        />
        <SRow
          title="Language"
          desc="Auto-detect handles Hindi, English and Hinglish. Transcripts keep their original script — never translated."
          control={
            <Seg options={["Auto", <span className="dev">हिं</span>, "EN"]} />
          }
        />
      </Card>

      <SectionHead title="API keys & credentials" />
      <Credentials />

      <SectionHead title="Integrations" />
      <Card>
        <SRow
          title="Google Calendar"
          desc="Pulls upcoming meetings and detects video links to trigger recording."
          control={<ConnPill>Connected</ConnPill>}
        />
        <SRow
          title="Asana"
          desc="Push action items as tasks with assignees and due dates, into client or internal projects."
          control={<ConnPill>Connected</ConnPill>}
        />
      </Card>

      <SectionHead title="Recording & privacy" />
      <Card>
        <SRow
          title="Auto-record meetings"
          desc={'For calendar meetings with a video link. "Ask first" shows a one-tap prompt at start time.'}
          control={<Seg options={["Ask first", "Auto all"]} />}
        />
        <SRow
          title="Audio retention"
          desc="Keep recordings, or delete audio automatically once a meeting is transcribed."
          control={<Seg options={["Keep", "Delete after"]} initial={1} />}
        />
        <SRow
          title="Permissions"
          desc="Microphone, system audio, and calendar access."
          control={<ConnPill>All granted</ConnPill>}
        />
      </Card>
    </div>
  );
}
