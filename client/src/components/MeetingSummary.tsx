import { useState } from 'react';
import { formatTime } from '../lib/format.ts';
import {
  countWords,
  downloadTranscript,
  finalSegments,
  formatDuration,
  languageBreakdown,
  meetingParticipants,
  type ExportFormat,
  type MeetingRecord,
} from '../lib/transcriptExport.ts';
import { Brand } from './Landing.tsx';
import { InsightStats, SpeakingDistribution } from './SessionInsights.tsx';

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  gu: 'Gujarati',
};

export function MeetingSummary({ meeting, onClose }: { meeting: MeetingRecord; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const finals = finalSegments(meeting.segments);
  const words = finals.reduce((n, s) => n + countWords(s.text), 0);
  const people = meetingParticipants(meeting);
  const ordered = [...meeting.segments].sort((a, b) => a.timestamp - b.timestamp);
  const langs = languageBreakdown(meeting.segments);
  const langList = Object.keys(langs).length
    ? Object.keys(langs).map((k) => LANG_NAMES[k] || k.toUpperCase()).join(', ')
    : 'English';

  const dl = (f: ExportFormat) => downloadTranscript(meeting, f);

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim();
    if (!targetEmail) return;

    setSending(true);
    setEmailStatus(null);

    try {
      const res = await fetch('/api/send-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, meeting }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEmailStatus({ ok: true, msg: data.message || `Transcript sent to ${targetEmail}!` });
      } else {
        setEmailStatus({ ok: false, msg: data.message || 'Failed to send transcript email.' });
      }
    } catch (err) {
      setEmailStatus({ ok: false, msg: (err as Error).message || 'Network error sending email.' });
    } finally {
      setSending(false);
    }
  };

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
          <p className="block__hint">Generated in your browser with detected languages and translations.</p>

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

          <div className="email-box" id="email-panel">
            <h3 className="email-box__title">Email me this transcript</h3>
            <p className="block__hint">Receive a copy with stats, translations, and file attachments.</p>
            <form className="email-form" onSubmit={handleSendEmail}>
              <input
                type="email"
                className="input input--sm email-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                required
              />
              <button
                type="submit"
                className="btn btn--secondary btn--sm"
                id="send-email-btn"
                disabled={sending || !email.trim()}
              >
                {sending ? 'Sending…' : 'Send transcript'}
              </button>
            </form>
            {emailStatus && (
              <p className={`email-status ${emailStatus.ok ? 'email-status--ok' : 'email-status--err'}`} role="status">
                {emailStatus.msg}
              </p>
            )}
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
                { label: 'Languages', value: langList },
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
                {ordered.map((s) => {
                  const lang = s.language || 'en';
                  const isNonEnglish = lang !== 'en';
                  return (
                    <li
                      key={s.segmentId}
                      className={`caption ${s.isFinal ? 'caption--final' : 'caption--interim caption--stale'}`}
                    >
                      <div className="caption__main">
                        <div className="caption__meta">
                          <span className="caption__name">{s.participantName}</span>
                          <span className="caption__lang" data-lang={lang}>
                            {LANG_NAMES[lang] || lang.toUpperCase()}
                          </span>
                          <time className="caption__time">{formatTime(s.timestamp)}</time>
                          {!s.isFinal && <span className="live-tag">unfinalized</span>}
                        </div>
                        <p className="caption__text">{s.text}</p>
                        {isNonEnglish && s.translation && (
                          <p className="caption__translation">“{s.translation}”</p>
                        )}
                      </div>
                    </li>
                  );
                })}
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
