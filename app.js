'use strict';
// ---------- storage ----------
// Один общий профиль на устройстве. Префикс buddyapp_ нарочно не совпадает со старыми ключами buddy_<имя>_*.
const key = k => `buddyapp_${k}`;
const load = (k, d) => JSON.parse(localStorage.getItem(key(k)) || 'null') ?? d;
const save = (k, v) => localStorage.setItem(key(k), JSON.stringify(v));
let jokes = [];
let sets = [];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const minStr = s => String(Math.round((s || 0) / 0.6) / 100).replace('.', ',') + ' мин';
const RATE = ['', '−', '○', '+'], RATE_NAME = ['', 'не смешно', 'нормально', 'смешно'];
// оценки шутки: j.rates = [{p: выступление, d: время, l: 1..3}], последняя по времени — текущая; l=0 убирает оценку
const lastRate = j => (j.rates?.length ? j.rates[j.rates.length - 1].l : 0);
function setRate(j, p, l) {
  j.rates = (j.rates || []).filter(r => r.p !== p);
  if (l) j.rates.push({ p, d: Date.now(), l });
  j.rates.sort((a, b) => a.d - b.d);
}
const lastSetId = () => localStorage.getItem(key('lastset'));
const setLast = id => localStorage.setItem(key('lastset'), id);

// ---------- миграция из версии с аккаунтами ----------
// Старые данные лежат под buddy_<имя>_jokes / _sets / _lastbackup. Сводим всё в общий профиль, старые ключи не трогаем.
function migrate() {
  if (localStorage.getItem(key('migrated'))) return;
  const users = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const m = /^buddy_(.+)_(jokes|sets)$/.exec(localStorage.key(i) || '');
    if (m) users.add(m[1]);
  }
  const arr = k => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const order = [localStorage.getItem('buddy_session'), 'guest', ...users].filter((u, i, a) => u && users.has(u) && a.indexOf(u) === i);
  const J = [], S = [], seenJ = new Set(), byId = new Map();
  let backup = 0;
  for (const u of order) {
    for (const j of arr(`buddy_${u}_jokes`)) if (j && j.id && !seenJ.has(j.id)) { seenJ.add(j.id); J.push(j); }
    for (const s of arr(`buddy_${u}_sets`)) {
      if (!s || !s.id) continue;
      s.items = Array.isArray(s.items) ? s.items : [];
      const e = byId.get(s.id);
      if (!e) { byId.set(s.id, s); S.push(s); }
      else s.items.forEach(i => { if (!e.items.includes(i)) e.items.push(i); });
    }
    backup = Math.max(backup, +localStorage.getItem(`buddy_${u}_lastbackup`) || 0);
  }
  if (J.length || S.length) { save('jokes', J); save('sets', S); }
  if (backup) localStorage.setItem(key('lastbackup'), String(backup));
  localStorage.setItem(key('migrated'), '1');
}

// ---------- shell ----------
const view = document.getElementById('view');
let tab = 'jokes';
const tabs = { jokes: viewJokes, sets: viewSets, stage: viewStage };
function go(t) {
  if (stage.running && t !== 'stage' && !confirm('Выступление идёт. Уйти с экрана?')) return;
  tab = t;
  view.onclick = null;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  tabs[t]();
}
document.getElementById('tabs').onclick = e => e.target.dataset.tab && go(e.target.dataset.tab);

// ---------- backup helpers ----------
const markBackup = () => localStorage.setItem(key('lastbackup'), String(Date.now()));
const backupAge = () => { const t = +localStorage.getItem(key('lastbackup')); return t ? Math.floor((Date.now() - t) / 864e5) : null; };
const backupStale = () => (jokes.length || sets.length) && (backupAge() === null || backupAge() >= 7);
const backupStatus = () => {
  const a = backupAge();
  return 'Данные хранятся только на этом устройстве. ' +
    (a === null ? 'Копии ещё не было.' : a === 0 ? 'Последняя копия — сегодня.' : `Последняя копия — ${a} дн. назад.`);
};
const backupName = () => `buddy-${new Date().toISOString().slice(0, 10)}.json`;
// iPhone: системное меню «Поделиться» (→ Файлы); где не поддерживается — обычная загрузка
async function shareFile(blob, name) {
  for (const type of ['application/json', 'text/plain']) {
    const f = new File([blob], name, { type });
    if (!navigator.canShare?.({ files: [f] })) continue;
    try { await navigator.share({ files: [f], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
async function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'comedyos', v: 1, jokes, sets }, null, 2)], { type: 'application/json' });
  if (await shareFile(blob, backupName())) { markBackup(); if (!stage.running) go(tab); }
}
async function restoreBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'comedyos' || !Array.isArray(d.jokes) || !Array.isArray(d.sets)) throw 0;
    if (!confirm(`В копии: шуток ${d.jokes.length}, сетов ${d.sets.length}. Заменить текущие данные?`)) return;
    jokes = d.jokes; sets = d.sets; save('jokes', jokes); save('sets', sets);
    markBackup(); go(tab);
  } catch { alert('Это не файл копии БАДДИ.'); }
}

// ---------- меню ⋯ (копии, импорт) ----------
const panel = document.getElementById('panel');
const closeMenu = () => { panel.hidden = true; };
function openMenu() {
  panel.innerHTML = `<small class="${backupStale() ? 'stale' : ''}">${backupStatus()}</small>
    <button class="b g" id="m-exp">⇩ Сохранить копию</button>
    <button class="b g" id="m-rest">⇧ Восстановить из копии</button>
    <button class="b g" id="m-imp">⇪ Импорт шуток из файла</button>`;
  panel.hidden = false;
  const busy = () => stage.running && (alert('Сначала закончи выступление.'), true);
  document.getElementById('m-exp').onclick = () => { closeMenu(); exportBackup(); };
  document.getElementById('m-rest').onclick = () => { if (!busy()) { closeMenu(); document.getElementById('bfile').click(); } };
  document.getElementById('m-imp').onclick = () => { if (!busy()) { closeMenu(); document.getElementById('file').click(); } };
}
document.getElementById('menu').onclick = e => { e.stopPropagation(); panel.hidden ? openMenu() : closeMenu(); };
document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target)) closeMenu(); });
document.getElementById('file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (f) importJokes(await f.text(), f.name);
};
document.getElementById('bfile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (f) restoreBackup(f);
};

// ---------- jokes ----------
const activeSet = () => sets.find(x => x.id === lastSetId()) || sets[0];
const plural = n => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'шутка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'шутки' : 'шуток');
const updateCount = () => { document.getElementById('who').textContent = plural(jokes.length); };
function viewJokes() {
  updateCount();
  const a = backupAge();
  view.innerHTML = `<div class="bar"><input id="q" placeholder="Поиск по шуткам и тегам">
      <button class="b" id="new">＋ Шутка</button></div>
    ${backupStale() ? `<button class="stale-bar" id="stale">⚠ ${a === null ? 'Копии ещё не было' : `Копии нет ${a} дн.`} — сохранить</button>` : ''}
    <div id="list"></div>`;
  const draw = () => {
    const q = document.getElementById('q').value.toLowerCase();
    document.getElementById('list').innerHTML = jokes
      .filter(j => (j.title + j.text + (j.tags || []).join(' ')).toLowerCase().includes(q))
      .map(j => `<div class="card jc" data-id="${j.id}"><div><h3>${esc(j.title) || 'Без названия'}</h3>
        <p>${esc(j.text)}</p>
        <div class="meta">${lastRate(j) ? `<span class="rt r${lastRate(j)}" title="${RATE_NAME[lastRate(j)]}">${RATE[lastRate(j)]}</span>` : ''}${minStr(j.secs)} ${(j.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div></div></div>`).join('')
      || '<small>Пока пусто. Запиши первую шутку.</small>';
  };
  draw();
  document.getElementById('q').oninput = draw;
  document.getElementById('new').onclick = () => editJoke();
  if (document.getElementById('stale')) document.getElementById('stale').onclick = exportBackup;
  document.getElementById('list').onclick = e => { const c = e.target.closest('.card'); if (c) editJoke(c.dataset.id); };
}

// ---------- import one file -> many jokes ----------
const SPLITTERS = {
  blank: t => t.split(/\n\s*\n+/),
  dash: t => t.split(/^\s*[-*=_]{3,}\s*$/m),
  num: t => t.split(/\n(?=\s*\d+[.)]\s)/).map(p => p.replace(/^\s*\d+[.)]\s*/, '')),
  lines: t => t.split(/\n+/),
};
function importJokes(raw, fname) {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim();
  // если в файле есть линии --- , по пустым строкам шутки порвутся — берём линии
  let mode = /^\s*[-*=_]{3,}\s*$/m.test(text) ? 'dash' : 'blank';
  const draw = () => {
    const parts = SPLITTERS[mode](text).map(p => p.trim()).filter(Boolean);
    view.innerHTML = `<h2>Импорт</h2><p><small>${esc(fname)} · найдено шуток: ${parts.length}</small></p>
      <details ${mode === 'blank' ? '' : 'open'}><summary>ещё способы разделения</summary>
      <select id="mode">
        <option value="blank">Разделять по пустым строкам</option>
        <option value="dash">Разделять по линиям --- или ***</option>
        <option value="num">Разделять по нумерации (1. 2. 3.)</option>
        <option value="lines">Каждая строка — отдельная шутка</option></select></details>
      ${parts.map((p, i) => `<label class="card imp"><input type="checkbox" checked data-i="${i}"><div>${esc(p.length > 220 ? p.slice(0, 220) + '…' : p)}</div></label>`).join('')}
      <button class="b" id="ok">Добавить выбранные</button><button class="b g" id="back">Отмена</button>`;
    const $ = i => document.getElementById(i);
    $('mode').value = mode;
    $('mode').onchange = () => { mode = $('mode').value; draw(); };
    $('back').onclick = () => go('jokes');
    $('ok').onclick = () => {
      const picked = [...view.querySelectorAll('input[data-i]:checked')].map(c => parts[+c.dataset.i]);
      if (!picked.length) return alert('Ничего не выбрано');
      const fresh = picked.map(p => {
        const words = p.split(/\s+/).length;
        return { id: uid(), title: p.split('\n')[0].slice(0, 40), text: p, secs: Math.max(10, Math.round(words / 2.5)) };
      });
      jokes = [...fresh, ...jokes]; save('jokes', jokes); go('jokes');
    };
  };
  if (stage.running) return alert('Сначала закончи выступление.');
  tab = 'jokes'; document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'jokes'));
  view.onclick = null;
  draw();
}
function editJoke(id, from) {
  const back = () => from ? editSet(from) : viewJokes();
  const j = jokes.find(x => x.id === id) || { id: uid(), title: '', text: '', secs: 60, isNew: true };
  view.innerHTML = `<div class="topbar"><button class="b g sm" id="back">← Назад</button><b>${j.isNew ? 'Новая шутка' : 'Шутка'}</b>
      <button class="b sm" id="ok">Сохранить</button></div>
    <input id="t" placeholder="Название (его видно на сцене)" value="${esc(j.title)}">
    <textarea id="x" placeholder="Сетап… панчлайн… теги">${esc(j.text)}</textarea>
    <input id="g" placeholder="Теги через пробел (напр. работа семья)" value="${esc((j.tags || []).join(' '))}">
    <label class="lab">Длительность, мин</label>
    <input id="s" type="text" inputmode="decimal" value="${String(Math.round(j.secs / 0.6) / 100).replace('.', ',')}">
    ${j.isNew ? '' : `<label class="lab">Как зашла (последняя оценка)</label>
    <div class="rate" id="rt">${[1, 2, 3].map(l => `<button class="b g ic ${lastRate(j) === l ? 'on' : ''}" data-r="${l}" aria-label="${RATE_NAME[l]}">${RATE[l]}</button>`).join('')}</div>
    <small class="rn">${j.rates?.length ? `Оценок: ${j.rates.length}` : 'Оценок пока нет — они появятся после выступления.'}</small>
    <button class="b r sm del" id="del">Удалить шутку</button>`}`;
  const $ = i => document.getElementById(i);
  $('ok').onclick = () => {
    const { isNew, ...rest } = j;
    const min = parseFloat($('s').value.replace(',', '.'));
    Object.assign(rest, { title: $('t').value.trim(), text: $('x').value, secs: Number.isFinite(min) && min > 0 ? Math.round(min * 60) : 0,
      tags: $('g').value.split(/[\s,#]+/).filter(Boolean) });
    if (isNew) jokes.unshift(rest); else jokes[jokes.findIndex(x => x.id === j.id)] = rest;
    save('jokes', jokes); back();
  };
  $('back').onclick = back;
  if ($('rt')) $('rt').onclick = e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const l = +b.dataset.r, last = j.rates?.[j.rates.length - 1];
    setRate(j, last ? last.p : 'm' + Date.now(), last && last.l === l ? 0 : l);
    save('jokes', jokes);
    const now = lastRate(j);
    $('rt').querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', +x.dataset.r === now));
    document.querySelector('.rn').textContent = j.rates.length ? `Оценок: ${j.rates.length}` : 'Оценок пока нет — они появятся после выступления.';
  };
  if ($('del')) $('del').onclick = () => {
    if (!confirm('Удалить шутку?')) return;
    jokes = jokes.filter(x => x.id !== j.id);
    sets.forEach(s => s.items = s.items.filter(i => i !== j.id));
    save('jokes', jokes); save('sets', sets); back();
  };
}

// ---------- sets ----------
const setTime = s => s.items.reduce((a, i) => a + (jokes.find(j => j.id === i)?.secs || 0), 0);
function createSet() {
  const name = prompt('Название сета (напр. «Open mic в пятницу»)'); if (!name) return;
  const s = { id: uid(), name, items: [], limit: 5 }; sets.push(s); save('sets', sets); setLast(s.id); editSet(s.id);
}
// вкладка сразу открывает последний открытый сет; список — по кнопке «Все сеты»
function viewSets(list) {
  if (list !== true && sets.length) return editSet(activeSet().id);
  view.innerHTML = `<button class="b" id="new">＋ Новый сет</button>` +
    (sets.map(s => `<div class="card" data-id="${s.id}"><b>${esc(s.name)}</b>
      <small> · ${plural(s.items.length)} · ~${fmt(setTime(s))} из ${s.limit} мин</small></div>`).join('')
      || '<br><small>Сет-листов пока нет.</small>');
  document.getElementById('new').onclick = createSet;
  view.onclick = e => { const c = e.target.closest('.card'); if (c) editSet(c.dataset.id); };
}
function editSet(id) {
  const s = sets.find(x => x.id === id);
  if (!s) return viewSets(true);
  setLast(s.id);
  const draw = () => {
    const pool = jokes.filter(j => !s.items.includes(j.id));
    view.innerHTML = `<div class="topbar"><button class="b g sm" id="all">☰ Все сеты</button><button class="b g sm" id="mk">＋ Новый</button></div>
      <h2>${esc(s.name)}</h2>
      <div class="card stat"><div><small>Материал / слот</small><b>${fmt(setTime(s))} / ${s.limit}:00</b></div>
        <div><small>Слот, мин</small><input id="lim" type="number" min="1" value="${s.limit}"></div></div>
      ${s.items.map((i, n) => { const j = jokes.find(x => x.id === i); return j ? `<div class="card srow">
        <span class="n">${n + 1}</span><span class="tt"><span class="t" data-open="${j.id}">${esc(j.title || j.text.slice(0, 30))}</span><span class="m">${minStr(j.secs)}</span></span>
        <button class="b ic" data-up="${n}">↑</button><button class="b ic" data-dn="${n}">↓</button>
        <button class="b ic" data-rm="${n}">✕</button></div>` : ''; }).join('')}
      <select id="add"><option value="">+ Добавить шутку…</option>
        ${pool.map(j => `<option value="${j.id}">${esc(j.title || j.text.slice(0, 30))}</option>`).join('')}</select>
      <button class="b v wide" id="go">На сцену</button>
      <button class="b r sm del" id="del">Удалить сет</button>`;
    const $ = i => document.getElementById(i);
    $('all').onclick = () => viewSets(true);
    $('mk').onclick = createSet;
    $('lim').onchange = () => { s.limit = +$('lim').value || 5; save('sets', sets); draw(); };
    $('add').onchange = () => { if ($('add').value) { s.items.push($('add').value); save('sets', sets); draw(); } };
    $('go').onclick = () => go('stage');
    $('del').onclick = () => {
      if (!confirm('Удалить сет?')) return;
      sets = sets.filter(x => x !== s); save('sets', sets);
      if (lastSetId() === s.id) localStorage.removeItem(key('lastset'));
      viewSets(true);
    };
    view.onclick = e => {
      const open = e.target.closest('[data-open]')?.dataset.open; if (open) return editJoke(open, s.id);
      const d = e.target.closest('[data-up],[data-dn],[data-rm]')?.dataset; if (!d) return;
      const sw = (a, b) => [s.items[a], s.items[b]] = [s.items[b], s.items[a]];
      if (d.up > 0) sw(+d.up, d.up - 1); else if (d.dn !== undefined && +d.dn < s.items.length - 1) sw(+d.dn, +d.dn + 1);
      else if (d.rm !== undefined) s.items.splice(+d.rm, 1); else return;
      save('sets', sets); draw();
    };
  };
  draw();
}

// ---------- stage ----------
const stage = { setId: null, idx: 0, running: false, t0: 0, mr: null, chunks: [], stream: null, wake: null, tick: null, full: null };
function viewStage() {
  if (stage.running) return drawStage();
  const cur = activeSet();
  if (!cur) return view.innerHTML = '<div class="stage"><small>Сначала создай сет-лист.</small></div>';
  view.innerHTML = `<div class="stage"><div class="time" id="time">${fmt((cur.limit || 5) * 60)}</div>
    <select id="set">${sets.map(s => `<option value="${s.id}" ${s.id === cur.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <small>Звук зала запишется автоматически — браузер спросит доступ к микрофону.</small><br><br>
    <button class="b v wide" id="go">▶ Начать выступление</button></div>`;
  document.getElementById('set').onchange = e => { setLast(e.target.value); viewStage(); };
  document.getElementById('go').onclick = startShow;
}
async function startShow() {
  const sel = document.getElementById('set').value; if (!sel) return alert('Нет сет-листа');
  setLast(sel);
  stage.setId = sel; stage.idx = 0; stage.chunks = []; stage.mr = null; stage.full = null;
  try {
    stage.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stage.mr = new MediaRecorder(stage.stream);
    stage.mr.ondataavailable = e => e.data.size && stage.chunks.push(e.data);
    stage.mr.start(1000);
  } catch { if (!confirm('Нет доступа к микрофону. Продолжить без записи?')) return; stage.mr = null; }
  try { stage.wake = await navigator.wakeLock?.request('screen'); } catch {}
  stage.running = true; stage.t0 = Date.now();
  stage.tick = setInterval(drawTime, 250);
  drawStage();
}
function drawStage() {
  const s = sets.find(x => x.id === stage.setId);
  view.innerHTML = `<div class="stage"><div class="time" id="time"></div>
    <small id="sub"></small>
    <div class="ctrl"><button class="b g" id="prev">←</button><button class="b" id="next">→</button></div>
    <small class="hint">${stage.mr ? '● идёт запись' : 'без записи'} · нажми на название — покажу текст целиком</small>
    <div class="setlist" id="sl">${s.items.map((id, n) => {
      const q = jokes.find(x => x.id === id); if (!q) return '';
      const cls = n < stage.idx ? 'done' : n === stage.idx ? 'cur' : '';
      return `<div class="si ${cls}" data-go="${n}"><h3>${n + 1}. ${esc(q.title || q.text.slice(0, 30))}</h3>${cls === 'cur' && stage.full === id ? `<div class="txt">${esc(q.text)}</div>` : ''}</div>`;
    }).join('') || '<small>Сет-лист пуст</small>'}</div>
    ${stage.idx >= s.items.length ? '<h3>Сет закончился</h3>' : ''}
    <br><button class="b r" id="stop">■ Закончить</button></div>`;
  drawTime();
  const $ = i => document.getElementById(i);
  $('prev').onclick = () => { stage.idx = Math.max(0, stage.idx - 1); stage.full = null; drawStage(); };
  $('next').onclick = () => { stage.idx = Math.min(s.items.length, stage.idx + 1); stage.full = null; drawStage(); };
  $('stop').onclick = stopShow;
  $('sl').onclick = e => {
    const n = e.target.closest('[data-go]')?.dataset.go; if (n === undefined) return;
    if (+n === stage.idx) { const id = s.items[stage.idx]; stage.full = stage.full === id ? null : id; }
    else { stage.idx = +n; stage.full = null; }
    drawStage();
  };
}
function drawTime() {
  const el = document.getElementById('time'); if (!el) return;
  const s = sets.find(x => x.id === stage.setId), left = s.limit * 60 - (Date.now() - stage.t0) / 1000;
  el.textContent = (left < 0 ? '+' : '') + fmt(Math.abs(left));
  el.className = 'time' + (left < 0 ? ' over' : left < 60 ? ' warn' : '');
  const sub = document.getElementById('sub');
  if (sub) sub.textContent = `прошло ${fmt((Date.now() - stage.t0) / 1000)} из ${s.limit}:00`;
}
async function stopShow() {
  if (!confirm('Закончить выступление?')) return;
  clearInterval(stage.tick); stage.running = false;
  const duration = (Date.now() - stage.t0) / 1000;
  stage.wake?.release?.();
  let blob = null, ext = 'webm';
  if (stage.mr) {
    await new Promise(r => { stage.mr.onstop = r; stage.mr.stop(); });
    stage.stream.getTracks().forEach(t => t.stop());
    blob = new Blob(stage.chunks, { type: stage.mr.mimeType });
    ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  }
  stage.mr = null;
  drawResult(sets.find(x => x.id === stage.setId), duration, blob, ext);
}
// итог выступления: оценка каждой шутки (по записи или по памяти) сохраняется в шутке и меняется потом в редакторе
function drawResult(s, duration, blob, ext) {
  const P = String(stage.t0);
  const rows = s.items.map(id => {
    const q = jokes.find(x => x.id === id); if (!q) return '';
    const cur = q.rates?.find(r => r.p === P)?.l;
    return `<div class="card rrow" data-j="${id}"><span class="t">${esc(q.title || q.text.slice(0, 30))}</span>
      <span class="rate">${[1, 2, 3].map(l => `<button class="b g ic ${cur === l ? 'on' : ''}" data-r="${l}" aria-label="${RATE_NAME[l]}">${RATE[l]}</button>`).join('')}</span></div>`;
  }).join('');
  const name = `${s.name}-${new Date().toISOString().slice(0, 10)}`;
  const url = blob && URL.createObjectURL(blob);
  view.innerHTML = `<div class="stage"><h2>Готово · ${fmt(duration)}</h2>
    ${blob ? `<a class="b v wide" id="save" download="${esc(name)}.${ext}" href="${url}">⇩ Сохранить запись</a><br><br><audio controls src="${url}"></audio><br><br>` : '<small>Запись не велась.</small><br><br>'}
    <small>Как зашла каждая шутка: − не смешно · ○ нормально · + смешно</small><br><br>
    ${rows}<br><button class="b g wide" id="done">Готово</button></div>`;
  view.onclick = e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const row = b.closest('[data-j]'), q = jokes.find(x => x.id === row.dataset.j), l = +b.dataset.r;
    if (!q) return;
    const cur = q.rates?.find(r => r.p === P)?.l;
    setRate(q, P, cur === l ? 0 : l); save('jokes', jokes);
    const now = q.rates.find(r => r.p === P)?.l;
    row.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', +x.dataset.r === now));
  };
  document.getElementById('done').onclick = () => { if (url) URL.revokeObjectURL(url); go('jokes'); };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
migrate();
jokes = load('jokes', []); sets = load('sets', []);
navigator.storage?.persist?.().catch(() => {}); // просим браузер не стирать данные при нехватке места
go('jokes');
