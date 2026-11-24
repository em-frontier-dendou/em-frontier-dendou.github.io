'use strict';

/* ==========================================================================
   Emフロンティア殿堂の処理。
   上から順に：
     1. 施設の一覧（ひらがなの表記や掲載ラインを直すのはここ）
     2. 小さな道具
     3. CSVの読み込み（loadRecords）
     4. 並べ方（rankRecords）
     5. 記録表の表示
     6. URLに区分を残す
     7. 申請ボタンと運営者名のリンク（全ページ共通）
     8. 起動
   設定値（CSVやフォームのURL）は assets/config.js にある。
   ========================================================================== */

/* ---------- 1. 施設の一覧 ---------- */

// kana は、ゲーム内の「せいせき」画面の表記に合わせる。
// 「要確認」の行は、実機で確かめてから kana を直す。直すのはこの一覧だけでよい。
const FACILITIES = [
  { name: 'バトルタワー', unit: '連勝', kana: 'れんしょう', line: '70連勝', hasDouble: true },                     // kana 要確認
  { name: 'バトルドーム', unit: '連続優勝', kana: 'れんぞく ゆうしょう', line: '10大会の連続優勝', hasDouble: true }, // kana 要確認
  { name: 'バトルパレス', unit: '連勝', kana: 'れんしょう', line: '42連勝', hasDouble: true },                     // kana 要確認
  { name: 'バトルアリーナ', unit: '連勝', kana: 'れんしょう', line: '56連勝', hasDouble: false },                  // kana 要確認
  { name: 'バトルファクトリー', unit: '連勝', kana: 'れんしょう', line: '42連勝', hasDouble: true },               // kana 要確認
  { name: 'バトルチューブ', unit: '部屋', kana: 'へや とっぱ', line: '140部屋', hasDouble: false },
  { name: 'バトルピラミッド', unit: '階', kana: 'かい とっぱ', line: '70階', hasDouble: false }                    // kana 要確認
];
const FORMATS = ['シングル', 'ダブル'];
const LEVELS = ['レベル50', 'オープンレベル'];

const CONFIG = window.SITE_CONFIG || {};
const SAMPLE_CSV = 'data/sample.csv'; // csvUrl が空のあいだに読むファイル
const MESSAGE_LOADING = '読み込み中…';
const MESSAGE_FAILED = '記録を読み込めませんでした。時間をおいて開き直してください。';

/* ---------- 2. 小さな道具 ---------- */

// 要素を作る。文字は必ず textContent で入れる（シートの値をHTMLとして解釈させない）。
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 印の中の小さな図形（凡例と同じもの）。
function icon(kind) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (kind === 'check') {
    svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M5 12l5 5 9-10');
    svg.append(path);
  } else {
    svg.setAttribute('width', '8'); svg.setAttribute('height', '8'); svg.setAttribute('viewBox', '0 0 8 8');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', '4'); dot.setAttribute('cy', '4'); dot.setAttribute('r', '4'); dot.setAttribute('fill', 'currentColor');
    svg.append(dot);
  }
  return svg;
}

// リンクにしてよいのは https:// で始まるURLだけ。それ以外は空文字にして無視する。
function safeUrl(url) {
  const value = String(url || '').trim();
  return /^https:\/\//.test(value) ? value : '';
}

// 外部リンクの共通の設定。
function makeExternal(a, url) {
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
}

// 「2025-12-01」「2025/12/1」を「2025-12-01」にそろえる。読めない値は空文字にする。
function normalizeDate(value) {
  const m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(value);
  if (!m) return '';
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return m[1] + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

// 「2025-12-01」を「2025年12月1日」にする。
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日' : '';
}

// 達成日を比べる。早いほうが先。空の達成日は、いちばん後。
function compareDate(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

/* ---------- 3. CSVの読み込み ---------- */

// CSVの文字列を、行ごとの配列にする。
// 引用符で囲まれた値、値の中のカンマと改行、"" のエスケープ、先頭のBOMに対応する。
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOMを外す
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" は " 1文字
        else inQuotes = false;
      } else {
        field += c; // 引用符の中では、カンマも改行もそのまま値の一部
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// これがない表は、掲載用シートとして読めない。
const REQUIRED_COLUMNS = ['掲載名', '施設', '形式', 'レベル', '記録', '表示'];

// CSVの行を、記録の一覧にする。列は見出しの名前で探す（並び順には頼らない）。
// 返すのは、「表示」が TRUE で、中身が正しい行だけ。
function toRecords(rows) {
  if (rows.length === 0) throw new Error('CSVが空です');
  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length > 0) throw new Error('CSVに見出しがありません：' + missing.join('、'));

  const records = [];
  rows.slice(1).forEach((row, i) => {
    const sheetRow = i + 2; // シートの上での行番号（1行目は見出し）
    const get = (name) => {
      const index = header.indexOf(name);
      return index === -1 ? '' : String(row[index] || '').trim();
    };

    // 「表示」が TRUE の行だけを出す。FALSE や空の行は、警告も出さずに飛ばす。
    if (get('表示').toUpperCase() !== 'TRUE') return;

    const problems = [];
    if (!get('掲載名')) problems.push('掲載名が空');
    if (!FACILITIES.some((f) => f.name === get('施設'))) problems.push('施設');
    if (!FORMATS.includes(get('形式'))) problems.push('形式');
    if (!LEVELS.includes(get('レベル'))) problems.push('レベル');
    if (!/^\d+$/.test(get('記録'))) problems.push('記録');
    if (problems.length > 0) {
      console.warn('掲載用シートの' + sheetRow + '行目を飛ばしました。値を確かめてください：' + problems.join('、'));
      return;
    }

    const date = normalizeDate(get('達成日'));
    if (get('達成日') && !date) {
      console.warn('掲載用シートの' + sheetRow + '行目の達成日を読めないため、空として扱います。');
    }

    records.push({
      id: get('ID'),
      name: get('掲載名'),
      facility: get('施設'),
      format: get('形式'),
      level: get('レベル'),
      record: Number(get('記録')),
      status: get('状態'),
      date: date,
      team: get('パーティ'),
      device: get('本体'),
      evidence: get('証拠'),
      evidenceUrl: get('証拠URL'),
      link: get('紹介リンク')
    });
  });
  return records;
}

// 記録を読み込む。読み込み元を変えるときは、この関数だけ直せばよい。
// 失敗したときはエラーを投げる（呼び出した側が「読み込めませんでした」を出す）。
async function loadRecords() {
  const url = String(CONFIG.csvUrl || '').trim() || SAMPLE_CSV;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('CSVを取得できませんでした（' + response.status + '）');
  return toRecords(parseCsv(await response.text()));
}

/* ---------- 4. 並べ方 ---------- */

// 区分で絞り込み、1人1件（最高記録）にして、記録の大きい順に並べる。
// 同じ数字なら達成日の早いほうが上。達成日が空の行は、同じ数字の中でいちばん下。
function rankRecords(records, facility, format, level) {
  const inBoard = records.filter((r) => r.facility === facility && r.format === format && r.level === level);
  const best = new Map();
  for (const r of inBoard) {
    const cur = best.get(r.name);
    if (!cur || r.record > cur.record || (r.record === cur.record && compareDate(r.date, cur.date) < 0)) best.set(r.name, r);
  }
  return [...best.values()].sort((a, b) => b.record - a.record || compareDate(a.date, b.date));
}

/* ---------- 5. 記録表の表示 ---------- */

// いま選んでいる区分。開いたときは、バトルタワー・シングル・レベル50。
const state = { facility: FACILITIES[0].name, format: FORMATS[0], level: LEVELS[0] };

// 読み込みの状況。records は、読み込みが終わるまで null。
let records = null;
let loadFailed = false;

// 切り替えのボタン。最初に1回だけ作り、あとは aria-pressed だけを変える
// （作り直すと、キーボードで押したときにフォーカスが外れるため）。
const chipGroups = { facility: [], format: [], level: [] };

function buildChips(container, key, labels) {
  for (const label of labels) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      state[key] = label;
      writeStateToUrl();
      renderBoard();
    });
    container.append(b);
    chipGroups[key].push(b);
  }
}

function setPressed(key, current) {
  for (const b of chipGroups[key]) b.setAttribute('aria-pressed', b.textContent === current ? 'true' : 'false');
}

function currentFacility() {
  return FACILITIES.find((f) => f.name === state.facility);
}

// ダブルのない施設では、形式はいつもシングル。
function currentFormat() {
  return currentFacility().hasDouble ? state.format : FORMATS[0];
}

// プレイヤーごとのページのURL。例：player.html?name=サンプルA
function playerUrl(name) {
  return 'player.html?' + new URLSearchParams({ name: name }).toString();
}

// 1件の記録（表の1行）を作る。
// rank は順位（1から）。null なら記録表に出ない記録として「—」を出す。
// プレイヤーのページでは showName を false にして、名前を出さない（見出しにあるため）。
function recordItem(r, rank, facility, showName = true) {
  const li = el('li', 'record');

  const rankBox = el('div', 'rank' + (rank === 1 ? ' first' : '') + (rank === null ? ' off' : ''));
  if (rank === null) {
    const dash = el('span', 'num', '—');
    dash.setAttribute('aria-hidden', 'true');
    rankBox.append(dash, el('span', 'visually-hidden', '記録表には出ない記録'));
  } else {
    rankBox.append(el('span', 'num', String(rank)), el('span', 'suffix', '位'));
  }

  const who = el('div', 'who');
  const line1 = el('div', 'line1');
  if (showName) {
    const name = el('a', 'name', r.name);
    name.href = playerUrl(r.name);
    line1.append(name);
  }
  const link = safeUrl(r.link);
  if (link) {
    const a = el('a', 'link', '紹介リンク');
    makeExternal(a, link);
    line1.append(a);
  }
  if (line1.childNodes.length > 0) who.append(line1);
  const meta = [formatDate(r.date), r.device].filter(Boolean).join('・');
  who.append(el('div', 'team', r.team), el('div', 'meta', meta));

  const badges = el('div', 'badges');
  if (r.evidence === '証拠あり') {
    const url = safeUrl(r.evidenceUrl);
    const b = el(url ? 'a' : 'span', 'badge evidence');
    if (url) makeExternal(b, url);
    b.append(icon('check'), '証拠あり');
    badges.append(b);
  } else {
    badges.append(el('span', 'badge self', '自己申告'));
  }
  if (r.status === '継続中') {
    const b = el('span', 'badge ongoing');
    b.append(icon('dot'), '継続中');
    badges.append(b);
  }

  const score = el('div', 'score');
  const row = el('div');
  row.append(el('span', 'num', String(r.record)), el('span', 'unit', facility.kana));
  score.append(el('div', 'label', r.status === '継続中' ? 'げんざい' : 'さいこう'), row);

  li.append(rankBox, who, badges, score);
  return li;
}

// 記録表を、いまの区分と読み込みの状況に合わせて描き直す。
function renderBoard() {
  const facility = currentFacility();
  const format = currentFormat();

  setPressed('facility', state.facility);
  setPressed('format', format);
  setPressed('level', state.level);
  document.getElementById('format-filter').hidden = !facility.hasDouble;

  document.getElementById('board-title').textContent = [facility.name, facility.hasDouble ? format : null, state.level].filter(Boolean).join('・');
  document.getElementById('board-note').textContent = '記録の単位：' + facility.unit + '　掲載ライン：' + facility.line;

  const list = document.getElementById('records');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');

  // 読み込み中、または読み込みに失敗したとき。空の表とは別の文を出す。
  if (records === null) {
    list.replaceChildren();
    empty.hidden = true;
    status.hidden = false;
    status.textContent = loadFailed ? MESSAGE_FAILED : MESSAGE_LOADING;
    status.classList.toggle('error', loadFailed);
    return;
  }

  status.hidden = true;
  const ranked = rankRecords(records, facility.name, format, state.level);
  list.replaceChildren(...ranked.map((r, i) => recordItem(r, i + 1, facility)));
  empty.hidden = ranked.length > 0;
  document.getElementById('empty-body').textContent = facility.line + '以上の実機記録をお持ちなら、最初の1件として載せられます。';
}

// フッターの「最終更新」。サイトに出している全記録の達成日のうち、いちばん新しい日。
// 達成日の入った記録が1件もなければ、行ごと出さない。
function renderUpdated() {
  const row = document.getElementById('updated-row');
  if (!row) return;
  const dates = (records || []).map((r) => r.date).filter(Boolean).sort();
  row.hidden = dates.length === 0;
  document.getElementById('updated').textContent = formatDate(dates[dates.length - 1]);
}

/* ---------- 6. URLに区分を残す ---------- */

// 例：?f=バトルタワー&m=ダブル&l=レベル50
//   f = 施設、m = 形式（ダブルのある施設だけ）、l = レベル
const PARAM = { facility: 'f', format: 'm', level: 'l' };

// URLから区分を読む。決まった値でないものは無視して、初めの値のままにする。
function readStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const facility = params.get(PARAM.facility);
  const format = params.get(PARAM.format);
  const level = params.get(PARAM.level);
  if (FACILITIES.some((f) => f.name === facility)) state.facility = facility;
  if (FORMATS.includes(format)) state.format = format;
  if (LEVELS.includes(level)) state.level = level;
}

// 区分を「?f=…&m=…&l=…」の形にする。
function boardQuery(facilityName, format, level) {
  const facility = FACILITIES.find((f) => f.name === facilityName);
  const params = new URLSearchParams();
  params.set(PARAM.facility, facilityName);
  if (facility.hasDouble) params.set(PARAM.format, format);
  params.set(PARAM.level, level);
  return '?' + params.toString();
}

// いまの区分をURLに書く（ページは読み込み直さない。「戻る」の履歴も増やさない）。
function writeStateToUrl() {
  history.replaceState(null, '', location.pathname + boardQuery(state.facility, currentFormat(), state.level) + location.hash);
}

/* ---------- 7. プレイヤーごとのページ（player.html） ---------- */

// そのプレイヤーの全記録を、区分ごとに出す。記録表に出ない記録（同じ区分の2番目以降）も出す。
// 区分の並びは、記録表のボタンと同じ（施設 → 形式 → レベル）。区分の中は記録の大きい順。
function renderPlayer(name) {
  const boards = document.getElementById('player-boards');
  const status = document.getElementById('status');

  if (records === null) {
    status.textContent = loadFailed ? MESSAGE_FAILED : MESSAGE_LOADING;
    status.classList.toggle('error', loadFailed);
    return;
  }

  const mine = records.filter((r) => r.name === name);
  if (mine.length === 0) {
    status.textContent = name ? 'この名前の記録は見つかりませんでした。' : 'プレイヤーの名前が指定されていません。記録表の名前から開いてください。';
    return;
  }

  status.hidden = true;
  document.getElementById('player-name').textContent = name;
  document.title = name + 'の記録｜Emフロンティア殿堂';
  const summary = document.getElementById('player-summary');
  summary.textContent = '記録 ' + mine.length + '件';
  summary.hidden = false;
  document.getElementById('player-note').hidden = false;

  const sections = [];
  for (const facility of FACILITIES) {
    for (const format of facility.hasDouble ? FORMATS : [FORMATS[0]]) {
      for (const level of LEVELS) {
        const list = mine
          .filter((r) => r.facility === facility.name && r.format === format && r.level === level)
          .sort((a, b) => b.record - a.record || compareDate(a.date, b.date));
        if (list.length === 0) continue;

        // 記録表に出ている1件と、その順位。
        const ranked = rankRecords(records, facility.name, format, level);
        const rank = ranked.findIndex((r) => r.name === name) + 1;
        const shown = ranked[rank - 1];

        const section = el('section', 'player-board');
        const head = el('div', 'board-head');
        const title = [facility.name, facility.hasDouble ? format : null, level].filter(Boolean).join('・');
        const toBoard = el('a', '', '記録表で見る（' + rank + '位）');
        toBoard.href = './' + boardQuery(facility.name, format, level) + '#board';
        const note = el('p');
        note.append(toBoard);
        head.append(el('h2', '', title), note);

        const ol = el('ol', 'records');
        ol.append(...list.map((r) => recordItem(r, r === shown ? rank : null, facility, false)));
        section.append(head, ol);
        sections.push(section);
      }
    }
  }
  boards.replaceChildren(...sections);
}

function startPlayer() {
  const name = new URLSearchParams(location.search).get('name') || '';
  renderPlayer(name); // まず「読み込み中…」を出す

  loadRecords()
    .then((list) => { records = list; })
    .catch((error) => { loadFailed = true; console.error(error); })
    .then(() => renderPlayer(name));
}

/* ---------- 8. 申請ボタンと運営者名のリンク（全ページ共通） ---------- */

function setupLinks() {
  // 申請ボタン。formUrl が入っていれば、Googleフォームへの外部リンクにする。
  // 空のあいだは、HTMLに書いてあるとおり about.html の「申請の方法」へ向けたままにする。
  const formUrl = safeUrl(CONFIG.formUrl);
  if (formUrl) {
    for (const a of document.querySelectorAll('a[data-apply]')) makeExternal(a, formUrl);
    for (const node of document.querySelectorAll('[data-apply-ready]')) node.hidden = false;
    for (const node of document.querySelectorAll('[data-apply-pending]')) node.hidden = true;
  }

  // 運営者名。channelUrl が入っていれば、YouTubeチャンネルへのリンクにする。
  const channelUrl = safeUrl(CONFIG.channelUrl);
  if (channelUrl) {
    for (const span of document.querySelectorAll('[data-channel]')) {
      const a = el('a', '', span.textContent);
      makeExternal(a, channelUrl);
      span.replaceChildren(a);
    }
  }
}

/* ---------- 9. 起動 ---------- */

function startBoard() {
  readStateFromUrl();
  buildChips(document.getElementById('facility-chips'), 'facility', FACILITIES.map((f) => f.name));
  buildChips(document.getElementById('format-filter'), 'format', FORMATS);
  buildChips(document.getElementById('level-filter'), 'level', LEVELS);
  renderBoard(); // まず「読み込み中…」を出す

  loadRecords()
    .then((list) => { records = list; })
    .catch((error) => { loadFailed = true; console.error(error); })
    .then(() => { renderBoard(); renderUpdated(); });
}

setupLinks();
if (document.getElementById('records')) startBoard(); // 記録表があるのはトップだけ
if (document.getElementById('player-boards')) startPlayer(); // プレイヤーごとのページ
