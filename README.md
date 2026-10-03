# Roundtable

Roundtable is a real-time multi-participant conversation captioning web application designed to give every participant a voice at the table. Built with React, Node.js, WebSockets, and Google's Gemini Live transcription API, it enables people in a shared conversation to speak into their own devices, stream microphone audio to a centralized backend, and view live, speaker-attributed captions synchronized across every screen in real time.

## Problem

Accurately captioning in-person or hybrid group conversations is a major accessibility and collaboration challenge. When multiple people sit around a table and speak from different angles, distances, and devices, traditional single-microphone setups frequently struggle with overlapping speech, background acoustics, and speaker identification. Disentangling who said what requires capturing clear individual audio streams while maintaining low latency and cohesive shared context across all participants.

## Solution

Roundtable addresses this by turning each participant's device into a dedicated microphone node in a synchronized session:
1. Participants create or join a shared conversation room using a short session code or invite link.
2. Each participant's browser captures local microphone audio, converts it client-side into 16 kHz 16-bit mono PCM via an AudioWorklet, and streams it to the Node.js backend over a WebSocket connection.
3. The server maintains in-memory session and participant registries, establishing an independent bidirectional streaming session with the Gemini Live transcription API for each active speaker.
4. As Gemini produces interim hypotheses and finalized text, the backend attaches the speaker's participant ID and display name, broadcasting updates to all connected participants in the room for instant, attributed display.

## Key Features

- **Multi-participant sessions**: Multiple users can join the same conversation space simultaneously.
- **Session creation and joining by short code**: Quick session creation with unambiguous 6-character codes (e.g., `WURVV8`), plus support for joining via shareable invite URLs (`?code=...`).
- **Participant names and presence**: Display names attached to all events, with live visual indicators showing who is currently at the table and whose microphone is active.
- **Browser microphone capture**: Seamless microphone access using standard Web Audio APIs.
- **Client-side AudioWorklet processing**: Real-time resampling from the device's native sample rate down to 16 kHz, 16-bit signed little-endian mono PCM in 100 ms chunks without blocking the main UI thread.
- **Realtime WebSocket streaming**: Binary audio transmission directly to the server with low latency and minimal protocol overhead.
- **Gemini Live transcription**: Server-side bidirectional integration with Gemini's dedicated live speech-to-text pipeline (`gemini-3.5-transcribe-live`).
- **Domain vocabulary biasing**: Built-in speech recognition biasing for domain-specific terminology (`Roundtable`, `Bit N Build`, `GDG`, `FCRIT`, `Gemini`).
- **Interim and final transcript states**: Real-time speculative hypotheses appear immediately with italic styling and live pulse indicators, seamlessly transitioning into authoritative finalized captions once speech segments complete.
- **Speaker attribution**: Every caption segment displays the speaker's name, timestamp, and a consistent avatar accent color.
- **Shared transcript updates**: All participants in a room see identical, synchronized captions as conversation unfolds.
- **Automatic reconnect and session continuity**: Client WebSocket layer automatically handles transient disconnections and silently rejoins the active session upon reconnection.
- **Connection and status indicators**: Clear visual feedback for server connectivity, live microphone volume meter (RMS), and Gemini transcription states (`idle`, `connecting`, `live`, `error`).
- **Invite link copying**: One-click copying of session codes and invite links directly to the clipboard with fallback support.

## Architecture

```
[ Browser Client 1 (Alice) ]         [ Browser Client 2 (Bob) ]
  │                                    │
  ├─ Microphone (Web Audio)            ├─ Microphone (Web Audio)
  ├─ AudioWorklet (16kHz PCM16)        ├─ AudioWorklet (16kHz PCM16)
  └─ WebSocket Client                  └─ WebSocket Client
            │                                    │
            │  (JSON control + Binary PCM)       │
            └──────────────┬─────────────────────┘
                           ▼
                  [ Node.js Backend ]
                     │  - HTTP server & static hosting
                     │  - WebSocket Server (/ws)
                     │  - In-memory Session Registry
                     │  - Audio routing & fan-out broadcast
                     │
            ┌────────┴────────┐
            │                 │
            ▼                 ▼
   [ Gemini Live Stream ]  [ Gemini Live Stream ]
      (Alice's audio)         (Bob's audio)
            │                       │
            └───────────┬───────────┘
                        ▼
           gemini-3.5-transcribe-live
```

The codebase is organized into three clean layers:
- `client/`: React + Vite single-page application containing UI views (`Landing`, `Room`, `TranscriptView`, `ConnectionPill`), state management hook (`useRoundtable`), microphone capture (`micStreamer`), and the downsampling processor (`public/pcm-capture-worklet.js`).
- `server/`: Node.js server managing HTTP/WebSocket endpoints (`src/index.ts`), in-memory session state (`src/sessions.ts`), server configuration (`src/config.ts`), and per-participant streaming sessions with `@google/genai` (`src/transcriber.ts`).
- `shared/`: TypeScript definitions (`protocol.ts`) specifying the shared wire protocol, message shapes, and audio constants used by both frontend and backend.

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Vanilla CSS design system with glassmorphic dark theme and Google Fonts (*Space Grotesk*, *Inter*, *JetBrains Mono*)
- **Audio Capture**: Web Audio API (`AudioContext`, `AudioWorkletNode`, `MediaStream`)
- **Backend**: Node.js (ES Modules), TypeScript, `tsx`
- **Networking**: WebSockets via `ws`
- **AI SDK**: Official `@google/genai` JavaScript SDK
- **Speech Model**: `gemini-3.5-transcribe-live`
- **Tooling**: `concurrently` (dev orchestration), `oxlint` (client linting)

## Gemini Integration

All interactions with Google's Gemini Live API take place strictly on the server:
- The backend initializes the `@google/genai` client using the secret server-side environment variable:
  ```text
  GEMINI_API_KEY
  ```
- The API key is **never** sent to the client, included in client bundles, or exposed in client-facing network responses.
- The server opens a bidirectional live session configuring `responseModalities: ['TEXT']` and enabling `inputAudioTranscription`.

## Environment Setup

Create a `.env` file at the repository root:

```text
GEMINI_API_KEY=your_key_here
```

> **Security Note**: The `.env` file contains sensitive credentials and is explicitly ignored by [`.gitignore`](file:///.gitignore). Never commit `.env` to version control. The repository includes [`.env.example`](file:///.env.example) as a safe template.

## Getting Started

### Prerequisites

- Node.js LTS (v20+ or v24+ recommended) and npm available in your environment.
- If using a locally installed Node binary:
  ```bash
  export PATH=~/.local/node/bin:$PATH
  ```

### Installation & Running Locally

1. Install dependencies across all workspaces:
   ```bash
   npm install
   ```

2. Start the development environment:
   ```bash
   npm run dev
   ```

This concurrently launches:
- **Frontend (Vite dev server)**: `http://localhost:5173` (proxies `/ws` and `/api` to the backend)
- **Backend (Node.js + tsx)**: `http://localhost:8787` (WebSocket listener at `/ws`)

Open `http://localhost:5173` in your browser.

## Testing

Run the validation suite with:

```bash
# Typecheck server and build client production bundle
npm run build

# Lint client code
npm run lint

# Run end-to-end multi-participant integration test
npm test
```

### Multi-Participant Integration Test
The automated test (`server/scripts/multi-participant-test.ts`) simulates two concurrent participants ("Alice" and "Bob") connecting over WebSockets:
1. Alice creates a session and receives a generated session code.
2. Bob joins the session using Alice's session code.
3. Both participants verify the shared participant roster.
4. Alice streams sample speech PCM audio through the backend to the live Gemini API.
5. The test verifies that both Alice and Bob receive live interim and final transcript events properly attributed to Alice.
6. Alice leaves the session, and Bob verifies that the room roster updates immediately.

## Demo Flow

1. Open `http://localhost:5173` in Browser 1.
2. Enter a display name (e.g., "Alice") and click **Create session**.
3. Copy the 6-character session code (or click **Invite link**).
4. Open `http://localhost:5173` in Browser 2 (or on a second device on the same local network).
5. Enter a display name (e.g., "Bob"), enter the session code, and click **Join**.
6. Both screens will display the shared participant roster in real time.
7. Click **Start microphone** on either participant's screen and grant microphone permissions when prompted.
8. Speak into the microphone.
9. Watch interim hypotheses appear dynamically with live status tags, settling into finalized, speaker-attributed captions across all connected screens.

## Current Limitations

Roundtable is currently scoped as a functional hackathon prototype:
- **In-memory session state**: Sessions are held in server memory; restarting the server clears active rooms and history.
- **No persistent database**: Transcripts and user identities are ephemeral and exist only for the session lifetime.
- **No user authentication**: Participants are identified solely by session display names without password or OAuth verification.
- **No audio recording storage**: Audio frames are streamed directly to Gemini in real time and are not saved to disk or object storage.
- **Acoustic variations**: Recognition accuracy depends on ambient room noise and device microphone quality.
- **Single-channel capture per device**: Advanced multi-device acoustic beamforming, source separation, and physical cross-device echo cancellation are not implemented in this MVP.

## Future Scope

- **Multi-device acoustic fusion**: Cross-correlating audio arriving at multiple devices to filter out echo, isolate speakers in close proximity, and handle overlapping cross-talk.
- **Automated meeting intelligence**: Post-session action item extraction, meeting minutes, and AI summaries generated with Gemini models.
- **Persistent storage & export**: Exporting conversation transcripts as Markdown, PDF, or WebVTT subtitles, backed by a persistent database.
- **User authentication & access control**: Named user accounts, session permissions, and secure room passcodes.
- **Cloud deployment & scaling**: Redis-backed pub/sub adapters to support horizontal scaling across multi-region server clusters.

## Hackathon

Roundtable was created for the **GDG FCRIT Bit N Build 2026** hackathon under the live captioning for group conversations problem statement theme.

*Note: This project is a functional hackathon prototype demonstrating low-latency, multi-speaker conversational captioning with Google's Gemini Live API.*
