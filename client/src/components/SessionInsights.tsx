import { useEffect, useState } from 'react';
import type { ParticipantInfo, TranscriptEvent } from '../../../shared/protocol.ts';
import { hueFor } from '../lib/format.ts';
import { countWords, finalSegments, formatDuration, speakingDistribution } from '../lib/transcriptExport.ts';

interface Props {
  participants: ParticipantInfo[];
  transcript: TranscriptEvent[];
  joinedAt: number | null;
}

/** Live session statistics, computed only from FINAL transcript segments. */
export function SessionInsights({ participants, transcript, joinedAt }: Props) {
  const now = useNow(1000);
  const finals = finalSegments(transcript);
  const words = finals.reduce((n, s) => n + countWords(s.text), 0);

  return (
    <section className="card insights" aria-label="Session insights" id="session-insights">
      <h2 className="insights__title">Session insights</h2>
      <InsightStats
        stats={[
          { label: 'People', value: String(participants.length), id: 'insight-participants' },
          { label: 'Duration', value: joinedAt ? formatDuration(now - joinedAt) : '00:00', id: 'insight-duration' },
          { label: 'Words', value: String(words), id: 'insight-words' },
          { label: 'Segments', value: String(finals.length), id: 'insight-segments' },
        ]}
      />
      <SpeakingDistribution segments={transcript} />
    </section>
  );
}

export function InsightStats({ stats }: { stats: { label: string; value: string; id?: string }[] }) {
  return (
    <dl className="stats">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <dt>{s.label}</dt>
          <dd id={s.id}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SpeakingDistribution({ segments }: { segments: TranscriptEvent[] }) {
  const dist = speakingDistribution(segments);
  return (
    <div className="dist" id="speaking-distribution">
      <div className="dist__head">
        <span>Speaking share</span>
        <span className="muted">by words</span>
      </div>
      {dist.length === 0 ? (
        <p className="dist__empty">Appears once the first caption is finalized.</p>
      ) : (
        <>
          <div className="dist__bar" aria-hidden>
            {dist.map((d) => (
              <span
                key={d.participantId}
                style={{ ['--hue' as string]: hueFor(d.participantId), flexGrow: d.words || 0.0001 }}
              />
            ))}
          </div>
          <ul className="dist__list">
            {dist.map((d) => (
              <li key={d.participantId} style={{ ['--hue' as string]: hueFor(d.participantId) }}>
                <span className="dist__swatch" />
                <span className="dist__name">{d.name}</span>
                <span className="dist__words">{d.words} w</span>
                <span className="dist__pct">{Math.round(d.share * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
