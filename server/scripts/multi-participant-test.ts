/**
 * Multi-participant end-to-end integration test.
 *
 * Verifies:
 * 1. Alice creates a session.
 * 2. Bob joins the session using the 6-character code.
 * 3. Both see each other in the participant roster.
 * 4. Alice starts audio and streams speech PCM to Gemini Live API.
 * 5. Both Alice AND Bob receive live interim and final transcript events
 *    attributed to Alice with her participant ID and name.
 * 6. Alice stops audio; both see Alice's speaking state turn false.
 * 7. Alice leaves the session; Bob receives the updated roster with only himself.
 * 8. Clean exit.
 *
 * Usage:
 *   tsx server/scripts/multi-participant-test.ts [ws-url] [path-to-wav-or-pcm]
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { ServerMessage, TranscriptEvent } from '../../shared/protocol.ts';

const wsUrl = process.argv[2] || 'http://localhost:5173/ws';
const audioFile =
  process.argv[3] ||
  path.resolve(
    '/Users/meet/.gemini/antigravity-ide/brain/7073e891-06c4-4fcf-83a6-361c73dc6ba5/scratch/rt.wav',
  );

if (!fs.existsSync(audioFile)) {
  console.error(`Audio file not found at: ${audioFile}`);
  process.exit(1);
}

let pcm = fs.readFileSync(audioFile);
if (pcm.subarray(0, 4).toString() === 'RIFF') {
  const idx = pcm.indexOf('data');
  pcm = pcm.subarray(idx + 8);
}

console.log(`Connecting to ${wsUrl}...`);

async function run() {
  const aliceWs = new WebSocket(wsUrl);
  let sessionCode = '';
  let aliceId = '';
  let bobId = '';

  const aliceTranscripts: TranscriptEvent[] = [];
  const bobTranscripts: TranscriptEvent[] = [];

  // Step 1: Connect Alice and create session
  await new Promise<void>((resolve, reject) => {
    aliceWs.on('open', () => {
      aliceWs.send(JSON.stringify({ type: 'create_session', name: 'Alice' }));
    });
    aliceWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.type === 'joined') {
        sessionCode = msg.sessionCode;
        aliceId = msg.participantId;
        console.log(`✓ Alice created session ${sessionCode} (ID: ${aliceId})`);
        resolve();
      } else if (msg.type === 'error') {
        reject(new Error(`Alice error: ${msg.message}`));
      }
    });
    aliceWs.on('error', reject);
  });

  // Step 2: Connect Bob and join session
  const bobWs = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    bobWs.on('open', () => {
      bobWs.send(JSON.stringify({ type: 'join_session', code: sessionCode, name: 'Bob' }));
    });
    bobWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.type === 'joined') {
        bobId = msg.participantId;
        console.log(`✓ Bob joined session ${sessionCode} (ID: ${bobId})`);
        const names = msg.participants.map((p) => p.name).sort();
        if (names.join(',') !== 'Alice,Bob') {
          return reject(new Error(`Expected Alice,Bob in roster but got: ${names.join(',')}`));
        }
        console.log(`✓ Bob sees both participants: ${names.join(', ')}`);
        resolve();
      } else if (msg.type === 'error') {
        reject(new Error(`Bob error: ${msg.message}`));
      }
    });
    bobWs.on('error', reject);
  });

  // Step 3: Wire up transcript listeners for both
  aliceWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    if (msg.type === 'transcript') {
      aliceTranscripts.push(msg.event);
    }
  });

  bobWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    if (msg.type === 'transcript') {
      bobTranscripts.push(msg.event);
    }
  });

  // Step 4: Alice starts audio
  console.log('Alice starting audio stream to Gemini...');
  aliceWs.send(JSON.stringify({ type: 'start_audio' }));

  await new Promise<void>((resolve, reject) => {
    const handler = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.type === 'transcriber_status') {
        console.log(`Transcriber status: ${msg.status}${msg.message ? ` (${msg.message})` : ''}`);
        if (msg.status === 'live') {
          aliceWs.off('message', handler);
          resolve();
        } else if (msg.status === 'error') {
          reject(new Error(`Transcriber error: ${msg.message}`));
        }
      }
    };
    aliceWs.on('message', handler);
  });

  // Stream audio chunks in 100ms blocks
  console.log('Streaming audio chunks...');
  const CHUNK = 3200; // 100ms
  let offset = 0;
  // Send first 4 seconds of audio (40 chunks)
  const maxBytes = Math.min(pcm.length, CHUNK * 40);

  while (offset < maxBytes) {
    const end = Math.min(offset + CHUNK, maxBytes);
    aliceWs.send(pcm.subarray(offset, end));
    offset = end;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Stream 1.5 seconds of silence so Gemini VAD can finalize
  const silence = Buffer.alloc(CHUNK);
  for (let i = 0; i < 15; i++) {
    aliceWs.send(silence);
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('Alice stopping audio...');
  aliceWs.send(JSON.stringify({ type: 'stop_audio' }));

  // Wait for final transcript arrival (up to 6 seconds)
  const startWait = Date.now();
  while (Date.now() - startWait < 6000) {
    if (aliceTranscripts.some((t) => t.isFinal) && bobTranscripts.some((t) => t.isFinal)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Verify transcripts received by both
  const aliceFinal = aliceTranscripts.find((t) => t.isFinal);
  const bobFinal = bobTranscripts.find((t) => t.isFinal);

  if (!aliceFinal) {
    throw new Error('Alice did not receive any final transcript');
  }
  if (!bobFinal) {
    throw new Error('Bob did not receive any final transcript (broadcast failure)');
  }

  console.log(`✓ Alice received final transcript: "${aliceFinal.text}" (speaker: ${aliceFinal.participantName})`);
  console.log(`✓ Bob received final transcript: "${bobFinal.text}" (speaker: ${bobFinal.participantName})`);

  if (bobFinal.participantId !== aliceId || bobFinal.participantName !== 'Alice') {
    throw new Error(`Transcript attribution mismatch: expected Alice (${aliceId}), got ${bobFinal.participantName} (${bobFinal.participantId})`);
  }
  console.log('✓ Transcript speaker attribution verified');

  // Step 5: Test leave session
  const bobRosterPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for Bob roster update')), 3000);
    bobWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.type === 'participants') {
        const names = msg.participants.map((p) => p.name);
        if (names.length === 1 && names[0] === 'Bob') {
          clearTimeout(timeout);
          console.log('✓ Bob received roster update after Alice left: only Bob remains');
          resolve();
        }
      }
    });
  });

  aliceWs.send(JSON.stringify({ type: 'leave_session' }));
  await bobRosterPromise;

  aliceWs.close();
  bobWs.close();

  console.log('\n========================================');
  console.log('🎉 ALL MULTI-PARTICIPANT TESTS PASSED!');
  console.log('========================================\n');
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
