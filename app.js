const MAX_PAGES = 20;
const SLOTS_PER_PAGE = 10;
const STORAGE_KEY = 'photo-ocr-keeper-v1';

const startCharEl = document.getElementById('startChar');
const endCharEl = document.getElementById('endChar');
const photoInputEl = document.getElementById('photoInput');
const processBtnEl = document.getElementById('processBtn');
const statusEl = document.getElementById('status');
const pageSelectEl = document.getElementById('pageSelect');
const newPageBtnEl = document.getElementById('newPageBtn');
const deletePageBtnEl = document.getElementById('deletePageBtn');
const slotsEl = document.getElementById('slots');
const slotTemplate = document.getElementById('slotTemplate');

const defaultSlot = () => ({ text: '', confirmed: false, ocrFailed: false, copyHistory: [] });

const state = loadState();
if (!state.pages.length) state.pages.push(makePage(1));
if (!state.currentPage) state.currentPage = state.pages[0].id;
renderPager();
renderSlots();

processBtnEl.addEventListener('click', processImages);
newPageBtnEl.addEventListener('click', addPage);
deletePageBtnEl.addEventListener('click', deleteCurrentPage);

function makePage(index) {
  return { id: index, slots: Array.from({ length: SLOTS_PER_PAGE }, defaultSlot) };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { pages: [], currentPage: 1 };
  try {
    return JSON.parse(raw);
  } catch {
    return { pages: [], currentPage: 1 };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getCurrentPage() {
  return state.pages.find((p) => p.id === state.currentPage) || state.pages[0];
}

function renderPager() {
  pageSelectEl.innerHTML = '';
  state.pages.forEach((page, idx) => {
    const btn = document.createElement('button');
    btn.textContent = String(idx + 1);
    if (page.id === state.currentPage) btn.classList.add('active');
    btn.addEventListener('click', () => {
      state.currentPage = page.id;
      saveState();
      renderPager();
      renderSlots();
    });
    pageSelectEl.appendChild(btn);
  });
}

function renderSlots() {
  const page = getCurrentPage();
  if (!page) return;
  slotsEl.innerHTML = '';

  page.slots.forEach((slot, idx) => {
    const node = slotTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('h3').textContent = `枠 ${idx + 1}`;
    const textArea = node.querySelector('.text');
    const meta = node.querySelector('.meta');
    const historyEl = node.querySelector('.history');
    const copyBtn = node.querySelector('.copy');
    copyBtn.classList.toggle('copied', slot.copyHistory.length > 0);
    copyBtn.textContent = slot.copyHistory.length > 0 ? '☑️' : '⧉';

    textArea.value = slot.text;
    textArea.readOnly = slot.confirmed;
    meta.textContent = slot.text ? `${slot.text.length}文字` : '空';
    historyEl.textContent = slot.copyHistory.length ? `履歴: ${slot.copyHistory.join(' / ')}` : '履歴なし';

    node.querySelector('.confirm').addEventListener('click', () => {
      if (textArea.readOnly) {
        textArea.readOnly = false;
        setStatus(`枠${idx + 1}を編集中です`);
        return;
      }
      slot.text = textArea.value;
      slot.confirmed = true;
      textArea.readOnly = true;
      meta.textContent = slot.text ? `${slot.text.length}文字` : '空';
      saveState();
      setStatus(`枠${idx + 1}の編集を確定しました`);
    });

    copyBtn.addEventListener('click', async () => {
      if (!slot.text) return setStatus(`枠${idx + 1}は空です`);
      try {
        await navigator.clipboard.writeText(slot.text);
        const stamp = new Date().toLocaleTimeString();
        slot.copyHistory.push(`${stamp}: "${slot.text}"`);
        historyEl.textContent = `履歴: ${slot.copyHistory.join(' / ')}`;
        copyBtn.classList.add('copied');
        copyBtn.textContent = '☑️';
        saveState();
        setStatus(`枠${idx + 1}をコピーしました`);
      } catch {
        setStatus('コピーに失敗しました');
      }
    });

    slotsEl.appendChild(node);
  });
}

async function processImages() {
  const files = Array.from(photoInputEl.files || []);
  if (!files.length) return setStatus('画像を選択してください');

  const page = getCurrentPage();
  const emptyIndexes = page.slots
    .map((slot, idx) => ({ slot, idx }))
    .filter(({ slot }) => !slot.text)
    .map(({ idx }) => idx);

  if (!emptyIndexes.length) return setStatus('現在ページに空き枠がありません');

  const startChar = startCharEl.value.trim();
  const endChar = endCharEl.value.trim();

  let processed = 0;
  for (const file of files) {
    if (processed >= emptyIndexes.length) break;
    const targetIndex = emptyIndexes[processed];
    setStatus(`抽出中: ${file.name} (${processed + 1}/${Math.min(files.length, emptyIndexes.length)})`);

    let extracted = '';
    try {
      const result = await Tesseract.recognize(file, 'eng+jpn');
      extracted = findMatch(result.data.text, startChar, endChar);
    } catch {
      extracted = '';
    }

    page.slots[targetIndex] = extracted
      ? { ...defaultSlot(), text: extracted, confirmed: true }
      : { ...defaultSlot(), text: '読み取れませんでした', confirmed: true, ocrFailed: true };

    processed++;
  }

  saveState();
  renderSlots();
  setStatus(`${processed}件を保存しました`);
}

function findMatch(rawText, startChar, endChar) {
  const lines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const target = lines.find((line) => (!startChar || line.startsWith(startChar)) && (!endChar || line.endsWith(endChar)));
  return target || '';
}

function addPage() {
  if (state.pages.length >= MAX_PAGES) return setStatus('ページ上限（20）に達しています');
  const newId = Math.max(...state.pages.map((p) => p.id)) + 1;
  state.pages.push(makePage(newId));
  state.currentPage = newId;
  saveState();
  renderPager();
  renderSlots();
  setStatus(`ページ${state.pages.length}を追加しました`);
}

function deleteCurrentPage() {
  if (state.pages.length === 1) {
    state.pages[0] = makePage(state.pages[0].id);
    saveState();
    renderSlots();
    return setStatus('最後の1ページは初期化しました');
  }
  state.pages = state.pages.filter((p) => p.id !== state.currentPage);
  state.currentPage = state.pages[0].id;
  saveState();
  renderPager();
  renderSlots();
  setStatus('現在ページを削除しました');
}

function setStatus(text) {
  statusEl.textContent = text;
}
