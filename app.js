const MAX_PAGES = 20;
const SLOTS_PER_PAGE = 10;
const MAX_FILES = MAX_PAGES * SLOTS_PER_PAGE;
const STORAGE_KEY = 'photo-ocr-keeper-v2';

const photoInputEl = document.getElementById('photoInput');
const processBtnEl = document.getElementById('processBtn');
const statusEl = document.getElementById('status');
const pageSelectEl = document.getElementById('pageSelect');
const deletePageBtnEl = document.getElementById('deletePageBtn');
const slotsEl = document.getElementById('slots');
const slotTemplate = document.getElementById('slotTemplate');
const toggleFilterBtnEl = document.getElementById('toggleFilterBtn');
const filterPanelEl = document.getElementById('filterPanel');
const matchModeEl = document.getElementById('matchMode');
const matchTextEl = document.getElementById('matchText');
const progressFillEl = document.getElementById('progressFill');
const progressLabelEl = document.getElementById('progressLabel');
const progressCountEl = document.getElementById('progressCount');

const defaultSlot = () => ({ text: '', confirmed: false, ocrFailed: false, copyHistory: [] });
const makePage = (id) => ({ id, slots: Array.from({ length: SLOTS_PER_PAGE }, defaultSlot) });

const state = loadState();
if (!state.pages.length) state.pages.push(makePage(1));
if (!state.currentPage) state.currentPage = state.pages[0].id;
if (!Array.isArray(state.pendingFiles)) state.pendingFiles = [];

renderPager();
renderSlots();
updateQueueStatus();

processBtnEl.addEventListener('click', processImages);
photoInputEl.addEventListener('change', appendSelectedFiles);
deletePageBtnEl.addEventListener('click', deleteCurrentPage);
toggleFilterBtnEl.addEventListener('click', () => filterPanelEl.classList.toggle('hidden'));

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { pages: [], currentPage: 1, pendingFiles: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { pages: [], currentPage: 1, pendingFiles: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getCurrentPage() {
  return state.pages.find((p) => p.id === state.currentPage) || state.pages[0];
}

function flattenSlots() {
  return state.pages.flatMap((page, pageIdx) =>
    page.slots.map((slot, slotIdx) => ({ page, pageIdx, slot, slotIdx }))
  );
}

function ensurePageCapacity(requiredSlots) {
  while (state.pages.length * SLOTS_PER_PAGE < requiredSlots && state.pages.length < MAX_PAGES) {
    state.pages.push(makePage(state.pages.length + 1));
  }
}

function appendSelectedFiles() {
  const selected = Array.from(photoInputEl.files || []);
  if (!selected.length) return;

  const room = MAX_FILES - state.pendingFiles.length;
  if (room <= 0) {
    setStatus('選択写真は200枚までです');
    photoInputEl.value = '';
    return;
  }

  const accepted = selected.slice(0, room).map((file) => ({
    name: file.name,
    type: file.type,
    dataUrl: ''
  }));

  const readTasks = selected.slice(0, room).map((file, idx) =>
    fileToDataUrl(file).then((dataUrl) => {
      accepted[idx].dataUrl = dataUrl;
    })
  );

  Promise.all(readTasks)
    .then(() => {
      state.pendingFiles.push(...accepted);
      saveState();
      updateQueueStatus();
      if (selected.length > room) setStatus(`200枚上限のため ${selected.length - room} 枚は追加されませんでした`);
      else setStatus(`${accepted.length}枚を追加しました`);
      photoInputEl.value = '';
    })
    .catch(() => {
      setStatus('画像の追加に失敗しました');
      photoInputEl.value = '';
    });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
    const textArea = node.querySelector('.text');
    const meta = node.querySelector('.meta');
    const copyBtn = node.querySelector('.copy');

    node.querySelector('h3').textContent = `枠${idx + 1}`;
    textArea.value = slot.text;
    textArea.readOnly = slot.confirmed;
    textArea.classList.toggle('copied-text', slot.copyHistory.length > 0);
    meta.textContent = slot.text ? `${slot.text.length}字` : '';

    node.querySelector('.confirm').addEventListener('click', () => {
      if (textArea.readOnly) {
        textArea.readOnly = false;
        setStatus(`枠${idx + 1}を編集中です`);
        return;
      }
      slot.text = textArea.value;
      slot.confirmed = true;
      textArea.readOnly = true;
      meta.textContent = slot.text ? `${slot.text.length}字` : '';
      saveState();
      setStatus(`枠${idx + 1}の編集を確定しました`);
    });

    copyBtn.addEventListener('click', async () => {
      if (!slot.text) return setStatus(`枠${idx + 1}は空です`);
      try {
        await navigator.clipboard.writeText(slot.text);
        slot.copyHistory.push(slot.text);
        textArea.classList.add('copied-text');
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
  if (!state.pendingFiles.length) return setStatus('画像を選択してください');

  const slots = flattenSlots();
  const emptySlots = slots.filter(({ slot }) => !slot.text);
  const needed = emptySlots.length + state.pendingFiles.length;
  ensurePageCapacity(needed);

  const refreshedEmptySlots = flattenSlots().filter(({ slot }) => !slot.text);
  if (!refreshedEmptySlots.length) return setStatus('空き枠がありません');

  const jobs = state.pendingFiles.splice(0, refreshedEmptySlots.length);
  const matchMode = matchModeEl.value;
  const matchText = matchTextEl.value.trim();

  for (let i = 0; i < jobs.length; i++) {
    const current = jobs[i];
    const target = refreshedEmptySlots[i];

    progressLabelEl.textContent = `読込中: ${current.name}`;
    progressCountEl.textContent = `${i + 1}/${jobs.length}`;
    progressFillEl.style.width = `${Math.round((i / jobs.length) * 100)}%`;

    let extracted = '';
    try {
      const result = await Tesseract.recognize(current.dataUrl, 'eng+jpn', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const localProgress = Math.round((i + m.progress) / jobs.length * 100);
            progressFillEl.style.width = `${Math.min(100, Math.max(0, localProgress))}%`;
          }
        }
      });
      extracted = findMatch(result.data.text, matchMode, matchText);
    } catch {
      extracted = '';
    }

    target.page.slots[target.slotIdx] = extracted
      ? { ...defaultSlot(), text: extracted, confirmed: true }
      : { ...defaultSlot(), text: '読み取れませんでした', confirmed: true, ocrFailed: true };
  }

  progressLabelEl.textContent = '完了';
  progressCountEl.textContent = jobs.length ? `${jobs.length}/${jobs.length}` : '';
  progressFillEl.style.width = '100%';

  saveState();
  renderPager();
  renderSlots();
  updateQueueStatus();
  setStatus(`${jobs.length}件を保存しました`);
}

function findMatch(rawText, mode, term) {
  const lines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!term) return lines[0] || '';

  const target = lines.find((line) => {
    if (mode === 'prefix') return line.startsWith(term);
    return line.endsWith(term);
  });
  return target || '';
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

function updateQueueStatus() {
  const count = state.pendingFiles.length;
  progressLabelEl.textContent = count ? `待機中: ${count}枚` : '待機中';
  progressCountEl.textContent = count ? `${count}/200` : '0/200';
  if (!count) progressFillEl.style.width = '0%';
}

function setStatus(text) {
  statusEl.textContent = text;
}
