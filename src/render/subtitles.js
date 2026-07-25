// Generates an ASS subtitle file rendered by libass at assembly time. libass
// shapes Arabic and handles RTL correctly (verified with the bundled Amiri
// font). Two styles: a large centred Title for the opening/closing cards and a
// bottom Caption for narration/dialogue.

import fs from 'node:fs/promises';
import path from 'node:path';

function fmt(t) {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function esc(text) {
  return String(text).replace(/\r?\n/g, '\\N').replace(/\{/g, '(').replace(/\}/g, ')');
}

// events: [{ start, end, text, style: 'Title'|'Caption'|'Credit' }]
export async function writeAss(outPath, events, opts) {
  const { width, height } = opts;
  const titleSize = Math.round(height * 0.078);
  const capSize = Math.round(height * 0.044);
  const creditSize = Math.round(height * 0.032);
  const marginV = Math.round(height * 0.07);
  const side = Math.round(width * 0.08);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Amiri,${titleSize},&H00FFFFFF,&H00FFFFFF,&H00101018,&H64000000,1,0,0,0,100,100,0,0,1,3,2,5,${side},${side},0,1
Style: Caption,Amiri,${capSize},&H00F2F2F2,&H00F2F2F2,&H00101018,&H8C000000,0,0,0,0,100,100,0,0,1,2,1,2,${side},${side},${marginV},1
Style: Credit,Amiri,${creditSize},&H00C8C8C8,&H00C8C8C8,&H00101018,&H64000000,0,1,0,0,100,100,0,0,1,2,1,5,${side},${side},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = events
    .filter((e) => e.text && e.end > e.start)
    .map((e) => {
      const fade = e.style === 'Caption' ? '{\\fad(350,350)}' : '{\\fad(600,600)}';
      return `Dialogue: 0,${fmt(e.start)},${fmt(e.end)},${e.style || 'Caption'},,0,0,0,,${fade}${esc(e.text)}`;
    });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, header + '\n' + lines.join('\n') + '\n', 'utf8');
  return outPath;
}
