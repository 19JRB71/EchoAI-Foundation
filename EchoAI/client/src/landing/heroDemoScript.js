// The scripted "Watch Echo Work" hero demo — a fixed, clearly-labeled EXAMPLE
// briefing (never real visitor data). Audio was pre-generated once with the
// product's real ElevenLabs voice and shipped as static files, so the public
// landing page never makes a live TTS call and nothing can autoplay.
//
// Each step: what Echo says (caption + audio file), which agent lights up,
// and which briefing-panel row illuminates as it's mentioned.

const AUDIO_BASE = "/landing-demo";

// `pauseAfterMs` — a short cinematic beat of silence after the line finishes,
// before the next one starts (Echo "pausing"). Skipped when the demo is
// paused/skipped; omitted (0) for the briefing items so they flow naturally.
export const DEMO_STEPS = [
  {
    id: "hello",
    text: "Hello. I'm Echo.",
    audio: `${AUDIO_BASE}/01-hello.mp3`,
    agentId: "echo",
    rowId: null,
    pauseAfterMs: 650,
  },
  {
    id: "welcome",
    text: "Welcome to Zorecho.",
    audio: `${AUDIO_BASE}/02-welcome.mp3`,
    agentId: null,
    rowId: null,
    pauseAfterMs: 750,
  },
  {
    id: "showyou",
    text: "Let me show you what your AI company has already accomplished today.",
    audio: `${AUDIO_BASE}/03-showyou.mp3`,
    agentId: null,
    rowId: null,
    pauseAfterMs: 500,
  },
  {
    id: "leads",
    text: "Ten new leads arrived overnight.",
    audio: `${AUDIO_BASE}/03-leads.mp3`,
    agentId: "pulse",
    rowId: "leads",
  },
  {
    id: "emails",
    text: "Seven customer emails need attention.",
    audio: `${AUDIO_BASE}/04-emails.mp3`,
    agentId: "echo",
    rowId: "emails",
  },
  {
    id: "calls",
    text: "Voice answered twelve calls.",
    audio: `${AUDIO_BASE}/05-calls.mp3`,
    agentId: "voice",
    rowId: "calls",
  },
  {
    id: "appointments",
    text: "Three appointments were booked.",
    audio: `${AUDIO_BASE}/06-appointments.mp3`,
    agentId: "voice",
    rowId: "appointments",
  },
  {
    id: "scout",
    text: "Scout found two new competitor campaigns.",
    audio: `${AUDIO_BASE}/07-scout.mp3`,
    agentId: "scout",
    rowId: "competitors",
  },
  {
    id: "nova",
    text: "Nova prepared today's social content.",
    audio: `${AUDIO_BASE}/08-nova.mp3`,
    agentId: "nova",
    rowId: "social",
  },
  {
    id: "close",
    text: "Your AI company is online and ready. Would you like to see Mission Control?",
    audio: `${AUDIO_BASE}/09-close.mp3`,
    agentId: "echo",
    rowId: null,
  },
];

// Rows in the right-hand "Example Morning Briefing" panel. Each illuminates
// when its rowId is reached in the script. All numbers are the fixed sample
// values Echo speaks — the panel is labeled "Sample data" at all times.
export const BRIEFING_ROWS = [
  {
    id: "leads",
    agentId: "pulse",
    value: "10",
    label: "New Leads",
    sub: "arrived overnight",
  },
  {
    id: "emails",
    agentId: "echo",
    value: "7",
    label: "Emails to Respond",
    sub: "need attention",
  },
  {
    id: "calls",
    agentId: "voice",
    value: "12",
    label: "Calls Answered",
    sub: "handled by Voice",
  },
  {
    id: "appointments",
    agentId: "voice",
    value: "3",
    label: "Appointments Booked",
    sub: "added to the calendar",
  },
  {
    id: "competitors",
    agentId: "scout",
    value: "2",
    label: "Competitor Alerts",
    sub: "new campaigns found",
  },
  {
    id: "social",
    agentId: "nova",
    value: "Ready",
    label: "Today's Social Content",
    sub: "prepared by Nova",
  },
];

// Fallback pacing when audio can't play (muted, blocked, or file missing):
// roughly reading speed, never shorter than 2.2s so captions stay readable.
export function stepDurationMs(step) {
  return Math.max(2200, step.text.length * 65);
}
