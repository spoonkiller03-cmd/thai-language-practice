'use strict';
/* Thai Practice — a small offline-first study app.
   Content lives in data/lessons/*.json (listed in data/index.json).
   Progress is stored on this device only (localStorage) and can be exported. */

const APP_VERSION = '1.3.0';
const STORE_KEY = 'thai-practice.v1';
const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // days, by box

const app = document.getElementById('app');
let LESSONS = [];
let CARDS = [];

/* ---------- state ---------- */
function defaultState() {
  return { cards: {}, day: '', newCount: 0, settings: { newPerDay: 12, sessionSize: 20, rate: 0.85, off: {} } };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch (e) { /* storage unavailable */ }
  return defaultState();
}
let S = loadState();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function rollDay() { const t = todayStr(); if (S.day !== t) { S.day = t; S.newCount = 0; save(); } }

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const plain = (r) => r.replace(/[\[\]]/g, '');
function show(...nodes) { app.replaceChildren(...nodes.filter(Boolean)); window.scrollTo(0, 0); }

/* ---------- answer checking ---------- */
const PARTICLES = ['ka', 'kha', 'krap', 'khrap', 'na'];
function stripMarks(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function norm(s, level) {
  s = (s || '').normalize('NFD').toLowerCase()
    .replace(/[“”"‘’'?!.,;:…()]/g, ' ').replace(/\.\.\./g, ' ').replace(/—|–/g, ' ');
  let toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && PARTICLES.includes(stripMarks(toks[toks.length - 1]))) toks.pop();
  s = toks.join('').replace(/-/g, '');
  if (level >= 1) s = s.replace(/[̀-ͯ]/g, '');
  if (level >= 2) s = s.replace(/ɔ/g, 'o').replace(/ɛ/g, 'e').replace(/ʉ/g, 'u').replace(/ə/g, 'e').replace(/(.)\1+/g, '$1');
  return s;
}
/* ---------- speech ---------- */
let thaiVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  thaiVoice = vs.find((v) => /^th/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function canSpeak() { return 'speechSynthesis' in window; }
function speak(text, slow) {
  if (!canSpeak() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[—–]/g, ' '));
  u.lang = 'th-TH';
  if (thaiVoice) u.voice = thaiVoice;
  u.rate = slow ? 0.6 : S.settings.rate;
  speechSynthesis.speak(u);
}
function audioRow(th) {
  if (!th || !canSpeak()) return null;
  return h('div', { class: 'audio' },
    h('button', { onclick: () => speak(th) }, '🔊 Play'),
    h('button', { onclick: () => speak(th, true) }, '🐢 Slow'));
}

/* ---------- data ---------- */
async function loadData() {
  const idx = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
  const files = await Promise.all(idx.lessons.map((f) => fetch('data/lessons/' + f, { cache: 'no-cache' }).then((r) => r.json())));
  LESSONS = files;
  buildCards();
}
function buildCards() {
  CARDS = [];
  for (const L of LESSONS) {
    for (const [r, th, en] of L.vocab || []) {
      CARDS.push({ id: 'vr:' + r, kind: 'vocabRec', lesson: L.id, r, th, en });
      CARDS.push({ id: 'vp:' + r, kind: 'vocabProd', lesson: L.id, r, th, en });
    }
    for (const [r, th, en, emo] of L.sentences || []) {
      const p = plain(r);
      if (emo) CARDS.push({ id: 'e:' + p, kind: 'recall', lesson: L.id, r: p, th, en, emo });
      const m = r.match(/\[([^\]]+)\]/);
      if (m) CARDS.push({ id: 'c:' + p, kind: 'cloze', lesson: L.id, r, th, en, target: m[1] });
      if (th) CARDS.push({ id: 'l:' + p, kind: 'listen', lesson: L.id, r: p, th, en });
    }
    for (const q of L.qa || []) CARDS.push({ id: 'q:' + q.ctx + q.q, kind: 'qa', lesson: L.id, ...q });
  }
}
const lessonOn = (id) => !S.settings.off[id];
const enabledCards = () => CARDS.filter((c) => lessonOn(c.lesson));
function enabledGenerators() {
  const g = new Set();
  for (const L of LESSONS) if (lessonOn(L.id)) (L.generators || []).forEach((x) => g.add(x));
  return [...g];
}

/* ---------- spaced repetition ---------- */
function isDue(c) { const st = S.cards[c.id]; return st && st.due <= Date.now(); }
function grade(item, result) {
  if (!item || !item.id || item.gen) return;
  const now = Date.now();
  let st = S.cards[item.id];
  if (!st) { st = { b: 0, due: now }; S.newCount++; }
  if (result === 'right') { st.b = Math.min(st.b + 1, INTERVALS.length - 1); st.due = now + INTERVALS[st.b] * DAY - 3600000; }
  else if (result === 'almost') { st.b = Math.max(1, st.b); st.due = now + DAY - 3600000; }
  else { st.b = 1; st.due = now + 10 * 60000; }
  st.seen = (st.seen || 0) + 1;
  S.cards[item.id] = st;
  save();
}
function counts() {
  rollDay();
  const en = enabledCards();
  const due = en.filter(isDue).length;
  const unseen = en.filter((c) => !S.cards[c.id]).length;
  const newLeft = Math.min(unseen, Math.max(0, S.settings.newPerDay - S.newCount));
  return { due, newLeft, unseen, total: en.length };
}
function pickNew(n, pool) {
  const out = [];
  const fresh = shuffle(pool.filter((c) => !S.cards[c.id]));
  for (let c of fresh) {
    if (out.length >= n) break;
    // learn to recognise a word before you have to produce it
    if (c.kind === 'vocabProd' && !S.cards['vr:' + c.r]) {
      const rec = CARDS.find((x) => x.id === 'vr:' + c.r);
      if (rec && !out.includes(rec)) c = rec; else continue;
    }
    if (!out.includes(c)) out.push(c);
  }
  return out;
}
function dailyItems() {
  rollDay();
  const size = S.settings.sessionSize;
  const en = enabledCards();
  const due = shuffle(en.filter(isDue)).slice(0, size);
  const { newLeft } = counts();
  const fresh = pickNew(Math.min(newLeft, Math.max(0, size - due.length)), en);
  let items = shuffle(due.concat(fresh));
  if (!items.length) items = shuffle(en.filter((c) => S.cards[c.id])).slice(0, size); // nothing due: early review
  const gens = enabledGenerators();
  if (gens.length) for (let i = 0; i < 3; i++) items.splice(rand(items.length + 1), 0, makeGen(pick(gens)));
  return items;
}

/* ---------- generators (fresh, random items) ---------- */
const DAYS = [['wan jan', 'Monday', 'Mon'], ['wan angkaan', 'Tuesday', 'Tue'], ['wan pút', 'Wednesday', 'Wed'], ['wan pá-rʉ́-hàt', 'Thursday', 'Thu'], ['wan sùk', 'Friday', 'Fri'], ['wan sǎo', 'Saturday', 'Sat'], ['wan aatít', 'Sunday', 'Sun']];
function thaiTime(hr, m) {
  let bases;
  if (hr === 0) bases = ['tîang kʉʉn'];
  else if (hr <= 5) bases = ['dtii ' + hr];
  else if (hr <= 11) bases = [hr + ' moong cháao', hr + ' moong'];
  else if (hr === 12) bases = ['tîang', 'tîang wan'];
  else if (hr === 13) bases = ['bàai moong', 'bàai 1 moong'];
  else if (hr <= 15) { bases = ['bàai ' + (hr - 12) + ' moong', 'bàai ' + (hr - 12)]; if (hr === 15) bases.push('3 moong yen'); }
  else if (hr <= 18) { bases = [(hr - 12) + ' moong yen', (hr - 12) + ' moong']; if (hr <= 17) bases.push('bàai ' + (hr - 12) + ' moong'); }
  else bases = [(hr - 18) + ' tûm'];
  if (m === 0) return bases;
  const out = [];
  for (const b of bases) { if (m === 30) out.push(b + ' krʉ̂ng'); out.push(b + ' ' + m + ' naatii'); }
  return out;
}
const MONTHS = [['mókgaraa', 'kom', 'January'], ['gumpaa', 'pan', 'February'], ['miinaa', 'kom', 'March'], ['meesǎa', 'yon', 'April'], ['prʉ́tsapaa', 'kom', 'May'], ['mítùnaa', 'yon', 'June'], ['gàrágàdaa', 'kom', 'July'], ['sǐnghǎa', 'kom', 'August'], ['ganyaa', 'yon', 'September'], ['dtùlaa', 'kom', 'October'], ['prʉ́tsàjìgaa', 'yon', 'November'], ['tanwaa', 'kom', 'December']];
function monthForms(i) { const [a, b] = MONTHS[i]; return ['dʉan ' + a + b, 'dʉan ' + a, a + b, a]; }
const GENERATORS = {
  month() {
    const i = rand(12); const mode = rand(3);
    if (mode === 0) {
      const f = monthForms(i);
      return { kind: 'typed', label: 'Months', ctx: '📅 It is ' + MONTHS[i][2] + '.', q: 'dʉan níi dʉan arai?', answers: f.map((x) => 'dʉan níi ' + x).concat(f), show: 'dʉan níi ' + f[0], distract: [1, 11, 2, 10, 6].map((k) => 'dʉan níi ' + monthForms((i + k) % 12)[0]) };
    }
    const fwd = mode === 1; const j = (i + (fwd ? 1 : 11)) % 12; const w = fwd ? 'dʉan nâa' : 'dʉan tîilɛ́ɛo';
    const f = monthForms(j);
    return { kind: 'typed', label: 'Months', ctx: 'Work it out in Thai.', q: 'dʉan níi dʉan ' + MONTHS[i][0] + MONTHS[i][1] + ', ' + w + ' dʉan arai?', answers: f.map((x) => w + ' ' + x).concat(f), show: w + ' ' + f[0], distract: [0, 1, 11, 2, 10].map((k) => w + ' ' + monthForms((j + k) % 12)[0]).filter((x, n) => n > 0 || j !== i) };
  },
  time() {
    const hr = rand(24);
    const r = Math.random();
    const m = r < 0.45 ? 0 : r < 0.6 ? 30 : 1 + rand(59);
    const icon = hr <= 5 ? '🌌' : hr <= 11 ? '🌅' : hr <= 15 ? '☀️' : hr <= 18 ? '🌇' : '🌙';
    const ans = thaiTime(hr, m);
    return { kind: 'typed', label: 'Time · say it the Thai way', ctx: 'What time is it?', big: icon + ' ' + String(hr).padStart(2, '0') + ':' + String(m).padStart(2, '0'), answers: ans, show: ans[0], distract: [1, 23, 12, 6, 18].map((k) => thaiTime((hr + k) % 24, m)[0]) };
  },
  duration() {
    const T = [
      { ctx: '📚 You have been studying Thai for', q: 'kun rian paasǎa tai maa naan tâorài lɛ́ɛo?', a: ['chán rian paasǎa tai maa naan {d} lɛ́ɛo', 'pǒm rian paasǎa tai maa naan {d} lɛ́ɛo'], u: [2, 3, 4] },
      { ctx: '🤒 He has been sick for', q: 'káo mâi sabaai maa naan tâorài lɛ́ɛo?', a: ['káo mâi sabaai maa naan {d} lɛ́ɛo'], u: [1, 2] },
      { ctx: '⏳ You have been waiting for', q: 'kun rɔɔ maa naan tâorài lɛ́ɛo?', a: ['chán rɔɔ maa naan {d} lɛ́ɛo', 'pǒm rɔɔ maa naan {d} lɛ́ɛo'], u: [0, 1] },
      { ctx: '🏙️ She has lived in Bangkok for', q: 'káo yùu grungtêep maa naan tâorài lɛ́ɛo?', a: ['káo yùu grungtêep maa naan {d} lɛ́ɛo'], u: [3, 4] },
      { ctx: '💍 They have been married for', q: 'káo dtɛ̀ngngaan gan maa naan tâorài lɛ́ɛo?', a: ['káo dtɛ̀ngngaan gan maa naan {d} lɛ́ɛo'], u: [3, 4] },
    ];
    const U = [['naatii', 'minutes', 2, 59], ['chûamoong', 'hours', 2, 12], ['wan', 'days', 2, 30], ['dʉan', 'months', 2, 11], ['bpii', 'years', 2, 45]];
    const t = pick(T); const u = U[pick(t.u)];
    const n = u[2] + rand(u[3] - u[2] + 1);
    const d = n + ' ' + u[0];
    const answers = t.a.map((a) => a.replace('{d}', d)).concat(['naan ' + d + ' lɛ́ɛo', 'naan ' + d, d + ' lɛ́ɛo', d]);
    const distract = U.filter((x) => x !== u).map((x) => t.a[0].replace('{d}', n + ' ' + x[0])).concat([t.a[0].replace('{d}', (n + 1) + ' ' + u[0])]);
    return { kind: 'typed', label: 'How long?', ctx: t.ctx + ' ' + n + ' ' + u[1] + '.', q: t.q, answers, show: answers[0], distract };
  },
  day() {
    const i = rand(7);
    const mode = rand(3);
    if (mode === 0) {
      const ans = ['wanníi bpen ' + DAYS[i][0], DAYS[i][0]];
      return { kind: 'typed', label: 'Days', ctx: '📅 Today is ' + DAYS[i][1] + '.', q: 'wanníi bpen wan arai?', answers: ans, show: ans[0], distract: [1, 6, 2, 5].map((k) => 'wanníi bpen ' + DAYS[(i + k) % 7][0]) };
    }
    const fwd = mode === 1;
    const j = (i + (fwd ? 1 : 6)) % 7;
    const w = fwd ? 'prûngníi' : 'mʉ̂awaan';
    const ans = [w + ' bpen ' + DAYS[j][0], DAYS[j][0]];
    return { kind: 'typed', label: 'Days', ctx: 'Work it out in Thai.', q: 'wanníi bpen ' + DAYS[i][0] + ', ' + w + ' bpen wan arai?', answers: ans, show: ans[0], distract: [0, fwd ? 6 : 1, fwd ? 2 : 5, fwd ? 5 : 2].map((k) => w + ' bpen ' + DAYS[(i + k) % 7][0]) };
  },
  date() {
    const i = rand(7); const n = 1 + rand(31);
    const ans = ['wanníi ' + DAYS[i][0] + ' tîi ' + n, DAYS[i][0] + ' tîi ' + n, 'wanníi wan tîi ' + n, 'wan tîi ' + n];
    return { kind: 'typed', label: 'Dates', ctx: '📅 Today is ' + DAYS[i][1] + ' the ' + n + ordSuffix(n) + '.', q: 'wanníi wan arai, wan tîi tâorài?', answers: ans, show: ans[0], distract: ['wanníi ' + DAYS[(i + 1) % 7][0] + ' tîi ' + n, 'wanníi ' + DAYS[i][0] + ' tîi ' + (n === 31 ? 30 : n + 1), 'wanníi ' + DAYS[(i + 6) % 7][0] + ' tîi ' + (n === 1 ? 2 : n - 1), 'wanníi ' + DAYS[(i + 3) % 7][0] + ' tîi ' + n] };
  },
  year() {
    const base = 2015 + rand(15); const n = 2 + rand(14);
    const ans = ['ìik ' + n + ' bpii bpen bpii ' + (base + n), 'bpii ' + (base + n), String(base + n)];
    return { kind: 'typed', label: 'Years', ctx: 'Work it out in Thai.', q: 'bpii níi bpii ' + base + ', ìik ' + n + ' bpii bpen bpii arai?', answers: ans, show: ans[0], distract: [1, -1, 10, -2 * n].map((k) => 'ìik ' + n + ' bpii bpen bpii ' + (base + n + k)) };
  },
  ordinal() {
    const people = Math.random() < 0.35;
    const pool = people ? ['🧒', '👩', '👨', '👵', '👴', '👧', '👦'] : ['🐱', '🐶', '🐰', '🐭', '🐸', '🐼', '🐷', '🐵', '🦊', '🐯'];
    const row = shuffle(pool).slice(0, 5);
    const k = 1 + rand(5);
    const cl = people ? 'kon' : 'dtua';
    const ans = [cl + ' tîi ' + k, 'tîi ' + k];
    return { kind: 'typed', label: 'Ordinals', ctx: 'Count from the left. Which one is ' + row[k - 1] + '?', big: row.join(' '), q: (people ? 'kon' : 'dtua') + ' nǎi?', answers: ans, show: ans[0], distract: [1, 2, 3, 4, 5].filter((x) => x !== k).map((x) => cl + ' tîi ' + x) };
  },
  classifier() {
    const nouns = LESSONS.filter((L) => lessonOn(L.id)).flatMap((L) => L.nouns || []);
    if (!nouns.length) return GENERATORS.time();
    const [r, th, en, emo, cl, clTh] = pick(nouns);
    const mode = rand(4);
    if (mode === 3) {
      const all = [...new Set(nouns.map((x) => x[4]))];
      const opts = shuffle([cl, ...shuffle(all.filter((x) => x !== cl)).slice(0, 3)]);
      return { kind: 'mc', label: 'Classifiers · which one?', q: emo + '  ' + r + ' 2 ___', th: th, options: opts, correct: cl };
    }
    if (mode === 2) {
      const D = [['níi', 'นี้', 'this'], ['nán', 'นั้น', 'that'], ['nóon', 'โน้น', 'that one over there']];
      const [d, dTh, dEn] = pick(D);
      const ans = [r + ' ' + cl + ' ' + d, cl + ' ' + d];
      const others = shuffle([...new Set(nouns.map((x) => x[4]))].filter((x) => x !== cl));
      const distract = others.slice(0, 2).map((c) => r + ' ' + c + ' ' + d).concat(D.filter((x) => x[0] !== d).map((x) => r + ' ' + cl + ' ' + x[0]).slice(0, 1));
      return { kind: 'typed', label: 'Classifiers · this / that', ctx: '👉 Say "' + dEn + ' ' + en + '" in Thai.', big: emo, q: r + ' + ' + d, answers: ans, show: ans[0], distract, th: th + clTh + dTh, en: dEn + ' ' + en, note: 'noun + classifier + níi / nán / nóon' };
    }
    const n = 2 + rand(5);
    const ans = [r + ' ' + n + ' ' + cl, n + ' ' + cl, 'mii ' + r + ' ' + n + ' ' + cl];
    const distract = shuffle([...new Set(nouns.map((x) => x[4]))].filter((x) => x !== cl)).slice(0, 3).map((c) => r + ' ' + n + ' ' + c);
    return { kind: 'typed', label: 'Classifiers · count them', ctx: 'How many? Pick noun + number + classifier.', distract, big: emo.repeat(n), q: r + ' (' + en + ')', answers: ans, show: ans[0], th: th + ' ' + n + ' ' + clTh, en: n + ' × ' + en };
  },
  meaning() {
    const pool = enabledCards().filter((c) => c.kind === 'vocabRec');
    const c = pick(pool);
    const opts = shuffle([c.en, ...shuffle(pool.filter((x) => x.en !== c.en)).slice(0, 3).map((x) => x.en)]);
    return { kind: 'mc', label: 'What does it mean?', q: "'" + c.r + "' paasǎa anggrìt bplɛɛ-wâa arai?", th: c.th, options: opts, correct: c.en };
  },
};
function ordSuffix(n) { if (n % 100 >= 11 && n % 100 <= 13) return 'th'; return ['th', 'st', 'nd', 'rd'][n % 10] || 'th'; }
function makeGen(name) {
  const g = GENERATORS[name](); g.gen = name;
  if (g.kind === 'typed') {
    const ok = new Set(g.answers.map((a) => norm(a, 0)));
    g.options = choices(g.show, (g.distract || []).filter((x) => !ok.has(norm(x, 0))));
    g.correct = g.show; g.kind = 'mc';
  }
  return g;
}
// correct answer + up to 3 distinct distractors (in the order given: put the best ones first), shuffled
function choices(correct, candidates, n = 3) {
  const seen = new Set([correct]); const out = [];
  for (const c of candidates) { if (c && !seen.has(c)) { seen.add(c); out.push(c); } if (out.length >= n) break; }
  return shuffle([correct, ...out]);
}

/* ---------- card views ---------- */
function feedback(res, shownAnswer, extra) {
  const map = {
    right: ['right', '✓ Correct'],
    tones: ['almost', 'Almost: check the tone marks'],
    close: ['almost', 'Close: check vowels and tones'],
    wrong: ['wrong', 'Not quite'],
  };
  const [cls, head] = map[res];
  return h('div', { class: 'fb ' + cls }, h('div', { class: 'head' }, head),
    res !== 'right' ? h('div', { class: 'ans' }, shownAnswer) : null, extra || null);
}
function reveal(item) {
  const full = item.r ? plain(item.r) : null;
  return h('div', { class: 'reveal' },
    full && item.kind !== 'vocabProd' ? h('div', null, h('strong', null, full)) : null,
    item.th ? h('div', { class: 'thai' }, item.th) : null,
    item.en ? h('div', { class: 'hint' }, item.en) : null,
    audioRow(item.th));
}

function lessonFirst(item, pool) {
  const near = shuffle(pool.filter((c) => c.lesson === item.lesson));
  return near.slice(0, 2).concat(shuffle(pool.filter((c) => c.lesson !== item.lesson)), near.slice(2));
}

function mcCard(item, done) {
  let options, correct, prompt, kindLabel, showReveal = true, revealItem = item;
  if (item.kind === 'vocabRec') {
    kindLabel = 'What does it mean?';
    const pool = CARDS.filter((c) => c.kind === 'vocabRec' && c.en !== item.en);
    options = choices(item.en, lessonFirst(item, pool).map((c) => c.en)); correct = item.en;
    prompt = [h('div', { class: 'prompt huge' }, item.r), audioRow(item.th)];
  } else if (item.kind === 'vocabProd') {
    kindLabel = 'How do you say it in Thai?';
    const pool = CARDS.filter((c) => c.kind === 'vocabProd' && c.r !== item.r);
    options = choices(item.r, lessonFirst(item, pool).map((c) => c.r)); correct = item.r;
    prompt = [h('div', { class: 'prompt' }, item.en)];
  } else if (item.kind === 'cloze') {
    kindLabel = 'Fill the gap';
    const L = LESSONS.find((l) => l.id === item.lesson);
    const tg = (x) => (x.match(/\[([^\]]+)\]/) || [])[1];
    const near = shuffle([...new Set((L.sentences || []).map((x) => tg(x[0])).filter(Boolean))]);
    const far = shuffle(CARDS.filter((c) => c.kind === 'cloze' && c.lesson !== item.lesson).map((c) => c.target));
    options = choices(item.target, near.concat(far)); correct = item.target;
    const parts = item.r.split(/\[[^\]]+\]/);
    // the English meaning is always shown: with options, it's what rules out words that would also fit grammatically
    prompt = [h('div', { class: 'prompt' }, parts[0], h('span', { class: 'blank' }, ' '), parts[1] || ''), h('div', { class: 'hint' }, item.en)];
  } else if (item.kind === 'listen') {
    kindLabel = 'Listen · what does it mean?';
    const same = CARDS.filter((c) => c.kind === 'listen' && c.en !== item.en);
    options = choices(item.en, lessonFirst(item, same).map((c) => c.en)); correct = item.en;
    prompt = canSpeak() ? [h('div', { class: 'prompt huge' }, '🎧'), audioRow(item.th)] : [h('div', { class: 'prompt' }, item.r), h('p', { class: 'hint' }, 'No speech on this device; reading instead.')];
    setTimeout(() => speak(item.th), 250);
  } else if (item.kind === 'recall') {
    kindLabel = 'Which picture matches?';
    const pool = CARDS.filter((c) => c.kind === 'recall' && c.emo !== item.emo);
    options = choices(item.emo, lessonFirst(item, pool).map((c) => c.emo)); correct = item.emo;
    prompt = [h('div', { class: 'prompt' }, item.r), audioRow(item.th)];
  } else if (item.kind === 'qa') {
    kindLabel = 'Real situation · what do you say?';
    const pool = CARDS.filter((c) => c.kind === 'qa' && c.a !== item.a && !isOpenQa(c));
    options = choices(item.a, lessonFirst(item, pool).map((c) => c.a)); correct = item.a;
    prompt = [h('div', { class: 'ctx' }, item.ctx), item.q ? h('div', { class: 'prompt' }, item.q) : null];
    showReveal = false;
  } else { // generator
    kindLabel = item.label; options = item.options; correct = item.correct;
    prompt = [item.ctx ? h('div', { class: 'ctx' }, item.ctx) : null,
      item.big ? h('div', { class: 'prompt huge clock' }, item.big) : null,
      item.q ? h('div', { class: 'prompt' }, item.q) : null,
      item.note ? h('div', { class: 'hint' }, item.note) : null,
      item.kind === 'mc' && !item.ctx ? audioRow(item.th) : null];
    showReveal = !!(item.th && item.ctx);
    revealItem = { th: item.th, en: item.en };
  }
  const out = h('div');
  const box = h('div', { class: 'choices' + (item.kind === 'recall' ? ' emoji' : '') });
  let answered = false;
  for (const o of options) {
    box.append(h('button', {
      onclick: (e) => {
        if (answered) return; answered = true;
        const ok = o === correct;
        e.currentTarget.classList.add(ok ? 'correct' : 'wrong');
        [...box.children].forEach((b) => { b.disabled = true; if (b.textContent === correct) b.classList.add('correct'); });
        if (ok && revealItem.th) speak(revealItem.th);
        out.replaceChildren(...[feedback(ok ? 'right' : 'wrong', correct), showReveal ? reveal(revealItem) : null,
          h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => done(ok ? 'right' : 'wrong') }, 'Next'))].filter(Boolean));
        out.querySelector('.primary').focus();
      },
    }, o));
  }
  return h('div', { class: 'card' }, h('div', { class: 'kind' }, kindLabel), prompt, box, out);
}

// open questions ("(example) …") have no single right answer: think of yours, then compare
function isOpenQa(c) { return /\(example\)/i.test(c.a); }
function openQaCard(item, done) {
  const out = h('div');
  const actions = h('div', { class: 'row' });
  function showAnswer() {
    out.replaceChildren(h('div', { class: 'fb right' }, h('div', { class: 'head' }, 'One possible answer'), h('div', { class: 'ans' }, item.a.replace(/\(example\)\s*/i, ''))));
    actions.replaceChildren(h('button', { onclick: () => done('wrong') }, 'Again'), h('button', { class: 'primary', onclick: () => done('right') }, 'I could say it'));
  }
  actions.append(h('button', { class: 'primary', onclick: showAnswer }, 'Show an answer'));
  return h('div', { class: 'card' }, h('div', { class: 'kind' }, 'Your answer · say it in your head'),
    h('div', { class: 'ctx' }, item.ctx), item.q ? h('div', { class: 'prompt' }, item.q) : null,
    h('p', { class: 'hint' }, 'There is no single right answer here. Think of yours in Thai, then compare.'), actions, out);
}

function renderItem(item, done) {
  if (item.kind === 'qa' && isOpenQa(item)) return openQaCard(item, done);
  return mcCard(item, done);
}

/* ---------- session ---------- */
function runSession(title, items, opts = {}) {
  const queue = items.slice();
  let total = queue.length, n = 0, right = 0, wrong = 0;
  if (!queue.length) {
    return show(topbar(title), h('div', { class: 'done-emoji' }, '🌿'), h('p', { class: 'center' }, 'Nothing to review right now.'),
      h('div', { class: 'stack' }, h('button', { class: 'primary', onclick: home }, 'Back')));
  }
  function step() {
    if (!queue.length) return finished();
    const item = queue.shift();
    const pct = opts.endless ? 0 : Math.round((n / total) * 100);
    show(topbar(title, opts.endless ? n + ' done' : n + ' / ' + total), opts.endless ? null : h('div', { class: 'progress' }, h('div', { style: 'width:' + pct + '%' })),
      renderItem(item, (g) => {
        if (!opts.practice || S.cards[item.id]) grade(item, g);
        n++;
        if (g === 'right') right++; else if (g === 'wrong') wrong++;
        if (g === 'wrong' && !item.gen && !item._again) { item._again = true; queue.splice(Math.min(3, queue.length), 0, item); total++; }
        if (opts.endless) queue.push(opts.endless());
        step();
      }));
  }
  function finished() {
    show(topbar(title), h('div', { class: 'done-emoji' }, '🎉'),
      h('h1', { class: 'center' }, 'Done'),
      h('p', { class: 'center muted' }, right + ' right · ' + wrong + ' to review again'),
      h('div', { class: 'stack' }, h('button', { class: 'primary', onclick: home }, 'Home')));
  }
  step();
}
function topbar(title, count) {
  return h('div', { class: 'topbar' }, h('button', { class: 'ghost', onclick: home, 'aria-label': 'Back to home' }, '← Home'),
    h('div', { class: 'title' }, title), h('div', { class: 'count' }, count || ''));
}

/* ---------- screens ---------- */
function home() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const c = counts();
  const todayN = Math.min(S.settings.sessionSize, c.due + c.newLeft);
  show(
    h('h1', null, 'Thai practice'),
    h('p', { class: 'muted' }, 'pûut paasǎa tai túk wan 🌱'),
    h('div', { class: 'hero' },
      h('div', { class: 'big' }, todayN ? todayN + ' cards' : 'All caught up'),
      h('div', { class: 'muted' }, c.due + ' due for review · ' + c.newLeft + ' new today · plus a few random time/number questions'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        h('button', { class: 'primary', onclick: () => runSession("Today's review", dailyItems()) }, todayN ? "Start today's review" : 'Practise anyway (random mix)'))),
    h('div', { class: 'tiles' },
      tile('📚', 'Lessons', LESSONS.length + ' topics · notes & vocab', lessonsScreen),
      tile('🎧', 'Listening', 'Hear a sentence, pick the meaning', listeningStart),
      tile('🕰️', 'Time & numbers', 'Endless random questions', numbersStart),
      tile('💬', 'Situations', 'What would you say?', situationsStart),
      tile('🔢', 'Classifiers', 'Endless counting drill', classifiersStart),
      tile('⌨️', 'Typing in Thai', 'Unlocks in December', () => lockedScreen('Typing in Thai', 'This section opens when you start learning to write (December). Send your writing lessons as you go and they will be added level by level, using only letters you have learned.'), true),
      tile('🎵', 'Songs', 'Coming later', () => lockedScreen('Songs', 'Send song titles, artists and links when you are ready. Each song will get its link plus practice cards for its words and phrases.'), true)),
    h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { onclick: settingsScreen }, '⚙️ Settings & backup')),
    h('p', { class: 'small muted center', style: 'margin-top:16px' }, 'Progress is saved on this device only. v' + APP_VERSION));
}
function tile(ico, lbl, sub, fn, locked) {
  return h('button', { class: 'tile' + (locked ? ' locked' : ''), onclick: fn }, h('span', { class: 'ico' }, ico), h('span', { class: 'lbl' }, lbl), h('span', { class: 'sub' }, sub));
}
function lockedScreen(title, text) {
  show(topbar(title), h('div', { class: 'done-emoji' }, '🔒'), h('p', null, text));
}
function listeningStart() {
  if (!canSpeak()) return lockedScreen('Listening', 'This browser has no speech support, so listening practice is not available here.');
  const pool = shuffle(enabledCards().filter((c) => c.kind === 'listen'));
  const due = pool.filter(isDue);
  runSession('Listening', due.concat(pool.filter((c) => !due.includes(c))).slice(0, 15), { practice: true });
}
function numbersStart() {
  const gens = ['time', 'duration', 'day', 'date', 'month', 'year', 'ordinal'].filter((g) => enabledGenerators().includes(g));
  const list = gens.length ? gens : ['time', 'day'];
  const make = () => makeGen(pick(list));
  runSession('Time & numbers', [make(), make()], { endless: make });
}
function classifiersStart() {
  const make = () => makeGen('classifier');
  runSession('Classifiers', [make(), make()], { endless: make });
}
function situationsStart() {
  runSession('Situations', shuffle(enabledCards().filter((c) => c.kind === 'qa')).slice(0, 12), { practice: true });
}
function lessonsScreen() {
  show(topbar('Lessons'),
    h('p', { class: 'small muted' }, 'Tick the lessons you want in your daily review. Tap a lesson to see its notes, vocabulary and to practise only that topic.'),
    h('div', { class: 'list' }, LESSONS.map((L, i) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Include in daily review', onchange: (e) => { if (e.target.checked) delete S.settings.off[L.id]; else S.settings.off[L.id] = true; save(); } });
      cb.checked = lessonOn(L.id);
      const lc = CARDS.filter((c) => c.lesson === L.id);
      const learned = lc.filter((c) => S.cards[c.id] && S.cards[c.id].b >= 2).length;
      return h('div', { class: 'lesson' }, cb,
        h('div', { class: 'info', role: 'button', tabindex: '0', onclick: () => lessonScreen(L), onkeydown: (e) => { if (e.key === 'Enter') lessonScreen(L); } },
          h('div', { class: 't' }, (i + 1) + '. ' + L.title),
          h('div', { class: 's' }, L.source + ' · ' + learned + '/' + lc.length + ' learned')),
        h('span', { class: 'muted' }, '›'));
    })));
}
function lessonScreen(L) {
  const lc = CARDS.filter((c) => c.lesson === L.id);
  show(topbar('Lesson'),
    h('h1', null, L.title), h('p', { class: 'muted small' }, L.source),
    h('div', { class: 'stack' },
      h('button', { class: 'primary', onclick: () => {
        const items = shuffle(lc).slice(0, 14);
        (L.generators || []).forEach((g) => items.splice(rand(items.length + 1), 0, makeGen(g), makeGen(g)));
        runSession(L.title, items, { practice: false });
      } }, 'Practise this lesson'),
      canSpeak() ? h('button', { onclick: () => runSession('Listening', shuffle(lc.filter((c) => c.kind === 'listen')).slice(0, 10), { practice: true }) }, '🎧 Listen to its sentences') : null),
    h('h2', null, 'Notes'), h('ul', { class: 'notes' }, (L.notes || []).map((n) => h('li', null, n))),
    h('h2', null, 'Vocabulary'),
    h('table', { class: 'vocab' }, h('tbody', null, (L.vocab || []).map(([r, th, en]) =>
      h('tr', { onclick: () => speak(th) }, h('td', null, r, h('div', { class: 'thai small muted' }, th)), h('td', null, en))))),
    h('p', { class: 'small muted' }, canSpeak() ? 'Tap a word to hear it.' : ''));
}
function settingsScreen() {
  const sel = (key, vals, fmt) => {
    const s = h('select', { onchange: (e) => { S.settings[key] = Number(e.target.value); save(); } }, vals.map((v) => h('option', { value: v }, fmt ? fmt(v) : v)));
    s.value = S.settings[key];
    return s;
  };
  const file = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: importBackup });
  const voiceInfo = !canSpeak() ? 'This browser has no speech support.'
    : thaiVoice ? 'Thai voice: ' + thaiVoice.name
    : 'No Thai voice found yet. iPhone: Settings › Accessibility › Spoken Content › Voices › Thai. Android: install the Thai voice for Google Text-to-speech.';
  show(topbar('Settings'),
    h('div', { class: 'field' }, h('span', null, 'New cards per day'), sel('newPerDay', [5, 8, 12, 16, 20, 30])),
    h('div', { class: 'field' }, h('span', null, 'Cards per session'), sel('sessionSize', [10, 15, 20, 30, 40])),
    h('div', { class: 'field' }, h('span', null, 'Voice speed'), sel('rate', [0.6, 0.75, 0.85, 1], (v) => v + '×')),
    h('p', { class: 'small muted' }, voiceInfo),
    canSpeak() ? h('button', { onclick: () => speak('สวัสดีค่ะ วันนี้เป็นวันศุกร์') }, '🔊 Test the voice') : null,
    h('h2', null, 'Backup'),
    h('p', { class: 'small muted' }, 'Your progress lives only in this browser. Export a backup now and then, and import it if you change phone or clear your browser data.'),
    h('div', { class: 'row' }, h('button', { onclick: exportBackup }, '⬇️ Export'), h('button', { onclick: () => file.click() }, '⬆️ Import')), file,
    h('h2', null, 'Reset'),
    h('button', { onclick: () => { if (confirm('Delete all progress on this device?')) { S = defaultState(); save(); home(); } } }, 'Reset all progress'),
    h('h2', null, 'About'),
    h('p', { class: 'small muted' }, 'Romanization follows your class’s system (ɔ ɛ ʉ ə, bp/dt, tone marks à â á ǎ). Thai script and new example sentences were written by Claude, not your school; if anything looks off, tell Claude and it will be fixed in the next update.'));
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'thai-practice', v: 1, at: new Date().toISOString(), state: S })], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'thai-practice-backup-' + todayStr() + '.json' });
  document.body.append(a); a.click(); a.remove();
}
function importBackup(e) {
  const f = e.target.files[0]; if (!f) return;
  f.text().then((t) => {
    const d = JSON.parse(t);
    if (!d || d.app !== 'thai-practice' || !d.state || !d.state.cards) throw new Error('bad');
    S = { ...defaultState(), ...d.state }; save(); alert('Backup restored.'); home();
  }).catch(() => alert('That file is not a Thai Practice backup.'));
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
loadData().then(home).catch((err) => {
  show(h('h1', null, 'Could not load lessons'), h('p', { class: 'muted' }, 'Check your connection and reload. (' + err.message + ')'));
});
