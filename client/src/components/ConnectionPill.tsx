import type { ConnectionState } from '../lib/useRoundtable.ts';

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected — retrying',
};

export function ConnectionPill({ state }: { state: ConnectionState }) {
  return (
    <span className={`pill pill--${state}`} id="connection-status" role="status" aria-live="polite">
      <span className="pill__dot" />
      {LABEL[state]}
    </span>
  );
}
