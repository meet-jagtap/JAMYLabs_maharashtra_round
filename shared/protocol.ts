/**
 * Wire protocol shared by the browser client and the Node server.
 *
 * Transport: a single WebSocket per browser tab at `/ws`.
 *  - JSON text frames carry control messages (below).
 *  - Binary frames (client -> server only) carry raw microphone audio:
 *    16-bit signed little-endian PCM, mono, 16 kHz.
 */

export const AUDIO_SAMPLE_RATE = 16000;

export interface ParticipantInfo {
  id: string;
  name: string;
  /** True while this participant's mic is streaming to Gemini. */
  speaking: boolean;
}

export type TranscriberStatus = 'idle' | 'connecting' | 'live' | 'error';

export interface TranscriptEvent {
  /** Stable id for one utterance; interim updates and the final share it. */
  segmentId: string;
  participantId: string;
  participantName: string;
  text: string;
  /** false = interim (speculative) hypothesis, true = finalized text. */
  isFinal: boolean;
  /** Server epoch ms when the event was produced. */
  timestamp: number;
  /** Detected language code: 'en' | 'hi' | 'mr' | 'gu' */
  language?: string;
  /** English translation for finalized non-English segments. */
  translation?: string;
}

// ---------- client -> server ----------

export type ClientMessage =
  | { type: 'create_session'; name: string }
  | { type: 'join_session'; code: string; name: string }
  | { type: 'start_audio' }
  | { type: 'stop_audio' }
  | { type: 'leave_session' };

// ---------- server -> client ----------

export type ServerMessage =
  | {
      type: 'joined';
      sessionCode: string;
      participantId: string;
      participantName: string;
      participants: ParticipantInfo[];
      /** Recent finalized transcript for late joiners. */
      history: TranscriptEvent[];
    }
  | { type: 'participants'; participants: ParticipantInfo[] }
  | { type: 'transcript'; event: TranscriptEvent }
  | { type: 'transcript_translation'; segmentId: string; translation: string; language?: string }
  | { type: 'transcriber_status'; status: TranscriberStatus; message?: string }
  | { type: 'error'; message: string };
