/**
 * End-to-end smoke test (no browser / mic needed).
 *
 * Acts like a browser client: creates a session, starts audio, and streams a
 * raw 16 kHz PCM16 mono file through the Roundtable server to Gemini in
 * real-time 100 ms chunks, printing every transcript event it receives.
 *
 * Usage (server must be running):
 *   npm run smoke -w server -- path/to/audio.pcm [ws://localhost:8787/ws]
 *
 * Make a test file on macOS:
 *   say -o /tmp/rt.aiff "Hello from Roundtable"
 *   afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/rt.aiff /tmp/rt.wav   # WAV header is skipped automatically
 */
import fs from 'node:fs';
import WebSocket from 'ws';
import type { ServerMessage } from '../../shared/protocol.ts';

const [file, url = 'ws://localhost:8787/ws'] = process.argv.slice(2);
if (!file) {
  console.error('Usage: smoke-test <file.pcm|file.wav> [ws-url]');
  process.exit(1);
}

let pcm = fs.readFileSync(file);
// Skip a WAV header if present (find the "data" chunk).
if (pcm.subarray(0, 4).toString() === 'RIFF') {
  const idx = pcm.indexOf('data');
  pcm = pcm.subarray(idx + 8);
}

const CHUNK = 3200; // 100 ms @ 16 kHz * 2 bytes
const ws = new WebSocket(url);
let finals = 0;

ws.on('open', () => ws.send(JSON.stringify({ type: 'create_session', name: 'SmokeTest' })));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage;
  switch (msg.type) {
    case 'joined':
      console.log(`joined session ${msg.sessionCode} as ${msg.participantId}`);
      ws.send(JSON.stringify({ type: 'start_audio' }));
      break;
    case 'transcriber_status':
      console.log(`transcriber: ${msg.status}${msg.message ? ` (${msg.message})` : ''}`);
      if (msg.status === 'live') stream();
      if (msg.status === 'error') process.exit(2);
      break;
    case 'transcript':
      if (msg.event.isFinal) finals++;
      console.log(`${msg.event.isFinal ? 'FINAL  ' : 'interim'} [${msg.event.participantName}] ${msg.event.text}`);
      break;
    case 'error':
      console.error('server error:', msg.message);
      break;
  }
});

let streaming = false;
function stream() {
  if (streaming) return;
  streaming = true;
  let off = 0;
  const timer = setInterval(() => {
    if (off >= pcm.length) {
      clearInterval(timer);
      // Trail with 2 s of silence so server VAD can finalize, then stop.
      const silence = Buffer.alloc(CHUNK);
      let n = 0;
      const t2 = setInterval(() => {
        ws.send(silence);
        if (++n >= 20) {
          clearInterval(t2);
          ws.send(JSON.stringify({ type: 'stop_audio' }));
          setTimeout(() => {
            console.log(`done. final segments: ${finals}`);
            ws.close();
            process.exit(finals > 0 ? 0 : 3);
          }, 4000);
        }
      }, 100);
      return;
    }
    ws.send(pcm.subarray(off, off + CHUNK));
    off += CHUNK;
  }, 100);
}
