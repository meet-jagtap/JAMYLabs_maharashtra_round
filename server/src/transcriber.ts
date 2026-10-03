import { randomUUID } from 'node:crypto';
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { AUDIO_SAMPLE_RATE, type TranscriberStatus } from '../../shared/protocol.ts';
import { DEBUG, GEMINI_API_KEY, GEMINI_TRANSCRIBE_MODEL } from './config.ts';

const AUDIO_MIME = `audio/pcm;rate=${AUDIO_SAMPLE_RATE}`;
/** Max audio buffered while (re)connecting: ~5 s of 16 kHz 16-bit mono. */
const MAX_PENDING_BYTES = AUDIO_SAMPLE_RATE * 2 * 5;
const MAX_RECONNECT_ATTEMPTS = 3;
/** Terms Gemini should favour when transcribing (speech biasing). */
const CUSTOM_VOCABULARY = ['Roundtable', 'Bit N Build', 'GDG', 'FCRIT', 'Gemini'];

let ai: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server (.env).');
  ai ??= new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return ai;
}

export interface TranscriptUpdate {
  segmentId: string;
  text: string;
  isFinal: boolean;
}

export interface TranscriberCallbacks {
  onTranscript: (update: TranscriptUpdate) => void;
  onStatus: (status: TranscriberStatus, message?: string) => void;
}

/**
 * One Gemini Live transcription stream for one participant.
 *
 * Audio in: raw 16 kHz 16-bit mono PCM buffers (forwarded as base64).
 * Out: interim + final transcript updates grouped into utterance segments.
 */
export class GeminiTranscriber {
  private session: Session | null = null;
  private connecting = false;
  private stopped = false;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private reconnectAttempts = 0;
  private segmentId: string | null = null;

  constructor(
    private readonly label: string,
    private readonly cb: TranscriberCallbacks,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  pushAudio(chunk: Buffer): void {
    if (this.stopped) return;
    if (this.session && !this.connecting) {
      this.send(chunk);
      return;
    }
    // Buffer while connecting so the first words aren't lost.
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    while (this.pendingBytes > MAX_PENDING_BYTES && this.pending.length) {
      this.pendingBytes -= this.pending.shift()!.length;
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pending = [];
    this.pendingBytes = 0;
    const s = this.session;
    this.session = null;
    if (s) {
      try {
        s.sendRealtimeInput({ audioStreamEnd: true });
      } catch {
        /* socket may already be closed */
      }
      // Give Gemini a moment to flush the final transcript before closing.
      setTimeout(() => {
        try {
          s.close();
        } catch {
          /* ignore */
        }
      }, 1500);
    }
    this.cb.onStatus('idle');
  }

  // ---------------------------------------------------------------------------

  private send(chunk: Buffer): void {
    try {
      this.session?.sendRealtimeInput({
        audio: { data: chunk.toString('base64'), mimeType: AUDIO_MIME },
      });
    } catch (err) {
      console.error(`[gemini:${this.label}] send failed`, err);
    }
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.stopped) return;
    this.connecting = true;
    this.cb.onStatus('connecting');

    // Holder so callbacks can identify which connection they belong to,
    // even if they fire before `live.connect()` resolves.
    const ref: { session: Session | null } = { session: null };

    try {
      const session = await getClient().live.connect({
        model: GEMINI_TRANSCRIBE_MODEL,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            languageCodes: [], // automatic language detection
            customVocabulary: CUSTOM_VOCABULARY,
          },
        },
        callbacks: {
          onopen: () => DEBUG && console.log(`[gemini:${this.label}] socket open`),
          onmessage: (msg) => this.handleMessage(ref.session, msg),
          onerror: (e) => console.error(`[gemini:${this.label}] error:`, e.message),
          onclose: (e) => this.handleClose(ref.session, e.code, e.reason),
        },
      });
      ref.session = session;
      this.connecting = false;

      if (this.stopped) {
        session.close();
        return;
      }
      this.session = session;
      this.reconnectAttempts = 0;
      console.log(`[gemini:${this.label}] connected (${GEMINI_TRANSCRIBE_MODEL})`);
      this.cb.onStatus('live');

      const queued = this.pending;
      this.pending = [];
      this.pendingBytes = 0;
      for (const chunk of queued) this.send(chunk);
    } catch (err) {
      this.connecting = false;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[gemini:${this.label}] connect failed: ${message}`);
      this.scheduleReconnect(message);
    }
  }

  private handleMessage(session: Session | null, msg: LiveServerMessage): void {
    if (DEBUG) console.log(`[gemini:${this.label}] <-`, JSON.stringify(msg));

    if (msg.goAway) {
      // Server is about to drop this connection; open a fresh one.
      console.log(`[gemini:${this.label}] goAway received, reconnecting`);
      if (session && this.session === session) {
        this.session = null;
        session.close();
        void this.connect();
      }
      return;
    }

    const content = msg.serverContent;
    if (!content) return;

    const interim = content.interimInputTranscription?.text;
    if (interim && interim.trim()) {
      this.segmentId ??= randomUUID();
      this.cb.onTranscript({ segmentId: this.segmentId, text: interim, isFinal: false });
    }

    const final = content.inputTranscription?.text;
    if (final && final.trim()) {
      const segmentId = this.segmentId ?? randomUUID();
      this.segmentId = null;
      this.cb.onTranscript({ segmentId, text: final.trim(), isFinal: true });
    }
  }

  private handleClose(session: Session | null, code: number, reason: string): void {
    console.log(`[gemini:${this.label}] closed code=${code} reason=${reason || '-'}`);
    // Only react if this is the active session closing unexpectedly.
    if (this.stopped || !session || this.session !== session) return;
    this.session = null;
    this.scheduleReconnect(reason || `connection closed (${code})`);
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.stopped = true;
      this.cb.onStatus('error', `Gemini transcription unavailable: ${reason}`);
      return;
    }
    this.reconnectAttempts++;
    const delay = 500 * 2 ** (this.reconnectAttempts - 1);
    this.cb.onStatus('connecting', `Reconnecting to Gemini (${reason})`);
    setTimeout(() => void this.connect(), delay);
  }
}
