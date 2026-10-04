import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  ParticipantInfo,
  ServerMessage,
  TranscriberStatus,
  TranscriptEvent,
} from '../../../shared/protocol.ts';
import { MicStreamer } from './micStreamer.ts';
import type { MeetingRecord } from './transcriptExport.ts';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface SessionState {
  code: string;
  participantId: string;
  name: string;
}

const RECONNECT_DELAY_MS = 1500;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Insert or replace a transcript event by segmentId, preserving order. */
function upsert(list: TranscriptEvent[], ev: TranscriptEvent): TranscriptEvent[] {
  const idx = list.findIndex((e) => e.segmentId === ev.segmentId);
  if (idx === -1) return [...list, ev];
  // Never let a late interim overwrite an already-final segment.
  if (list[idx].isFinal && !ev.isFinal) return list;
  const next = list.slice();
  next[idx] = ev;
  return next;
}

export function useRoundtable() {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [session, setSession] = useState<SessionState | null>(null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [transcriber, setTranscriber] = useState<{ status: TranscriberStatus; message?: string }>({
    status: 'idle',
  });
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Client time this user joined the current session (stable across silent rejoins). */
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  /** Set after "End meeting"; holds the snapshot shown on the summary screen. */
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicStreamer | null>(null);
  /** Remembered so we can transparently rejoin after a dropped socket. */
  const rejoinRef = useRef<{ code: string; name: string } | null>(null);
  const pendingNameRef = useRef<string>('');

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const stopMicLocal = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setMicOn(false);
    setLevel(0);
  }, []);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setConnection('connecting');
      const ws = new WebSocket(wsUrl());
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setConnection('open');
        const rejoin = rejoinRef.current;
        if (rejoin) {
          pendingNameRef.current = rejoin.name;
          ws.send(JSON.stringify({ type: 'join_session', ...rejoin } satisfies ClientMessage));
        }
      };

      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const msg = JSON.parse(e.data) as ServerMessage;
        switch (msg.type) {
          case 'joined': {
            setPending(false);
            setError(null);
            const myName = msg.participantName || pendingNameRef.current;
            const isRejoin = rejoinRef.current?.code === msg.sessionCode;
            if (!isRejoin) setJoinedAt(Date.now());
            setSession({ code: msg.sessionCode, participantId: msg.participantId, name: myName });
            rejoinRef.current = { code: msg.sessionCode, name: myName };
            setParticipants(msg.participants);
            setTranscript((prev) => msg.history.reduce(upsert, prev));
            break;
          }
          case 'participants':
            setParticipants(msg.participants);
            break;
          case 'transcript':
            setTranscript((prev) => upsert(prev, msg.event));
            break;
          case 'transcript_translation':
            setTranscript((prev) =>
              prev.map((item) =>
                item.segmentId === msg.segmentId
                  ? {
                      ...item,
                      translation: msg.translation,
                      language: msg.language ?? item.language,
                    }
                  : item,
              ),
            );
            break;
          case 'transcriber_status':
            setTranscriber({ status: msg.status, message: msg.message });
            if (msg.status === 'error') stopMicLocal();
            break;
          case 'error':
            setPending(false);
            setError(msg.message);
            // A failed auto-rejoin (e.g. server restarted) shouldn't loop forever.
            if (rejoinRef.current && msg.message.startsWith('Session not found')) {
              rejoinRef.current = null;
              setSession(null);
            }
            break;
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        stopMicLocal();
        setTranscriber({ status: 'idle' });
        setPending(false);
        if (disposed) return;
        setConnection('closed');
        retry = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      wsRef.current?.close();
      micRef.current?.stop();
    };
  }, [stopMicLocal]);

  const createSession = useCallback(
    (name: string) => {
      pendingNameRef.current = name.trim();
      setPending(true);
      setError(null);
      send({ type: 'create_session', name });
    },
    [send],
  );

  const joinSession = useCallback(
    (code: string, name: string) => {
      pendingNameRef.current = name.trim();
      setPending(true);
      setError(null);
      send({ type: 'join_session', code, name });
    },
    [send],
  );

  const startMic = useCallback(async () => {
    if (micRef.current) return;
    setError(null);
    const mic = new MicStreamer();
    try {
      await mic.start(
        (pcm) => {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) ws.send(pcm);
        },
        (lv) => setLevel(lv),
      );
    } catch (err) {
      mic.stop();
      setError((err as Error).message);
      return;
    }
    micRef.current = mic;
    setMicOn(true);
    // Sent after permission is granted; audio frames follow on the same socket, so ordering is preserved.
    send({ type: 'start_audio' });
  }, [send]);

  const stopMic = useCallback(() => {
    stopMicLocal();
    send({ type: 'stop_audio' });
  }, [send, stopMicLocal]);

  const leaveSession = useCallback(() => {
    rejoinRef.current = null;
    stopMicLocal();
    send({ type: 'leave_session' });
    setSession(null);
    setParticipants([]);
    setTranscript([]);
    setTranscriber({ status: 'idle' });
    setJoinedAt(null);
  }, [send, stopMicLocal]);

  // Latest values for the async endMeeting flow (avoids stale closures).
  const latest = useRef({ transcript, participants, session, joinedAt });
  useEffect(() => {
    latest.current = { transcript, participants, session, joinedAt };
  });

  const [ending, setEnding] = useState(false);

  /**
   * Ends the meeting for this user: stops the mic, lets Gemini flush the
   * final segment of any in-progress utterance, snapshots the transcript the
   * client already holds, then leaves the session. Other participants continue.
   */
  const endMeeting = useCallback(async () => {
    if (!latest.current.session || ending) return;
    setEnding(true);
    const wasLive = micRef.current !== null;
    if (wasLive) {
      stopMicLocal();
      send({ type: 'stop_audio' });
      // The server keeps the Gemini stream open ~1.5 s after audioStreamEnd.
      await new Promise((r) => setTimeout(r, 1800));
    }
    const { transcript: segs, participants: roster, session: s, joinedAt: started } = latest.current;
    if (s) {
      setMeeting({
        sessionCode: s.code,
        joinedAt: started ?? Date.now(),
        endedAt: Date.now(),
        rosterAtEnd: roster,
        segments: segs,
      });
    }
    leaveSession();
    setEnding(false);
  }, [ending, leaveSession, send, stopMicLocal]);

  const closeSummary = useCallback(() => setMeeting(null), []);

  return {
    connection,
    session,
    participants,
    transcript,
    transcriber,
    micOn,
    level,
    error,
    pending,
    joinedAt,
    meeting,
    ending,
    dismissError: () => setError(null),
    createSession,
    joinSession,
    startMic,
    stopMic,
    leaveSession,
    endMeeting,
    closeSummary,
  };
}

export type Roundtable = ReturnType<typeof useRoundtable>;
