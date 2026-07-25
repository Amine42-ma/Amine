// The stickman director: reads a scene's text and mood and choreographs what
// the figures do — which action, where they enter and exit, and how they move.
// Keyword-driven in both Arabic and English so a small brief yields a full
// sequence of expressive beats.

const A = [15, 15, 20]; // primary figure (near-black)
const B = [34, 40, 78]; // second figure (dark indigo)

const ACTION_KEYWORDS = {
  fight: ['قاتل', 'يقاتل', 'معركة', 'يضرب', 'ضرب', 'حرب', 'اشتباك', 'عراك', 'fight', 'battle', 'punch', 'war', 'clash', 'combat', 'strike'],
  run: ['يركض', 'ركض', 'يجري', 'يهرب', 'هروب', 'مطاردة', 'run', 'flee', 'chase', 'escape', 'sprint', 'rush'],
  fall: ['يسقط', 'سقط', 'يقع', 'موت', 'مات', 'ينهار', 'fall', 'die', 'death', 'collapse', 'drop', 'defeat'],
  jump: ['يقفز', 'قفز', 'وثب', 'jump', 'leap', 'hop'],
  dance: ['يرقص', 'رقص', 'حفلة', 'dance', 'party'],
  celebrate: ['فوز', 'نصر', 'انتصار', 'فرح', 'احتفال', 'بطل', 'win', 'victory', 'celebrate', 'triumph', 'hero', 'cheer'],
  wave: ['يلوّح', 'تحية', 'مرحبا', 'وداع', 'wave', 'greet', 'hello', 'goodbye', 'farewell'],
  meet: ['يلتقي', 'لقاء', 'معًا', 'يقابل', 'صديق', 'حب', 'love', 'meet', 'together', 'friend', 'reunion'],
  sit: ['يجلس', 'جلس', 'راحة', 'استراحة', 'تأمل', 'sit', 'rest', 'wait', 'ponder'],
  walk: ['يمشي', 'يسير', 'يتجول', 'طريق', 'رحلة', 'walk', 'stroll', 'journey', 'travel', 'path'],
};

export function chooseAction(text) {
  const low = (text || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const [action, words] of Object.entries(ACTION_KEYWORDS)) {
    let score = 0;
    for (const w of words) if (low.includes(w.toLowerCase())) score++;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  return best;
}

// Choreography per action → a list of actors with entry/exit positions.
function choreograph(action, index) {
  switch (action) {
    case 'walk': return { action, actors: [{ color: A, x0: -0.12, x1: 1.12, facing: 1, pose: 'walk', speed: 1.4 }] };
    case 'run': return { action, actors: [{ color: A, x0: -0.12, x1: 1.12, facing: 1, pose: 'run', speed: 2.6 }] };
    case 'fight': return {
      action, actors: [
        { color: A, x0: 0.33, x1: 0.44, facing: 1, pose: 'punch', speed: 1.7 },
        { color: B, x0: 0.67, x1: 0.56, facing: -1, pose: 'punch', speed: 1.7, phaseShift: 0.5 },
      ],
    };
    case 'fall': return { action, actors: [{ color: A, x0: 0.5, x1: 0.5, facing: 1, pose: 'fall', speed: 1, once: true }] };
    case 'jump': return { action, actors: [{ color: A, x0: 0.2, x1: 0.8, facing: 1, pose: 'jump', speed: 1, jump: 2 }] };
    case 'dance': return {
      action, actors: [
        { color: A, x0: 0.4, x1: 0.4, facing: 1, pose: 'dance', speed: 1.3 },
        { color: B, x0: 0.6, x1: 0.6, facing: -1, pose: 'dance', speed: 1.3, phaseShift: 0.5 },
      ],
    };
    case 'celebrate': return { action, actors: [{ color: A, x0: 0.5, x1: 0.5, facing: 1, pose: 'celebrate', speed: 1.6 }] };
    case 'wave': return { action, actors: [{ color: A, x0: 0.5, x1: 0.5, facing: 1, pose: 'wave', speed: 1.5 }] };
    case 'sit': return { action, actors: [{ color: A, x0: 0.5, x1: 0.5, facing: 1, pose: 'sit', speed: 0.5 }] };
    case 'meet': return {
      action, actors: [
        { color: A, x0: 0.12, x1: 0.42, facing: 1, pose: 'walk', speed: 1.2 },
        { color: B, x0: 0.88, x1: 0.58, facing: -1, pose: 'walk', speed: 1.2 },
      ],
    };
    default: // idle — gentle presence, alternate facing per scene
      return { action: 'idle', actors: [{ color: A, x0: 0.5, x1: 0.5, facing: index % 2 ? -1 : 1, pose: 'idle', speed: 0.6 }] };
  }
}

// Build the stickman spec for one shot, using the scene's story text.
export function stickSpecForShot(scene, shot, plan, kind, index = 0) {
  if (kind === 'title') return { action: 'wave', actors: [{ color: A, x0: 0.5, x1: 0.5, facing: 1, pose: 'wave', speed: 1.4 }] };
  if (kind === 'end') {
    const happy = ['hopeful', 'romantic', 'epic', 'wonder', 'serene'].includes(plan.mood);
    return happy
      ? { action: 'celebrate', actors: [{ color: A, x0: 0.5, x1: 0.5, facing: 1, pose: 'celebrate', speed: 1.5 }] }
      : { action: 'walk', actors: [{ color: A, x0: 0.5, x1: 1.2, facing: 1, pose: 'walk', speed: 1.3 }] };
  }

  const narr = (plan.narration || []).filter((n) => (n.sceneIndex ?? -1) === scene.index).map((n) => n.text).join(' ');
  const text = [scene.summary, shot.description, shot.caption, narr].filter(Boolean).join(' ');
  const action = chooseAction(text) || fallbackByMood(plan.mood, index);
  return choreograph(action, index);
}

function fallbackByMood(mood, index) {
  const map = { tense: 'run', epic: 'walk', noir: 'walk', bleak: 'walk', wonder: 'idle', serene: 'sit', hopeful: 'walk', romantic: 'meet' };
  const base = map[mood] || 'walk';
  // Vary a little across scenes so a long film isn't monotonous.
  if (base === 'walk' && index % 3 === 2) return 'idle';
  return base;
}
