'use strict';
// ---------- storage ----------
let user = localStorage.getItem('buddy_session');
const key = k => `buddy_${user}_${k}`;
const load = (k, d) => JSON.parse(localStorage.getItem(key(k)) || 'null') ?? d;
const save = (k, v) => localStorage.setItem(key(k), JSON.stringify(v));
let jokes = [];
let sets = [];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

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

// ---------- accounts (local to this device) ----------
const enc = new TextEncoder();
async function hashPw(pw, salt) {
  if (!globalThis.crypto?.subtle) { // http:// без HTTPS: crypto.subtle недоступен, простой запасной хеш (аккаунты и так локальные)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (const ch of salt + pw) { const c = ch.codePointAt(0); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'f' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function viewAuth(mode = 'login') {
  document.body.classList.remove('authed');
  const reg = mode === 'register';
  view.onclick = null;
  view.innerHTML = `<div class="auth"><img src="logo-t.png" alt=""><span class="brand">БАДДИ</span>
    <p><small>Твой карманный напарник для сцены</small></p>
    <input id="u" placeholder="Имя" autocomplete="username">
    <input id="p" type="password" placeholder="Пароль" autocomplete="${reg ? 'new-password' : 'current-password'}">
    ${reg ? '<input id="p2" type="password" placeholder="Повтори пароль" autocomplete="new-password">' : ''}
    <div class="err" id="err"></div>
    <button class="b" id="ok">${reg ? 'Создать аккаунт' : 'Войти'}</button>
    <button class="b g" id="sw">${reg ? 'У меня есть аккаунт' : 'Регистрация'}</button>
    <button class="b g" id="guest">Войти без пароля</button>
    <small>Гостевые данные лежат только на этом устройстве</small></div>`;
  const $ = i => document.getElementById(i);
  $('sw').onclick = () => viewAuth(reg ? 'login' : 'register');
  $('guest').onclick = () => { user = 'guest'; localStorage.setItem('buddy_session', user); enter(); };
  $('ok').onclick = async () => {
    const name = $('u').value.trim().toLowerCase(), pw = $('p').value;
    const accounts = load0('buddy_accounts');
    const fail = m => $('err').textContent = m;
    if (!name || !pw) return fail('Введи имя и пароль');
    if (reg) {
      if (pw.length < 6) return fail('Пароль — минимум 6 символов');
      if (pw !== $('p2').value) return fail('Пароли не совпадают');
      if (accounts[name]) return fail('Такое имя уже занято');
      const salt = uid() + uid();
      accounts[name] = { salt, hash: await hashPw(pw, salt) };
      localStorage.setItem('buddy_accounts', JSON.stringify(accounts));
    } else {
      const a = accounts[name];
      if (!a || a.hash !== await hashPw(pw, a.salt)) return fail('Неверное имя или пароль');
    }
    user = name; localStorage.setItem('buddy_session', user); enter();
  };
}
const load0 = k => JSON.parse(localStorage.getItem(k) || '{}');
function enter() {
  jokes = load('jokes', []); sets = load('sets', []);
  navigator.storage?.persist?.().catch(() => {}); // просим браузер не стирать данные при нехватке места
  document.body.classList.add('authed');
    go('jokes');
}
document.getElementById('logout').onclick = () => {
  if (stage.running) return alert('Сначала закончи выступление.');
  localStorage.removeItem('buddy_session'); user = null; viewAuth();
};

// ---------- backup helpers ----------
const bkKey = () => key('lastbackup');
const markBackup = () => localStorage.setItem(bkKey(), String(Date.now()));
const backupAge = () => { const t = +localStorage.getItem(bkKey()); return t ? Math.floor((Date.now() - t) / 864e5) : null; };
const backupStale = () => (jokes.length || sets.length) && (backupAge() === null || backupAge() >= 7);
const backupStatus = () => {
  const a = backupAge();
  return 'Данные хранятся только на этом устройстве. ' +
    (a === null ? 'Копии ещё не было.' : a === 0 ? 'Последняя копия — сегодня.' : `Последняя копия — ${a} дн. назад.`) +
    ' Нажми «Сохранить копию» и выбери «Сохранить в Файлы».';
};
const backupName = sfx => `buddy-${user}-${new Date().toISOString().slice(0, 10)}${sfx ? '-' + sfx : ''}.json`;
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

// ---------- jokes ----------
const activeSet = () => sets.find(x => x.id === stage.setId) || sets[0];
function newSet(name = prompt('Название сета (напр. «Open mic в пятницу»)')) {
  if (!name) return null;
  const s = { id: uid(), name, items: [], limit: 5 }; sets.push(s); stage.setId = s.id; save('sets', sets); return s;
}
const plural = n => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'шутка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'шутки' : 'шуток');
const updateCount = () => { document.getElementById('who').textContent = plural(jokes.length); };
function viewJokes() {
  updateCount();
  view.innerHTML = `<div class="bar"><input id="q" placeholder="Поиск по шуткам и тегам">
      <button class="b" id="new">＋ Шутка</button></div>
    <button class="b g" id="imp">⇪ Импорт из файла</button>
    <input type="file" id="file" accept=".txt,.md,.text,text/plain" hidden>
    <div id="setbar"></div>
    <div id="list"></div>
    <div class="backup"><small id="bstat"></small>
      <button class="b g" id="exp">⇩ Сохранить копию</button>
      <button class="b g" id="rest">⇧ Восстановить</button>
      <input type="file" id="bfile" accept=".json,application/json" hidden></div>`;
  const draw = () => {
    const q = document.getElementById('q').value.toLowerCase(), cur = activeSet();
    document.getElementById('setbar').innerHTML = `<div class="bar"><small style="align-self:center;white-space:nowrap">Добавляю в сет:</small>
      <select id="aset" style="margin:0">${sets.map(x => `<option value="${x.id}" ${cur && x.id === cur.id ? 'selected' : ''}>${esc(x.name)} (${x.items.length})</option>`).join('')}
      <option value="+new">＋ Новый сет…</option>${cur ? '' : '<option value="" selected>— пока нет сетов —</option>'}</select></div>`;
    document.getElementById('aset').onchange = e => {
      if (e.target.value === '+new') { if (!newSet()) return draw(); } else stage.setId = e.target.value;
      draw();
    };
    document.getElementById('list').innerHTML = jokes
      .filter(j => (j.title + j.text + (j.tags || []).join(' ')).toLowerCase().includes(q))
      .map(j => `<div class="card jc" data-id="${j.id}"><div><h3>${esc(j.title) || 'Без названия'}</h3>
        <p>${esc(j.text)}</p>
        <div class="meta">${fmt(j.secs || 0)} ${(j.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div></div>
        <div class="side"><button class="b sm ${cur?.items.includes(j.id) ? '' : 'g'}" data-tog="${j.id}">${cur?.items.includes(j.id) ? '✓ В сете' : '＋ В сет'}</button>
        <button class="b g sm" data-del="${j.id}">🗑</button></div></div>`).join('')
      || '<small>Пока пусто. Запиши первую шутку.</small>';
  };
  draw();
  document.getElementById('q').oninput = draw;
  document.getElementById('new').onclick = () => editJoke();
  document.getElementById('imp').onclick = () => document.getElementById('file').click();
  document.getElementById('file').onchange = async e => {
    const f = e.target.files[0]; if (f) importJokes(await f.text(), f.name);
  };
  document.getElementById('list').onclick = e => {
    const d = e.target.closest('[data-tog],[data-del]')?.dataset;
    if (d?.tog) {
      const cur = activeSet() || newSet('Мой сет');
      if (!cur) return;
      const i = cur.items.indexOf(d.tog); if (i < 0) cur.items.push(d.tog); else cur.items.splice(i, 1);
      save('sets', sets); return draw();
    }
    if (d?.del) {
      if (!confirm('Удалить шутку?')) return;
      jokes = jokes.filter(x => x.id !== d.del); sets.forEach(s => s.items = s.items.filter(i => i !== d.del));
      save('jokes', jokes); save('sets', sets); return viewJokes();
    }
    const c = e.target.closest('.card'); if (c) editJoke(c.dataset.id);
  };
  const bstat = document.getElementById('bstat');
  bstat.textContent = backupStatus(); bstat.classList.toggle('stale', !!backupStale());
  document.getElementById('exp').onclick = async () => {
    const blob = new Blob([JSON.stringify({ app: 'comedyos', v: 1, jokes, sets }, null, 2)], { type: 'application/json' });
    if (await shareFile(blob, backupName())) { markBackup(); viewJokes(); }
  };
  document.getElementById('rest').onclick = () => document.getElementById('bfile').click();
  document.getElementById('bfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'comedyos' || !Array.isArray(d.jokes) || !Array.isArray(d.sets)) throw 0;
      if (!confirm(`В копии: шуток ${d.jokes.length}, сетов ${d.sets.length}. Заменить текущие данные?`)) return;
      jokes = d.jokes; sets = d.sets; save('jokes', jokes); save('sets', sets);
      markBackup(); viewJokes();
    } catch { alert('Это не файл копии БАДДИ.'); }
  };
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
  let mode = /^\s*[-*=_]{3,}\s*$/m.test(text) ? 'dash' : 'blank';
  const draw = () => {
    const parts = SPLITTERS[mode](text).map(p => p.trim()).filter(Boolean);
    view.innerHTML = `<h2>Импорт</h2><p><small>${esc(fname)} · найдено шуток: ${parts.length}</small></p>
      <select id="mode">
        <option value="blank">Разделять по пустым строкам</option>
        <option value="dash">Разделять по линиям --- или ***</option>
        <option value="num">Разделять по нумерации (1. 2. 3.)</option>
        <option value="lines">Каждая строка — отдельная шутка</option></select>
      ${parts.map((p, i) => `<label class="card imp"><input type="checkbox" checked data-i="${i}"><div>${esc(p.length > 220 ? p.slice(0, 220) + '…' : p)}</div></label>`).join('')}
      <button class="b" id="ok">Добавить выбранные</button><button class="b g" id="back">Отмена</button>`;
    const $ = i => document.getElementById(i);
    $('mode').value = mode;
    $('mode').onchange = () => { mode = $('mode').value; draw(); };
    $('back').onclick = viewJokes;
    $('ok').onclick = () => {
      const picked = [...view.querySelectorAll('input[data-i]:checked')].map(c => parts[+c.dataset.i]);
      if (!picked.length) return alert('Ничего не выбрано');
      const fresh = picked.map(p => {
        const words = p.split(/\s+/).length;
        return { id: uid(), title: p.split('\n')[0].slice(0, 40), text: p, secs: Math.max(10, Math.round(words / 2.5)) };
      });
      jokes = [...fresh, ...jokes]; save('jokes', jokes); viewJokes();
    };
  };
  draw();
}
function editJoke(id) {
  const j = jokes.find(x => x.id === id) || { id: uid(), title: '', text: '', secs: 60, isNew: true };
  view.innerHTML = `<h2>${j.isNew ? 'Новая шутка' : 'Шутка'}</h2>
    <input id="t" placeholder="Название" value="${esc(j.title)}">
    <input id="g" placeholder="Теги через пробел (напр. работа семья)" value="${esc((j.tags || []).join(' '))}">
    <input id="sh" placeholder="Кратко для сцены: опорные слова (необязательно)" value="${esc(j.short || '')}">
    <textarea id="x" placeholder="Сетап… панчлайн… теги">${esc(j.text)}</textarea>
    <label><small>Длительность, сек</small></label>
    <input id="s" type="number" min="0" value="${j.secs}">
    <button class="b" id="ok">Сохранить</button><button class="b g" id="back">Назад</button>
    ${j.isNew ? '' : '<button class="b r" id="del">Удалить</button>'}`;
  const $ = i => document.getElementById(i);
  $('ok').onclick = () => {
    const { isNew, ...rest } = j;
    Object.assign(rest, { title: $('t').value.trim(), short: $('sh').value.trim(), text: $('x').value, secs: +$('s').value || 0,
      tags: $('g').value.split(/[\s,#]+/).filter(Boolean) });
    if (isNew) jokes.unshift(rest); else jokes[jokes.findIndex(x => x.id === j.id)] = rest;
    save('jokes', jokes); viewJokes();
  };
  $('back').onclick = viewJokes;
  if ($('del')) $('del').onclick = () => {
    if (!confirm('Удалить шутку?')) return;
    jokes = jokes.filter(x => x.id !== j.id);
    sets.forEach(s => s.items = s.items.filter(i => i !== j.id));
    save('jokes', jokes); save('sets', sets); viewJokes();
  };
}

// ---------- sets ----------
const setTime = s => s.items.reduce((a, i) => a + (jokes.find(j => j.id === i)?.secs || 0), 0);
function viewSets() {
  view.innerHTML = `<button class="b" id="new">＋ Новый сет</button>` +
    (sets.map(s => `<div class="card" data-id="${s.id}"><b>${esc(s.name)}</b>
      <small> · ${plural(s.items.length)} · ~${fmt(setTime(s))} из ${s.limit} мин</small></div>`).join('')
      || '<br><small>Сет-листов пока нет.</small>');
  document.getElementById('new').onclick = () => {
    const name = prompt('Название сета (напр. «Open mic в пятницу»)'); if (!name) return;
    const s = { id: uid(), name, items: [], limit: 5 }; sets.push(s); save('sets', sets); editSet(s.id);
  };
  view.onclick = e => { const c = e.target.closest('.card'); if (c) editSet(c.dataset.id); };
}
function editSet(id) {
  const s = sets.find(x => x.id === id);
  const draw = () => {
    const pool = jokes.filter(j => !s.items.includes(j.id));
    view.innerHTML = `<h2>${esc(s.name)}</h2>
      <div class="card stat"><div><small>Материал / слот</small><b>${fmt(setTime(s))} / ${s.limit}:00</b></div>
        <div><small>Слот, мин</small><input id="lim" type="number" min="1" value="${s.limit}"></div></div>
      ${s.items.map((i, n) => { const j = jokes.find(x => x.id === i); return j ? `<div class="card srow">
        <span class="n">${n + 1}</span><span class="t">${esc(j.title || j.text.slice(0, 30))}</span><span class="m">${fmt(j.secs || 0)}</span>
        <button class="b ic" data-up="${n}">↑</button><button class="b ic" data-dn="${n}">↓</button>
        <button class="b ic" data-rm="${n}">✕</button></div>` : ''; }).join('')}
      <select id="add"><option value="">+ Добавить шутку…</option>
        ${pool.map(j => `<option value="${j.id}">${esc(j.title || j.text.slice(0, 30))}</option>`).join('')}</select>
      <button class="b v wide" id="go">На сцену</button>
      <button class="b g" id="back">Назад</button><button class="b r" id="del">Удалить сет</button>`;
    const $ = i => document.getElementById(i);
    $('lim').onchange = () => { s.limit = +$('lim').value || 5; save('sets', sets); draw(); };
    $('add').onchange = () => { if ($('add').value) { s.items.push($('add').value); save('sets', sets); draw(); } };
    $('back').onclick = viewSets;
    $('go').onclick = () => { stage.setId = s.id; go('stage'); };
    $('del').onclick = () => { if (confirm('Удалить сет?')) { sets = sets.filter(x => x !== s); save('sets', sets); viewSets(); } };
    view.onclick = e => {
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
const stage = { setId: null, idx: 0, running: false, t0: 0, marks: [], mr: null, chunks: [], stream: null, wake: null, tick: null, full: null };
// краткая версия для сцены: своё поле «short» или начало текста
const briefOf = q => {
  if (q.short) return q.short;
  const t = q.text.replace(/\s+/g, ' ').trim();
  return t.length > 70 ? t.slice(0, 70).replace(/\s+\S*$/, '') + '…' : t;
};
const MARK = ['', '😐', '🙂', '😂'], MARK_NAME = ['', 'не смешно', 'нормально', 'смешно'];
function viewStage() {
  if (stage.running) return drawStage();
  const cur = activeSet();
  if (!cur) return view.innerHTML = '<div class="stage"><small>Сначала создай сет-лист.</small></div>';
  view.innerHTML = `<div class="stage"><div class="time" id="time">${fmt((cur?.limit || 5) * 60)}</div>
    <select id="set">${sets.map(s => `<option value="${s.id}" ${s.id === cur.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <small>Звук зала запишется автоматически — браузер спросит доступ к микрофону.</small><br><br>
    <button class="b v wide" id="go">▶ Начать выступление</button></div>`;
  document.getElementById('go').onclick = startShow;
}
async function startShow() {
  const sel = document.getElementById('set').value; if (!sel) return alert('Нет сет-листа');
  stage.setId = sel; stage.idx = 0; stage.marks = []; stage.chunks = []; stage.mr = null;
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
    <small class="hint">${stage.mr ? '● идёт запись' : 'без записи'} · нажми на шутку — покажу текст целиком</small>
    <div class="setlist" id="sl">${s.items.map((id, n) => {
      const q = jokes.find(x => x.id === id); if (!q) return '';
      const cls = n < stage.idx ? 'done' : n === stage.idx ? 'cur' : '';
      const m = stage.marks.filter(x => x.jokeId === id).pop();
      const full = stage.full === id;
      return `<div class="si ${cls}" data-go="${n}"><h3>${n + 1}. ${esc(q.title || q.text.slice(0, 30))} ${m ? MARK[m.level] : ''}</h3>${cls === 'cur' ? `<div class="txt ${full ? '' : 'brief'}">${esc(full ? q.text : briefOf(q))}</div>${!full && briefOf(q) !== q.text ? '<small class="more">нажми — полный текст</small>' : ''}` : ''}</div>`;
    }).join('') || '<small>Сет-лист пуст</small>'}</div>
    ${stage.idx >= s.items.length ? '<h3>Сет закончился</h3>' : ''}
    <div class="marks"><button class="b g" data-m="1">😐</button><button class="b g" data-m="2">🙂</button><button class="b g" data-m="3">😂</button></div>
    <small>Оценка текущей шутки: 😐 не смешно · 🙂 нормально · 😂 смешно</small><br><br>
    <button class="b r" id="stop">■ Закончить</button></div>`;
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
  view.querySelector('.marks').onclick = e => {
    const lvl = +e.target.dataset.m; const id = s.items[stage.idx];
    if (!lvl || !id) return;
    stage.marks.push({ t: (Date.now() - stage.t0) / 1000, level: lvl, jokeId: id });
    navigator.vibrate?.(30); drawStage();
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
// итог выступления: оценки по шуткам + кнопка сохранения записи
function drawResult(s, duration, blob, ext) {
  const rows = s.items.map(id => {
    const q = jokes.find(x => x.id === id); if (!q) return '';
    const ms = stage.marks.filter(m => m.jokeId === id);
    const last = ms[ms.length - 1];
    return `<div class="card"><b>${esc(q.title || q.text.slice(0, 30))}</b> ${last ? `${MARK[last.level]} <small>${MARK_NAME[last.level]}</small>` : '<small>без оценки</small>'}</div>`;
  }).join('');
  const name = `${s.name}-${new Date().toISOString().slice(0, 10)}`;
  const url = blob && URL.createObjectURL(blob);
  view.innerHTML = `<div class="stage"><h2>Готово · ${fmt(duration)}</h2>
    ${blob ? `<a class="b v wide" id="save" download="${esc(name)}.${ext}" href="${url}">⇩ Сохранить запись</a><br><br><audio controls src="${url}"></audio><br><br>` : '<small>Запись не велась.</small><br><br>'}
    ${rows}<br><button class="b g wide" id="done">Готово</button></div>`;
  document.getElementById('done').onclick = () => { if (url) URL.revokeObjectURL(url); go('jokes'); };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
const known = load0('buddy_accounts');
if (user && (user === 'guest' || known[user])) enter(); else { user = null; viewAuth(); }
