import { useState, type FormEvent } from 'react';
import type { Roundtable } from '../lib/useRoundtable.ts';
import { ConnectionPill } from './ConnectionPill.tsx';

const NAME_KEY = 'roundtable:name';

export function Landing({ rt }: { rt: Roundtable }) {
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(initialCode.toUpperCase());

  const ready = rt.connection === 'open' && !rt.pending;
  const trimmed = name.trim();

  const remember = () => localStorage.setItem(NAME_KEY, trimmed);

  const onCreate = () => {
    if (!trimmed) return;
    remember();
    rt.createSession(trimmed);
  };

  const onJoin = (e?: FormEvent) => {
    e?.preventDefault();
    if (!trimmed || !code.trim()) return;
    remember();
    rt.joinSession(code, trimmed);
  };

  return (
    <main className="landing">
      <div className="landing__glow" aria-hidden />
      <header className="landing__top">
        <Brand />
        <ConnectionPill state={rt.connection} />
      </header>

      <section className="landing__hero">
        <p className="eyebrow">GDG FCRIT · Bit N Build 2026</p>
        <h1 className="landing__title">
          Every voice at the table,
          <br />
          <span className="gradient-text">captioned live.</span>
        </h1>
        <p className="landing__lede">
          Start a session, share the code, and everyone’s speech appears as real-time captions — attributed to the
          person who said it. Powered by Gemini Live transcription.
        </p>
      </section>

      <section className="card landing__card" aria-label="Create or join a session">
        <label className="field">
          <span className="field__label">Your display name</span>
          <input
            id="display-name"
            className="input"
            placeholder="e.g. Aditi Sharma"
            maxLength={40}
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (code.trim().length >= 4) onJoin();
                else if (!code.trim()) onCreate();
              }
            }}
          />
        </label>

        <div className="landing__actions">
          <div className="landing__block">
            <h2 className="block__title">Start a new table</h2>
            <p className="block__hint">You’ll get a short code to share.</p>
            <button id="create-session" className="btn btn--primary" disabled={!ready || !trimmed} onClick={onCreate}>
              {rt.pending ? 'Working…' : 'Create session'}
            </button>
          </div>

          <div className="landing__divider" aria-hidden>
            <span>or</span>
          </div>

          <form className="landing__block" onSubmit={onJoin}>
            <h2 className="block__title">Join a table</h2>
            <p className="block__hint">Enter the code someone shared with you.</p>
            <div className="join-row">
              <input
                id="session-code"
                className="input input--code"
                placeholder="ABC123"
                maxLength={8}
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
              <button
                id="join-session"
                type="submit"
                className="btn btn--secondary"
                disabled={!ready || !trimmed || code.length < 4}
              >
                Join
              </button>
            </div>
          </form>
        </div>

        {rt.error && (
          <p className="alert" role="alert" id="landing-error">
            {rt.error}
          </p>
        )}
      </section>
    </main>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span>Roundtable</span>
    </div>
  );
}
