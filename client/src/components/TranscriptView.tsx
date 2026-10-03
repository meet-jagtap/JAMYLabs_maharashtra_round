import { useEffect, useRef } from 'react';
import type { ParticipantInfo, TranscriptEvent } from '../../../shared/protocol.ts';
import { formatTime, hueFor, initials } from '../lib/format.ts';

interface Props {
  events: TranscriptEvent[];
  participants: ParticipantInfo[];
  selfId: string;
}

export function TranscriptView({ events, participants, selfId }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const speaking = new Set(participants.filter((p) => p.speaking).map((p) => p.id));

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <section className="card transcript" aria-label="Live transcript">
      <header className="transcript__head">
        <h2>Live transcript</h2>
        <div className="legend">
          <span className="legend__item">
            <span className="legend__swatch legend__swatch--final" /> Final
          </span>
          <span className="legend__item">
            <span className="legend__swatch legend__swatch--interim" /> Interim
          </span>
        </div>
      </header>

      <div className="transcript__body" ref={scroller} onScroll={onScroll} id="transcript-list" aria-live="polite">
        {events.length === 0 ? (
          <div className="transcript__empty">
            <div className="empty__rings" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <p>Captions will appear here as people speak.</p>
            <p className="muted">Turn on your microphone to start contributing.</p>
          </div>
        ) : (
          <ol className="captions">
            {events.map((ev) => {
              const stale = !ev.isFinal && !speaking.has(ev.participantId);
              const hue = hueFor(ev.participantId);
              return (
                <li
                  key={ev.segmentId}
                  className={`caption ${ev.isFinal ? 'caption--final' : 'caption--interim'} ${stale ? 'caption--stale' : ''}`}
                  style={{ ['--hue' as string]: hue }}
                  data-final={ev.isFinal}
                >
                  <div className="avatar" aria-hidden>
                    {initials(ev.participantName)}
                  </div>
                  <div className="caption__main">
                    <div className="caption__meta">
                      <span className="caption__name">
                        {ev.participantName}
                        {ev.participantId === selfId && <span className="you-tag">you</span>}
                      </span>
                      <time className="caption__time">{formatTime(ev.timestamp)}</time>
                      {!ev.isFinal && !stale && (
                        <span className="live-tag">
                          <span className="dots">
                            <i />
                            <i />
                            <i />
                          </span>
                          interim
                        </span>
                      )}
                    </div>
                    <p className="caption__text">{ev.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
