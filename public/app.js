const $ = (s) => document.querySelector(s);
const state = { aspect: '16:9', quality: 'hd', evtSource: null };

// ---- Boot: load capabilities & options ------------------------------------
async function boot() {
  const caps = await fetch('/api/capabilities').then((r) => r.json());

  const moodSel = $('#mood');
  moodSel.innerHTML = '<option value="">تلقائي (يُستنتج من الوصف)</option>' +
    caps.moods.map((m) => `<option value="${m.key}">${m.ar}</option>`).join('');

  const qSel = $('#quality');
  qSel.innerHTML = caps.qualities.map((q) => `<option value="${q.key}"${q.key === 'hd' ? ' selected' : ''}>${q.ar}</option>`).join('');

  const scriptLive = caps.scriptEngine === 'claude';
  const c = caps.capabilities;
  $('#caps').innerHTML = [
    capChip('النص', scriptLive ? 'Claude' : 'كاتب داخلي', scriptLive),
    capChip('الفيديو', labelVideo(c.video), c.video !== 'cinematic'),
    capChip('الصوت', labelVoice(c.voice), c.voice !== 'captions-only'),
    capChip('الموسيقى', 'مركّبة', true),
  ].join('');

  $('#hint').textContent = scriptLive
    ? 'المحرك النصّي: Claude — سيفهم قصتك ويكتب سيناريو إنتاجيًا كاملًا.'
    : 'يعمل بلا مفاتيح عبر المحرّك الداخلي. أضِف ANTHROPIC_API_KEY لكتابة سيناريو أذكى، ومفاتيح فيديو/صوت لواقعية أعلى.';
}

function capChip(name, val, live) {
  return `<span class="cap ${live ? 'live' : ''}">${name}: <b>${val}</b></span>`;
}
function labelVideo(v) { return { cinematic: 'سينمائي داخلي', fal: 'fal.ai', replicate: 'Replicate' }[v] || v; }
function labelVoice(v) { return { 'captions-only': 'ترجمة نصية', elevenlabs: 'ElevenLabs', openai: 'OpenAI' }[v] || v; }

// ---- Controls --------------------------------------------------------------
$('#aspect').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  $('#aspect').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); state.aspect = b.dataset.v;
});
$('#duration').addEventListener('input', (e) => { $('#durVal').textContent = e.target.value; });
$('#again').addEventListener('click', resetStudio);

// ---- Generate --------------------------------------------------------------
$('#go').addEventListener('click', async () => {
  const brief = $('#brief').value.trim();
  if (brief.length < 3) { flashHint('اكتب وصفًا أولًا 🙂'); return; }

  const payload = {
    brief,
    mood: $('#mood').value,
    language: $('#language').value,
    aspect: state.aspect,
    duration: Number($('#duration').value),
    quality: $('#quality').value,
  };

  $('#go').disabled = true;
  showProgress();

  let res;
  try {
    res = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then((r) => r.json());
  } catch {
    flashHint('تعذّر بدء الإنتاج'); $('#go').disabled = false; return;
  }
  if (!res.id) { flashHint(res.error || 'خطأ'); $('#go').disabled = false; return; }

  listen(res.id);
});

// ---- SSE progress ----------------------------------------------------------
function listen(id) {
  if (state.evtSource) state.evtSource.close();
  const es = new EventSource(`/api/jobs/${id}/events`);
  state.evtSource = es;
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (typeof d.progress === 'number') setProgress(d.progress, d.stage, d.message);
    if (d.done) {
      es.close();
      if (d.status === 'error') { flashHint(d.error || 'فشل الإنتاج'); $('#go').disabled = false; showIdleError(); }
      else showResult(d.result, d.plan);
    }
  };
  es.onerror = () => { es.close(); $('#go').disabled = false; };
}

// ---- UI state --------------------------------------------------------------
const STAGES = {
  writing: 'كتابة الرؤية', planned: 'اكتمل السيناريو', shots: 'إخراج اللقطات',
  assemble: 'المونتاج', audio: 'التصميم الصوتي', finalize: 'المعالجة النهائية', done: 'اكتمل',
};

function showProgress() {
  $('#idle').classList.add('hidden');
  $('#result').classList.add('hidden');
  $('#progress').classList.remove('hidden');
  $('#plog').innerHTML = '';
  setProgress(2, 'writing', 'يبدأ الإنتاج…');
}

let lastMsg = '';
function setProgress(pct, stage, message) {
  $('#pfill').style.width = pct + '%';
  $('#ppct').textContent = pct + '%';
  $('#pstage').textContent = STAGES[stage] || stage || '';
  if (message && message !== lastMsg) {
    lastMsg = message;
    const log = $('#plog');
    log.querySelectorAll('.now').forEach((x) => x.classList.remove('now'));
    const li = document.createElement('li');
    li.className = 'now'; li.textContent = message;
    log.appendChild(li); log.scrollTop = log.scrollHeight;
  }
}

function showResult(result, plan) {
  $('#progress').classList.add('hidden');
  $('#result').classList.remove('hidden');
  const player = $('#player');
  player.src = result.videoUrl;
  player.load();
  $('#download').href = result.videoUrl + '?download=1';
  $('#plan').innerHTML = renderPlan(plan, result);
  $('#go').disabled = false;
}

function renderPlan(plan, result) {
  if (!plan) return '';
  const meta = [
    badge(`⏱ ${result.duration}ث`),
    badge(`🎞 ${result.width}×${result.height}`),
    badge(`🎭 ${plan.mood}`),
    badge(`🌐 ${plan.language}`),
    badge(plan.engine === 'claude' ? '✍ Claude' : '✍ كاتب داخلي'),
  ].join('');
  const scenes = (plan.scenes || []).map((s, i) => `
    <div class="scene">
      <div class="scene-head"><span class="h">${escapeHtml(s.heading)}</span><span class="n">مشهد ${i + 1} · ${s.shots} لقطة</span></div>
      <p class="sum">${escapeHtml(s.summary || '')}</p>
    </div>`).join('');
  const sound = plan.sound ? `<p class="sound"><b>الصوت:</b> ${escapeHtml(plan.sound.score || '')}${plan.sound.sfx?.length ? ' — ' + plan.sound.sfx.map(escapeHtml).join('، ') : ''}</p>` : '';
  return `
    <h2>${escapeHtml(plan.title)}</h2>
    <p class="logline">${escapeHtml(plan.logline || '')}</p>
    <div class="meta">${meta}</div>
    ${scenes}
    ${sound}`;
}

function badge(t) { return `<span class="badge">${escapeHtml(t)}</span>`; }

function resetStudio() {
  $('#result').classList.add('hidden');
  $('#progress').classList.add('hidden');
  $('#idle').classList.remove('hidden');
  const p = $('#player'); p.pause(); p.removeAttribute('src'); p.load();
}
function showIdleError() {
  $('#progress').classList.add('hidden');
  $('#idle').classList.remove('hidden');
}
function flashHint(t) { const h = $('#hint'); h.textContent = t; h.style.color = 'var(--gold2)'; setTimeout(() => (h.style.color = ''), 2500); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

boot();
