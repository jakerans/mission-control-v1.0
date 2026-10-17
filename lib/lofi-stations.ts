// Lofi Girl's 24/7 live streams (youtube.com/@LofiGirl/streams), as of October 2026.
// If a station stops playing, its stream was replaced: grab the new video id from that page.
export type Station = { id: string; name: string; emoji: string; youtubeId: string };

export const LOFI_STATIONS: Station[] = [
  { id: "study", name: "lofi hip hop · relax/study", emoji: "📚", youtubeId: "rFZHOHl-L8A" },
  { id: "sleep", name: "lofi hip hop · sleep/chill", emoji: "💤", youtubeId: "JD-kMIpDfnY" },
  { id: "jazz-lofi", name: "jazz lofi", emoji: "🎷", youtubeId: "E2vONfzoyRI" },
  { id: "cozy-jazz", name: "cozy jazz", emoji: "🌹", youtubeId: "A8jDx9TLMQc" },
  { id: "rainy", name: "sad lofi · rainy days", emoji: "☔", youtubeId: "CwPCy1GLS38" },
  { id: "asian", name: "asian lofi", emoji: "⛩️", youtubeId: "1Tl2FtV06qo" },
  { id: "synthwave", name: "synthwave", emoji: "🌌", youtubeId: "4xDzrJKXOOY" },
  { id: "house", name: "lofi house", emoji: "🌅", youtubeId: "3PFJ9SETS4M" },
  { id: "guitar", name: "chill guitar", emoji: "🎸", youtubeId: "E_XmwjgRLz8" },
  { id: "piano", name: "relaxing piano", emoji: "🎹", youtubeId: "N0snMcR6aaA" },
  { id: "classical", name: "classical", emoji: "🎻", youtubeId: "jXAEIWcGXwE" },
  { id: "medieval", name: "medieval lofi", emoji: "🏰", youtubeId: "IxPANmjPaek" },
  { id: "summer", name: "summer lofi", emoji: "☀️", youtubeId: "0muHFBSiybw" },
  { id: "christmas", name: "christmas lofi", emoji: "🎄", youtubeId: "XSXEaikz0Bc" },
  { id: "halloween", name: "halloween ambience", emoji: "🎃", youtubeId: "1-LpQekNa9g" },
  { id: "fireplace", name: "fireplace ambience", emoji: "🔥", youtubeId: "q_4KI-ChIIs" },
  { id: "rain", name: "gentle rain ambience", emoji: "🌧", youtubeId: "-OekvEFm1lo" },
  { id: "deep-sleep", name: "deep sleep ambient", emoji: "🌙", youtubeId: "nI725iVsyoQ" },
];
