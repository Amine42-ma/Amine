// Central configuration. Everything is driven by environment variables so the
// app runs fully offline (cinematic mock engine) and upgrades to real AI
// providers automatically when API keys are present.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const env = process.env;

function pick(...names) {
  for (const n of names) {
    if (env[n] && String(env[n]).trim()) return String(env[n]).trim();
  }
  return '';
}

export const config = {
  port: Number(env.PORT || 8787),

  paths: {
    root: ROOT,
    public: path.join(ROOT, 'public'),
    storage: path.join(ROOT, 'storage'),
    fonts: path.join(ROOT, 'assets', 'fonts'),
  },

  // ---- Script / screenplay brain --------------------------------------
  anthropic: {
    apiKey: pick('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'),
    baseUrl: pick('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com',
    model: pick('ANTHROPIC_MODEL') || 'claude-opus-4-8',
  },

  // ---- Video generation provider --------------------------------------
  // provider: 'auto' | 'cinematic' (offline) | 'fal' | 'replicate'
  video: {
    provider: pick('VIDEO_PROVIDER') || 'auto',
    falKey: pick('FAL_KEY', 'FAL_API_KEY'),
    falModel: pick('FAL_VIDEO_MODEL') || 'fal-ai/ltx-video',
    replicateKey: pick('REPLICATE_API_TOKEN'),
    replicateModel: pick('REPLICATE_VIDEO_MODEL') || '',
  },

  // ---- Voice / narration provider -------------------------------------
  // provider: 'auto' | 'silent' (offline) | 'elevenlabs' | 'openai'
  voice: {
    provider: pick('VOICE_PROVIDER') || 'auto',
    elevenKey: pick('ELEVENLABS_API_KEY'),
    elevenVoice: pick('ELEVENLABS_VOICE_ID') || '21m00Tcm4TlvDq8ikWAM',
    openaiKey: pick('OPENAI_API_KEY'),
    openaiVoice: pick('OPENAI_TTS_VOICE') || 'onyx',
    openaiModel: pick('OPENAI_TTS_MODEL') || 'tts-1-hd',
  },

  // ---- Music / score provider -----------------------------------------
  // provider: 'auto' | 'procedural' (offline) | ...
  music: {
    provider: pick('MUSIC_PROVIDER') || 'auto',
  },
};

// Convenience flags used across the app for capability reporting.
export const capabilities = {
  script: config.anthropic.apiKey ? 'claude' : 'offline-writer',
  video:
    config.video.provider === 'cinematic'
      ? 'cinematic'
      : config.video.falKey
      ? 'fal'
      : config.video.replicateKey
      ? 'replicate'
      : 'cinematic',
  voice:
    config.voice.provider === 'silent'
      ? 'captions-only'
      : config.voice.elevenKey
      ? 'elevenlabs'
      : config.voice.openaiKey
      ? 'openai'
      : 'captions-only',
  music: 'procedural',
};
