import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ParticipantInfo, ServerMessage, TranscriptEvent } from '../../shared/protocol.ts';
import type { GeminiTranscriber } from './transcriber.ts';

/** Unambiguous characters (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const HISTORY_LIMIT = 200;
/** Keep an empty session around briefly so a refresh can rejoin it. */
const EMPTY_SESSION_TTL_MS = 10 * 60 * 1000;

export interface Participant {
  id: string;
  name: string;
  socket: WebSocket;
  transcriber: GeminiTranscriber | null;
}

export interface Session {
  code: string;
  participants: Map<string, Participant>;
  history: TranscriptEvent[];
  emptyTimer: NodeJS.Timeout | null;
}

/** Minimal in-memory session registry. State is lost on server restart. */
export class SessionStore {
  private sessions = new Map<string, Session>();

  create(): Session {
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.sessions.has(code));
    const session: Session = { code, participants: new Map(), history: [], emptyTimer: null };
    this.sessions.set(code, session);
    console.log(`[session] created ${code}`);
    return session;
  }

  get(code: string): Session | undefined {
    return this.sessions.get(normalizeCode(code));
  }

  addParticipant(session: Session, name: string, socket: WebSocket): Participant {
    if (session.emptyTimer) {
      clearTimeout(session.emptyTimer);
      session.emptyTimer = null;
    }
    const participant: Participant = { id: randomUUID(), name, socket, transcriber: null };
    session.participants.set(participant.id, participant);
    console.log(`[session] ${session.code}: "${name}" joined (${session.participants.size} present)`);
    return participant;
  }

  removeParticipant(session: Session, participantId: string): void {
    const p = session.participants.get(participantId);
    if (!p) return;
    p.transcriber?.stop();
    p.transcriber = null;
    session.participants.delete(participantId);
    console.log(`[session] ${session.code}: "${p.name}" left (${session.participants.size} present)`);

    if (session.participants.size === 0) {
      session.emptyTimer = setTimeout(() => {
        if (session.participants.size === 0) {
          this.sessions.delete(session.code);
          console.log(`[session] expired ${session.code}`);
        }
      }, EMPTY_SESSION_TTL_MS);
    } else {
      this.broadcastParticipants(session);
    }
  }

  recordTranscript(session: Session, event: TranscriptEvent): void {
    if (event.isFinal) {
      session.history.push(event);
      if (session.history.length > HISTORY_LIMIT) session.history.shift();
    }
    this.broadcast(session, { type: 'transcript', event });
  }

  participantList(session: Session): ParticipantInfo[] {
    return [...session.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      speaking: p.transcriber !== null,
    }));
  }

  broadcastParticipants(session: Session): void {
    this.broadcast(session, { type: 'participants', participants: this.participantList(session) });
  }

  broadcast(session: Session, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const p of session.participants.values()) {
      if (p.socket.readyState === p.socket.OPEN) p.socket.send(data);
    }
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
