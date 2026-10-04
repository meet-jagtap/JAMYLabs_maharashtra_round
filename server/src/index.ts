import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, TranscriberStatus } from '../../shared/protocol.ts';
import { CLIENT_DIST, GEMINI_API_KEY, GEMINI_TRANSCRIBE_MODEL, PORT } from './config.ts';
import { SessionStore, type Participant, type Session } from './sessions.ts';
import { GeminiTranscriber } from './transcriber.ts';
import { translateToEnglish } from './translator.ts';
import { sendTranscriptEmail } from './email.ts';

const MAX_NAME_LENGTH = 40;
/** 100 ms of 16 kHz PCM16 is 3200 bytes; allow generous headroom. */
const MAX_AUDIO_FRAME_BYTES = 64 * 1024;

const store = new SessionStore();

// ---------------------------------------------------------------------------
// HTTP: health check + (optional) static hosting of the built client.
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Handle CORS preflight for API requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    // Reports only whether a key is configured — never the key itself.
    res.end(JSON.stringify({ ok: true, geminiConfigured: Boolean(GEMINI_API_KEY), model: GEMINI_TRANSCRIBE_MODEL }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/send-transcript') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const result = await sendTranscriptEmail(payload.email, payload.meeting);
        res.writeHead(result.ok ? 200 : 400, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        });
        res.end(JSON.stringify({ ok: false, message: 'Invalid request body.' }));
      }
    });
    return;
  }

  // Serve client/dist in production (`npm run build && npm start`).
  if (fs.existsSync(CLIENT_DIST)) {
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = path.join(CLIENT_DIST, rel);
    if (!file.startsWith(CLIENT_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(CLIENT_DIST, 'index.html'); // SPA fallback
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Roundtable API. Run the client with `npm run dev`.');
});

// ---------------------------------------------------------------------------
// WebSocket: sessions, audio ingest, transcript fan-out.
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_AUDIO_FRAME_BYTES });

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name.length ? name : null;
}

wss.on('connection', (socket) => {
  let session: Session | null = null;
  let me: Participant | null = null;
  let alive = true;

  socket.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, 30_000);

  const join = (target: Session, name: string) => {
    session = target;
    me = store.addParticipant(target, name, socket);
    send(socket, {
      type: 'joined',
      sessionCode: target.code,
      participantId: me.id,
      participantName: me.name,
      participants: store.participantList(target),
      history: target.history,
    });
    store.broadcastParticipants(target);
  };

  const startAudio = async () => {
    if (!session || !me || me.transcriber) return;
    const s = session;
    const p = me;
    const status = (st: TranscriberStatus, message?: string) => {
      send(socket, { type: 'transcriber_status', status: st, message });
      if (st === 'error' && p.transcriber) {
        p.transcriber = null;
        store.broadcastParticipants(s);
      }
    };

    if (!GEMINI_API_KEY) {
      status('error', 'Server is missing GEMINI_API_KEY. Add it to .env and restart the server.');
      return;
    }

    p.transcriber = new GeminiTranscriber(`${s.code}/${p.name}`, {
      onStatus: status,
      onTranscript: (u) => {
        store.recordTranscript(s, {
          segmentId: u.segmentId,
          participantId: p.id,
          participantName: p.name,
          text: u.text,
          isFinal: u.isFinal,
          timestamp: Date.now(),
          language: u.language,
        });

        // Real-time English translation for finalized non-English speech
        if (u.isFinal && u.language && u.language !== 'en' && u.text.trim()) {
          const segId = u.segmentId;
          const textToTranslate = u.text;
          const lang = u.language;
          void (async () => {
            try {
              const translation = await translateToEnglish(textToTranslate, lang);
              if (translation) {
                store.updateTranscriptTranslation(s, segId, translation, lang);
              }
            } catch {
              // Graceful fallback: original transcript is completely unaffected
            }
          })();
        }
      },
    });
    store.broadcastParticipants(s);
    await p.transcriber.start();
  };

  const stopAudio = () => {
    if (!session || !me?.transcriber) return;
    me.transcriber.stop();
    me.transcriber = null;
    store.broadcastParticipants(session);
  };

  socket.on('message', (data: RawData, isBinary: boolean) => {
    // Binary frame = raw PCM16 audio for this participant's Gemini stream.
    if (isBinary) {
      if (me?.transcriber) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        me.transcriber.pushAudio(buf);
      }
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return send(socket, { type: 'error', message: 'Malformed message.' });
    }

    switch (msg.type) {
      case 'create_session': {
        if (session) return send(socket, { type: 'error', message: 'Already in a session.' });
        const name = cleanName(msg.name);
        if (!name) return send(socket, { type: 'error', message: 'Please enter a display name.' });
        join(store.create(), name);
        break;
      }
      case 'join_session': {
        if (session) return send(socket, { type: 'error', message: 'Already in a session.' });
        const name = cleanName(msg.name);
        if (!name) return send(socket, { type: 'error', message: 'Please enter a display name.' });
        const target = typeof msg.code === 'string' ? store.get(msg.code) : undefined;
        if (!target) return send(socket, { type: 'error', message: 'Session not found. Check the code.' });
        join(target, name);
        break;
      }
      case 'start_audio':
        void startAudio();
        break;
      case 'stop_audio':
        stopAudio();
        break;
      case 'leave_session':
        if (session && me) {
          store.removeParticipant(session, me.id);
          session = null;
          me = null;
        }
        break;
      default:
        send(socket, { type: 'error', message: 'Unknown message type.' });
    }
  });

  socket.on('close', () => {
    clearInterval(heartbeat);
    if (session && me) store.removeParticipant(session, me.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Roundtable server listening on http://localhost:${PORT}  (ws path: /ws)`);
  console.log(`Gemini model: ${GEMINI_TRANSCRIBE_MODEL}`);
  if (!GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
});
