// The scripted "Meet Echo" hero demo — a fixed, clearly-labeled EXAMPLE
// briefing (never real visitor data). Audio was pre-generated once with the
// product's real ElevenLabs voice and shipped as static files, so the public
// landing page never makes a live TTS call and nothing can autoplay.
//
// Each step: what Echo says (caption + audio file), which agent lights up,
// and the small report card that appears beside the Core as it's mentioned.

const AUDIO_BASE = "/landing-demo";

export const DEMO_STEPS = [
  {
    id: "intro",
    text: "Hello. I'm Echo, your personal AI assistant.",
    audio: `${AUDIO_BASE}/01-intro.mp3`,
    agentId: "echo",
    card: null,
  },
  {
    id: "greeting",
    text: "Good morning, sir. Here's your example business briefing.",
    audio: `${AUDIO_BASE}/02-greeting.mp3`,
    agentId: null,
    card: null,
  },
  {
    id: "leads",
    text: "Ten new leads arrived overnight.",
    audio: `${AUDIO_BASE}/03-leads.mp3`,
    agentId: "pulse",
    card: { agentId: "pulse", value: "10", label: "new leads overnight" },
  },
  {
    id: "emails",
    text: "Seven customer emails need attention.",
    audio: `${AUDIO_BASE}/04-emails.mp3`,
    agentId: "echo",
    card: { agentId: "echo", value: "7", label: "emails need attention" },
  },
  {
    id: "calls",
    text: "Voice answered twelve calls.",
    audio: `${AUDIO_BASE}/05-calls.mp3`,
    agentId: "voice",
    card: { agentId: "voice", value: "12", label: "calls answered" },
  },
  {
    id: "appointments",
    text: "Three appointments were booked.",
    audio: `${AUDIO_BASE}/06-appointments.mp3`,
    agentId: "voice",
    card: { agentId: "voice", value: "3", label: "appointments booked" },
  },
  {
    id: "scout",
    text: "Scout found two new competitor campaigns.",
    audio: `${AUDIO_BASE}/07-scout.mp3`,
    agentId: "scout",
    card: { agentId: "scout", value: "2", label: "competitor campaigns found" },
  },
  {
    id: "nova",
    text: "Nova prepared today's social content.",
    audio: `${AUDIO_BASE}/08-nova.mp3`,
    agentId: "nova",
    card: { agentId: "nova", value: "Ready", label: "today's social content" },
  },
  {
    id: "close",
    text: "Your AI company is online and ready. Would you like to see Mission Control?",
    audio: `${AUDIO_BASE}/09-close.mp3`,
    agentId: "echo",
    card: null,
  },
];

// Fallback pacing when audio can't play (muted, blocked, or file missing):
// roughly reading speed, never shorter than 2.2s so captions stay readable.
export function stepDurationMs(step) {
  return Math.max(2200, step.text.length * 65);
}
