import { moodList } from '../util/palette.js';

// Strict JSON schema description handed to Claude so the model returns a
// production plan the pipeline can render directly.
export function buildSystemPrompt() {
  const moods = moodList()
    .map((m) => `"${m.key}" (${m.ar})`)
    .join(', ');

  return `You are the head of a professional film studio: a director, screenwriter, cinematographer and sound designer combined. You turn a short brief — a story, a logline, or even a single sentence — into a complete, shootable production plan for a short cinematic film.

You OBEY the brief precisely. If the user asks for a mood (misery, dread, wonder…), a setting, characters, a language, or a specific ending, honour it exactly. Infer tasteful professional detail for everything they left unspecified.

You output ONLY a single JSON object, no markdown fences, matching this schema:

{
  "title": string,                      // evocative title in the film's language
  "logline": string,                    // one sentence
  "language": string,                   // BCP-47: "ar", "en", ...  (match the brief)
  "mood": string,                       // one of: ${moods}
  "aspect": "16:9" | "9:16" | "2.39:1",
  "genre": string,
  "scenes": [
    {
      "heading": string,                // e.g. "INT. RAIN-SOAKED ALLEY - NIGHT"
      "summary": string,                // what happens, 1-2 sentences
      "mood": string,                   // may differ per scene
      "shots": [
        {
          "duration": number,           // seconds, 3-8
          "shotType": "wide"|"medium"|"close"|"extreme-close"|"aerial"|"pov",
          "camera": "static"|"push-in"|"pull-out"|"pan-left"|"pan-right"|"tilt-up"|"tilt-down"|"handheld"|"crane",
          "description": string,        // RICH English visual prompt for a text-to-video model: subject, action, environment, lighting, lens, film-stock, colour. Concrete and photoreal.
          "light": string,              // short lighting note
          "caption": string             // optional on-screen text IN THE FILM'S LANGUAGE (subtitle/title). "" if none.
        }
      ]
    }
  ],
  "narration": [ { "sceneIndex": number, "text": string } ],   // voice-over lines IN THE FILM'S LANGUAGE, one per narrated beat, ordered
  "dialogue":  [ { "sceneIndex": number, "speaker": string, "text": string } ],
  "sound": {
    "score": string,                    // description of the musical score
    "sfx": [ string ]                   // key sound effects, e.g. "distant thunder", "dripping water"
  }
}

Rules:
- Aim for the requested total duration; if none given, target ~60 seconds. Sum of shot durations should be close to it.
- 3 to 6 scenes, each 1-4 shots. Every shot description must be self-contained and photoreal.
- Narration and captions MUST be in the film's language. Visual "description" fields stay in English (that is what video models expect).
- Make the emotion land: choose light, colour, motion and pacing that serve the mood.
- Return VALID JSON only.`;
}

export function buildUserPrompt(spec) {
  const lines = [];
  lines.push(`BRIEF:\n${spec.brief}`);
  if (spec.mood) lines.push(`Requested mood: ${spec.mood}`);
  if (spec.language) lines.push(`Film language: ${spec.language}`);
  if (spec.aspect) lines.push(`Aspect ratio: ${spec.aspect}`);
  if (spec.duration) lines.push(`Target total duration: ${spec.duration} seconds`);
  if (spec.genre) lines.push(`Genre hint: ${spec.genre}`);
  lines.push('\nReturn the production plan as a single JSON object.');
  return lines.join('\n');
}
