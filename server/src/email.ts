import { DEBUG } from './config.ts';

export interface EmailMeetingPayload {
  sessionCode: string;
  joinedAt: number;
  endedAt: number;
  rosterAtEnd: Array<{ id: string; name: string }>;
  segments: Array<{
    segmentId: string;
    participantId: string;
    participantName: string;
    text: string;
    isFinal: boolean;
    timestamp: number;
    language?: string;
    translation?: string;
  }>;
}

export interface EmailSendResult {
  ok: boolean;
  delivered: boolean;
  simulated?: boolean;
  message: string;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTextTranscript(meeting: EmailMeetingPayload): string {
  const start = meeting.joinedAt;
  const participants = meeting.rosterAtEnd.map((p) => p.name).join(', ') || '—';
  const duration = formatDuration(meeting.endedAt - meeting.joinedAt);

  const lines = [
    '========================================',
    'ROUNDTABLE MEETING TRANSCRIPT',
    '========================================',
    `Session:      ${meeting.sessionCode}`,
    `Date:         ${new Date(meeting.joinedAt).toLocaleString()}`,
    `Duration:     ${duration}`,
    `Participants: ${participants}`,
    '========================================',
    '',
    'TRANSCRIPT:',
    '',
  ];

  for (const s of meeting.segments) {
    const timeStr = formatDuration(s.timestamp - start);
    const langTag = s.language ? ` [${s.language.toUpperCase()}]` : '';
    const finalTag = s.isFinal ? '' : ' (interim)';
    lines.push(`[${timeStr}] ${s.participantName}${langTag}${finalTag}:`);
    lines.push(`  ${s.text}`);
    if (s.translation && s.language !== 'en') {
      lines.push(`  Translation: "${s.translation}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildHtmlEmail(meeting: EmailMeetingPayload): string {
  const start = meeting.joinedAt;
  const participants = meeting.rosterAtEnd.map((p) => escapeHtml(p.name)).join(', ') || '—';
  const duration = formatDuration(meeting.endedAt - meeting.joinedAt);

  // Language count
  const langCounts: Record<string, number> = {};
  for (const s of meeting.segments) {
    if (s.isFinal && s.language) {
      langCounts[s.language] = (langCounts[s.language] || 0) + 1;
    }
  }
  const langSummary = Object.keys(langCounts).length
    ? Object.entries(langCounts)
        .map(([k, v]) => `${k.toUpperCase()} (${v})`)
        .join(', ')
    : 'English';

  const rows = meeting.segments
    .map((s) => {
      const timeStr = formatDuration(s.timestamp - start);
      const langBadge = s.language
        ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#ede9fe;color:#5b21b6;font-size:11px;font-weight:600;margin-left:6px;">${escapeHtml(s.language.toUpperCase())}</span>`
        : '';
      const translationBlock =
        s.translation && s.language !== 'en'
          ? `<div style="margin-top:4px;color:#4b5563;font-style:italic;font-size:13px;border-left:2px solid #8b5cf6;padding-left:8px;">“${escapeHtml(s.translation)}”</div>`
          : '';

      return `
      <div style="margin-bottom:14px;padding:10px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">
          <strong style="color:#111827;font-size:13px;">${escapeHtml(s.participantName)}</strong>
          ${langBadge}
          <span style="float:right;">${timeStr}</span>
        </div>
        <div style="font-size:14px;color:#1f2937;line-height:1.4;">${escapeHtml(s.text)}</div>
        ${translationBlock}
      </div>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Roundtable Transcript - ${escapeHtml(meeting.sessionCode)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111827;max-width:680px;margin:0 auto;padding:24px;">
  <div style="padding:16px 0;border-bottom:2px solid #6366f1;margin-bottom:20px;">
    <h1 style="font-size:22px;margin:0;color:#4f46e5;">Roundtable Transcript</h1>
    <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">Live multi-participant captioned conversation</p>
  </div>

  <div style="background:#f3f4f6;border-radius:8px;padding:14px 18px;margin-bottom:24px;font-size:13px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="color:#6b7280;padding:3px 0;width:120px;">Session Code:</td><td><strong>${escapeHtml(meeting.sessionCode)}</strong></td></tr>
      <tr><td style="color:#6b7280;padding:3px 0;">Duration:</td><td>${duration}</td></tr>
      <tr><td style="color:#6b7280;padding:3px 0;">Participants:</td><td>${participants}</td></tr>
      <tr><td style="color:#6b7280;padding:3px 0;">Languages:</td><td>${escapeHtml(langSummary)}</td></tr>
    </table>
  </div>

  <h2 style="font-size:16px;margin:0 0 12px;color:#374151;">Conversation Transcript</h2>
  <div>${rows || '<p style="color:#9ca3af;">(No speech transcribed in this session)</p>'}</div>

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
    Sent via Roundtable · GDG FCRIT Bit N Build 2026
  </div>
</body>
</html>`;
}

/**
 * Sends or simulates sending transcript email with TXT, MD, and JSON attachments.
 */
export async function sendTranscriptEmail(
  email: string,
  meeting: EmailMeetingPayload,
): Promise<EmailSendResult> {
  const trimmed = email.trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, delivered: false, message: 'Please provide a valid email address.' };
  }

  const textBody = buildTextTranscript(meeting);
  const htmlBody = buildHtmlEmail(meeting);
  const jsonBody = JSON.stringify(meeting, null, 2);

  // Check Resend API
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Roundtable <onboarding@resend.dev>',
          to: [trimmed],
          subject: `Roundtable Transcript - Session ${meeting.sessionCode}`,
          html: htmlBody,
          text: textBody,
          attachments: [
            {
              filename: `roundtable-${meeting.sessionCode}.txt`,
              content: Buffer.from(textBody).toString('base64'),
            },
            {
              filename: `roundtable-${meeting.sessionCode}.md`,
              content: Buffer.from(textBody).toString('base64'),
            },
            {
              filename: `roundtable-${meeting.sessionCode}.json`,
              content: Buffer.from(jsonBody).toString('base64'),
            },
          ],
        }),
      });

      if (res.ok) {
        console.log(`[email] Successfully delivered transcript to ${trimmed} via Resend`);
        return { ok: true, delivered: true, message: `Transcript sent to ${trimmed}!` };
      }

      const errText = await res.text();
      console.warn(`[email] Resend API error: ${errText}`);
    } catch (err) {
      console.warn(`[email] Failed to call Resend API:`, err);
    }
  }

  // Graceful simulation / fallback mode when no active email provider is configured
  console.log(`[email] (Simulation Mode) Prepared transcript email for ${trimmed}:`);
  console.log(`[email] Session: ${meeting.sessionCode} | Segments: ${meeting.segments.length} | Size: ~${textBody.length} bytes`);
  if (DEBUG) console.log(textBody);

  return {
    ok: true,
    delivered: false,
    simulated: true,
    message: `Transcript email prepared for ${trimmed}. (Server running in preview mode; configure RESEND_API_KEY for live delivery)`,
  };
}
