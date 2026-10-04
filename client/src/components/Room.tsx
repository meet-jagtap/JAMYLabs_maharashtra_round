import { useState } from 'react';
import type { Roundtable, SessionState } from '../lib/useRoundtable.ts';
import { hueFor, initials } from '../lib/format.ts';
import { ConnectionPill } from './ConnectionPill.tsx';
import { Brand } from './Landing.tsx';
import { SessionInsights } from './SessionInsights.tsx';
import { TranscriptView } from './TranscriptView.tsx';

const TRANSCRIBER_LABEL = {
  idle: 'Mic off',
  connecting: 'Connecting to Gemini…',
  live: 'Transcribing live',
  error: 'Transcription error',
} as const;

export function Room({ rt, session }: { rt: Roundtable; session: SessionState }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? session.code : `${location.origin}/?code=${session.code}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  };

  const status = rt.micOn ? rt.transcriber.status : 'idle';
  const canUseMic = rt.connection === 'open';

  return (
    <div className="room">
      <header className="room__top">
        <Brand />
        <div className="code-chip" id="session-code-display">
          <span className="code-chip__label">Session</span>
          <span className="code-chip__code">{session.code}</span>
          <button className="chip-btn" id="copy-code" onClick={() => copy('code')}>
            {copied === 'code' ? 'Copied' : 'Copy'}
          </button>
          <button className="chip-btn" id="copy-link" onClick={() => copy('link')}>
            {copied === 'link' ? 'Copied' : 'Invite link'}
          </button>
        </div>
        <div className="room__top-right">
          <ConnectionPill state={rt.connection} />
          <button
            className="btn btn--end"
            id="end-meeting"
            onClick={() => void rt.endMeeting()}
            disabled={rt.ending}
            title="Leave this session and view your transcript summary"
          >
            {rt.ending ? 'Ending…' : 'End meeting'}
          </button>
        </div>
      </header>

      <div className="room__grid">
        <aside className="room__side">
          <section className="card mic-card" aria-label="Microphone">
            <div className="mic-card__who">
              <div className="avatar avatar--lg" style={{ ['--hue' as string]: hueFor(session.participantId) }}>
                {initials(session.name)}
              </div>
              <div>
                <div className="mic-card__name">{session.name}</div>
                <div className={`tstatus tstatus--${status}`} id="transcriber-status">
                  <span className="tstatus__dot" />
                  {TRANSCRIBER_LABEL[status]}
                </div>
              </div>
            </div>

            <button
              id="mic-toggle"
              className={`mic-btn ${rt.micOn ? 'mic-btn--on' : ''}`}
              style={{ ['--level' as string]: rt.level }}
              disabled={!canUseMic}
              onClick={rt.micOn ? rt.stopMic : rt.startMic}
              aria-pressed={rt.micOn}
            >
              <span className="mic-btn__ring" aria-hidden />
              <MicIcon off={!rt.micOn} />
              <span className="mic-btn__label">{rt.micOn ? 'Stop microphone' : 'Start microphone'}</span>
            </button>

            <div className="meter" aria-hidden>
              <div className="meter__fill" style={{ transform: `scaleX(${rt.micOn ? rt.level : 0})` }} />
            </div>

            <p className="mic-card__hint">
              {rt.micOn
                ? 'Speak naturally. Your captions are shared with everyone in this session.'
                : 'Your browser will ask for microphone permission the first time.'}
            </p>

            {(rt.error || (rt.transcriber.status !== 'live' && rt.transcriber.message)) && (
              <p className="alert" role="alert" id="room-error">
                {rt.error ?? rt.transcriber.message}
                {rt.error && (
                  <button className="alert__close" onClick={rt.dismissError} aria-label="Dismiss">
                    ×
                  </button>
                )}
              </p>
            )}
          </section>

          <SessionInsights participants={rt.participants} transcript={rt.transcript} joinedAt={rt.joinedAt} />

          <section className="card people" aria-label="Participants">
            <h2 className="people__title">
              At the table <span className="count">{rt.participants.length}</span>
            </h2>
            <ul className="people__list" id="participant-list">
              {rt.participants.map((p) => (
                <li key={p.id} className="person" style={{ ['--hue' as string]: hueFor(p.id) }}>
                  <div className="avatar avatar--sm">{initials(p.name)}</div>
                  <span className="person__name">
                    {p.name}
                    {p.id === session.participantId && <span className="you-tag">you</span>}
                  </span>
                  {p.speaking && (
                    <span className="person__live" title="Microphone on">
                      <MicIcon />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <TranscriptView events={rt.transcript} participants={rt.participants} selfId={session.participantId} />
      </div>
    </div>
  );
}

function MicIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}
