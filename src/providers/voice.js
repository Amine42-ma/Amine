// Narration provider. Offline, narration is delivered as burned-in subtitles
// (captions-only) — honest and reliable with no keys. With an ElevenLabs or
// OpenAI key, each narration line is synthesised to speech and returned with
// its scene index so the assembler can place and duck it under the score.

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../util/log.js';

export function activeVoiceProvider() {
  if (config.voice.provider === 'silent') return 'captions-only';
  if (config.voice.provider === 'elevenlabs' || (config.voice.provider === 'auto' && config.voice.elevenKey)) return 'elevenlabs';
  if (config.voice.provider === 'openai' || (config.voice.provider === 'auto' && config.voice.openaiKey)) return 'openai';
  return 'captions-only';
}

// Returns [{ sceneIndex, path }]. Empty when captions-only.
export async function synthesizeNarration(plan, ctx) {
  const provider = activeVoiceProvider();
  if (provider === 'captions-only' || !Array.isArray(plan.narration) || !plan.narration.length) return [];

  const out = [];
  for (let i = 0; i < plan.narration.length; i++) {
    const line = plan.narration[i];
    const text = (line.text || '').trim();
    if (!text) continue;
    const file = path.join(ctx.dir, `vo_${i}.mp3`);
    try {
      if (provider === 'elevenlabs') await elevenlabs(text, file);
      else await openaiTTS(text, file);
      out.push({ sceneIndex: line.sceneIndex ?? i, path: file });
    } catch (e) {
      log.warn(`TTS failed for line ${i}, skipping voice for it:`, e.message);
    }
  }
  return out;
}

async function elevenlabs(text, outFile) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voice.elevenVoice}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': config.voice.elevenKey, accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
  await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
}

async function openaiTTS(text, outFile) {
  const res = await fetch(`${'https://api.openai.com'}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.voice.openaiKey}` },
    body: JSON.stringify({ model: config.voice.openaiModel, voice: config.voice.openaiVoice, input: text }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
}
