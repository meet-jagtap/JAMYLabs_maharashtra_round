import type { ParticipantInfo, TranscriptEvent } from '../../../shared/protocol.ts';

/** Snapshot of a meeting, built only from data the client already holds. */
export interface MeetingRecord {
  sessionCode: string;
  /** Client epoch ms when this user joined the session. */
  joinedAt: number;
  /** Client epoch ms when this user ended the meeting. */
  endedAt: number;
  /** Roster at the moment the meeting ended. */
  rosterAtEnd: ParticipantInfo[];
  /** Every transcript segment held by the client (final and interim). */
  segments: TranscriptEvent[];
}

export interface SpeakerShare {
  participantId: string;
  name: string;
  words: number;
  segments: number;
  /** 0..1 share of all final words. */
  share: number;
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function finalSegments(segments: TranscriptEvent[]): TranscriptEvent[] {
  return segments.filter((s) => s.isFinal);
}

/** Speaking distribution by participant, from FINAL segments' word counts. */
export function speakingDistribution(segments: TranscriptEvent[]): SpeakerShare[] {
  const byId = new Map<string, SpeakerShare>();
  let total = 0;
  for (const s of finalSegments(segments)) {
    const words = countWords(s.text);
    total += words;
    const entry = byId.get(s.participantId) ?? {
      participantId: s.participantId,
      name: s.participantName,
      words: 0,
      segments: 0,
      share: 0,
    };
    entry.words += words;
    entry.segments += 1;
    byId.set(s.participantId, entry);
  }
  const list = [...byId.values()];
  for (const e of list) e.share = total ? e.words / total : 0;
  return list.sort((a, b) => b.words - a.words);
}

/** Everyone known to have been in the meeting: final roster plus anyone who spoke. */
export function meetingParticipants(rec: MeetingRecord): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of rec.rosterAtEnd) seen.set(p.id, p.name);
  for (const s of rec.segments) if (!seen.has(s.participantId)) seen.set(s.participantId, s.participantName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

/**
 * Reference point for relative [mm:ss] offsets. Late joiners receive history
 * that predates their join time, so use whichever came first.
 */
function timelineStart(rec: MeetingRecord): number {
  const first = rec.segments.reduce((min, s) => Math.min(min, s.timestamp), Infinity);
  return Math.min(rec.joinedAt, first);
}

function ordered(rec: MeetingRecord): TranscriptEvent[] {
  return [...rec.segments].sort((a, b) => a.timestamp - b.timestamp);
}

/** Language breakdown of final transcript segments. */
export function languageBreakdown(segments: TranscriptEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of finalSegments(segments)) {
    const lang = (s.language || 'en').toLowerCase();
    counts[lang] = (counts[lang] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export function toTxt(rec: MeetingRecord): string {
  const start = timelineStart(rec);
  const names = meetingParticipants(rec).map((p) => p.name);
  const langs = languageBreakdown(rec.segments);
  const langStr = Object.entries(langs).map(([k, v]) => `${k.toUpperCase()} (${v})`).join(', ') || 'English';

  const lines = [
    'Roundtable Transcript',
    `Session:      ${rec.sessionCode}`,
    `Participants: ${names.join(', ') || '—'}`,
    `Duration:     ${formatDuration(rec.endedAt - rec.joinedAt)}`,
    `Languages:    ${langStr}`,
    '',
  ];
  const segs = ordered(rec);
  if (!segs.length) lines.push('(No speech was transcribed in this session.)');
  for (const s of segs) {
    const tag = s.isFinal ? '' : ' (unfinalized)';
    const lang = s.language ? ` [${s.language.toUpperCase()}]` : '';
    lines.push(`[${formatDuration(s.timestamp - start)}] ${s.participantName}${lang}${tag}:`, s.text);
    if (s.translation && s.language !== 'en') {
      lines.push(`  Translation: "${s.translation}"`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function toMarkdown(rec: MeetingRecord): string {
  const start = timelineStart(rec);
  const people = meetingParticipants(rec);
  const dist = speakingDistribution(rec.segments);
  const langs = languageBreakdown(rec.segments);
  const langStr = Object.entries(langs).map(([k, v]) => `${k.toUpperCase()} (${v})`).join(', ') || 'English';
  const segs = ordered(rec);
  const out: string[] = [
    '# Roundtable Transcript',
    '',
    '## Session',
    '',
    `- **Session code:** \`${rec.sessionCode}\``,
    `- **Joined:** ${new Date(rec.joinedAt).toLocaleString()}`,
    `- **Ended:** ${new Date(rec.endedAt).toLocaleString()}`,
    `- **Duration:** ${formatDuration(rec.endedAt - rec.joinedAt)}`,
    `- **Languages:** ${langStr}`,
    `- **Final segments:** ${finalSegments(segs).length}`,
    `- **Words (final):** ${dist.reduce((n, d) => n + d.words, 0)}`,
    '',
    '## Participants',
    '',
    ...(people.length ? people.map((p) => `- ${p.name}`) : ['- —']),
    '',
  ];
  if (dist.length) {
    out.push('## Speaking distribution', '', '| Participant | Words | Share |', '| --- | ---: | ---: |');
    for (const d of dist) out.push(`| ${escapeMd(d.name)} | ${d.words} | ${Math.round(d.share * 100)}% |`);
    out.push('');
  }
  out.push('## Transcript', '');
  if (!segs.length) out.push('_No speech was transcribed in this session._');
  for (const s of segs) {
    const tag = s.isFinal ? '' : ' _(unfinalized)_';
    const lang = s.language ? ` \`[${s.language.toUpperCase()}]\`` : '';
    out.push(`**[${formatDuration(s.timestamp - start)}] ${escapeMd(s.participantName)}**${lang}${tag}  `, s.text);
    if (s.translation && s.language !== 'en') {
      out.push(`> _"${escapeMd(s.translation)}"_\n`);
    } else {
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

export function toJson(rec: MeetingRecord): string {
  const start = timelineStart(rec);
  const data = {
    format: 'roundtable-transcript',
    version: 1,
    sessionCode: rec.sessionCode,
    joinedAt: new Date(rec.joinedAt).toISOString(),
    endedAt: new Date(rec.endedAt).toISOString(),
    durationMs: rec.endedAt - rec.joinedAt,
    languages: languageBreakdown(rec.segments),
    participants: meetingParticipants(rec),
    speakingDistribution: speakingDistribution(rec.segments).map(({ participantId, name, words, segments }) => ({
      participantId,
      name,
      words,
      segments,
    })),
    segments: ordered(rec).map((s) => ({
      segmentId: s.segmentId,
      participantId: s.participantId,
      participantName: s.participantName,
      text: s.text,
      isFinal: s.isFinal,
      language: s.language || 'en',
      translation: s.translation,
      timestamp: new Date(s.timestamp).toISOString(),
      offsetMs: Math.max(0, s.timestamp - start),
    })),
  };
  return JSON.stringify(data, null, 2) + '\n';
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]|<>])/g, '\\$1');
}

// ---------------------------------------------------------------------------
// Download (browser only, no backend storage)
// ---------------------------------------------------------------------------

export type ExportFormat = 'txt' | 'md' | 'json';

const MIME: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function downloadTranscript(rec: MeetingRecord, format: ExportFormat): void {
  const body = format === 'txt' ? toTxt(rec) : format === 'md' ? toMarkdown(rec) : toJson(rec);
  const blob = new Blob([body], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date(rec.endedAt).toISOString().slice(0, 10);
  a.href = url;
  a.download = `roundtable-${rec.sessionCode}-${date}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
