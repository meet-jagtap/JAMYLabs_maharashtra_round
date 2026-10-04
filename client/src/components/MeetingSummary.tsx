import { formatTime } from '../lib/format.ts';
import {
  countWords,
  downloadTranscript,
  finalSegments,
  formatDuration,
  meetingParticipants,
  type ExportFormat,
  type MeetingRecord,
} from '../lib/transcriptExport.ts';
import { Brand } from './Landing.tsx';
import { InsightStats, SpeakingDistribution } from './SessionInsights.tsx';

export function MeetingSummary({ meeting, onClose }: { meeting: MeetingRecord; onClose: () => void }) {
  const finals = finalSegments(meeting.segments);
  const words = finals.reduce((n, s) => n + countWords(s.text), 0);
  const people = meetingParticipants(meeting);
  const ordered = [...meeting.segments].sort((a, b) => a.timestamp - b.timestamp);
  const dl = (f: ExportFormat) => downloadTranscript(meeting, f);

  return (
    <main className="summary">
      <header className="landing__top">
        <Brand />
        <button className="btn btn--ghost" id="new-session" onClick={onClose}>
          Back to home
        </button>
      </header>

      <section className="summary__hero">
        <p className="eyebrow">Meeting ended · Session {meeting.sessionCode}</p>
        <h1 className="summary__title">
          Your conversation is <span className="gradient-text">ready to download.</span>
        </h1>
        <p className="landing__lede">
          {new Date(meeting.joinedAt).toLocaleString()} · {formatDuration(meeting.endedAt - meeting.joinedAt)} ·{' '}
          {people.map((p) => p.name).join(', ') || 'No participants recorded'}
        </p>
      </section>

      <div className="summary__grid">
        <section className="card download" aria-label="Download transcript" id="download-panel">
          <h2 className="download__title">Download transcript</h2>
          <p className="block__hint">Generated in your browser. Nothing is stored on the server.</p>

          <button className="btn btn--primary download__primary" id="download-txt" onClick={() => dl('txt')}>
            <DownloadIcon />
            Download transcript (.txt)
          </button>

          <div className="download__alts">
            <button className="btn btn--secondary" id="download-md" onClick={() => dl('md')}>
              Markdown <span className="ext">.md</span>
            </button>
            <button className="btn btn--secondary" id="download-json" onClick={() => dl('json')}>
              JSON <span className="ext">.json</span>
            </button>
          </div>

          {finals.length === 0 && (
            <p className="download__note">No finalized speech was captured, so the transcript will be mostly empty.</p>
          )}

          <div className="download__insights">
            <InsightStats
              stats={[
                { label: 'People', value: String(people.length) },
                { label: 'Duration', value: formatDuration(meeting.endedAt - meeting.joinedAt) },
                { label: 'Words', value: String(words) },
                { label: 'Segments', value: String(finals.length) },
              ]}
            />
            <SpeakingDistribution segments={meeting.segments} />
          </div>
        </section>

        <section className="card transcript summary__transcript" aria-label="Transcript preview">
          <header className="transcript__head">
            <h2>Transcript</h2>
            <span className="muted">{ordered.length} segments</span>
          </header>
          <div className="transcript__body" id="summary-transcript">
            {ordered.length === 0 ? (
              <div className="transcript__empty">
                <p>No speech was transcribed in this session.</p>
              </div>
            ) : (
              <ol className="captions">
                {ordered.map((s) => (
                  <li key={s.segmentId} className={`caption ${s.isFinal ? 'caption--final' : 'caption--interim caption--stale'}`}>
                    <div className="caption__main">
                      <div className="caption__meta">
                        <span className="caption__name">{s.participantName}</span>
                        <time className="caption__time">{formatTime(s.timestamp)}</time>
                        {!s.isFinal && <span className="live-tag">unfinalized</span>}
                      </div>
                      <p className="caption__text">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}
