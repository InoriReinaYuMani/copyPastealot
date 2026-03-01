const MAX_PAGES = 20;
const SLOTS_PER_PAGE = 10;
const MAX_FILES = MAX_PAGES * SLOTS_PER_PAGE;
const STORAGE_KEY = 'photo-ocr-keeper-v3';

const photoInputEl = document.getElementById('photoInput');
const processBtnEl = document.getElementById('processBtn');
const statusEl = document.getElementById('status');
const pageSelectEl = document.getElementById('pageSelect');
const deletePageBtnEl = document.getElementById('deletePageBtn');
const slotsEl = document.getElementById('slots');
const slotTemplate = document.getElementById('slotTemplate');
const matchModeEl = document.getElementById('matchMode');
const matchTextEl = document.getElementById('matchText');
const progressFillEl = document.getElementById('progressFill');
const progressLabelEl = document.getElementById('progressLabel');
const progressCountEl = document.getElementById('progressCount');

const pendingFiles = []; // File objects are kept in-memory for mobile performance.

const defaultSlot = () => ({ text: '', confirmed: false, ocrFailed: false, copyHistory: [] });
const makePage = (id) => ({ id, slots: Array.from({ length: SLOTS_PER_PAGE }, defaultSlot) });

const state = loadState();
if (!state.pages.length) state.pages.push(makePage(1));
if (!state.currentPage) state.currentPage = state.pages[0].id;

renderPager();
renderSlots();
updateQueueStatus();

processBtnEl.addEventListener('click', processImages);
photoInputEl.addEventListener('change', appendSelectedFiles);
deletePageBtnEl.addEventListener('click', deleteCurrentPage);

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

function flattenSlots() {
  return state.pages.flatMap((page) => page.slots.map((slot, slotIdx) => ({ page, slot, slotIdx })));
}

function ensurePageCapacity(requiredSlots) {
  while (state.pages.length * SLOTS_PER_PAGE < requiredSlots && state.pages.length < MAX_PAGES) {
    state.pages.push(makePage(state.pages.length + 1));
  }
}

function appendSelectedFiles() {
  const selected = Array.from(photoInputEl.files || []);
  if (!selected.length) return;

  const room = MAX_FILES - pendingFiles.length;
  if (room <= 0) {
    setStatus('選択写真は200枚までです');
    photoInputEl.value = '';
    return;
  }

  const accepted = selected.slice(0, room);
  pendingFiles.push(...accepted);
  updateQueueStatus();

  if (selected.length > room) setStatus(`200枚上限のため ${selected.length - room} 枚は追加されませんでした`);
  else setStatus(`${accepted.length}枚を追加しました`);

  photoInputEl.value = '';
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
    const confirmBtn = node.querySelector('.confirm');

    node.querySelector('.slot-index').textContent = String(idx + 1);

    textArea.value = slot.text;
    textArea.readOnly = slot.confirmed;
    const isCopied = slot.copyHistory.length > 0;
    textArea.classList.toggle('copied-text', isCopied);
    copyBtn.classList.toggle('copied', isCopied);
    meta.textContent = slot.text ? `${slot.text.length}字` : '';

    confirmBtn.classList.toggle('editing', !textArea.readOnly);
    confirmBtn.setAttribute('aria-label', textArea.readOnly ? '編集' : '確定');
    confirmBtn.textContent = '✎';

    confirmBtn.addEventListener('click', () => {
      if (textArea.readOnly) {
        textArea.readOnly = false;
        confirmBtn.classList.add('editing');
        confirmBtn.setAttribute('aria-label', '確定');
        setStatus(` ${idx + 1} を編集中`);
        return;
      }
      slot.text = textArea.value;
      slot.confirmed = true;
      textArea.readOnly = true;
      confirmBtn.classList.remove('editing');
      confirmBtn.setAttribute('aria-label', '編集');
      meta.textContent = slot.text ? `${slot.text.length}字` : '';
      saveState();
      setStatus(` ${idx + 1} を確定しました`);
    });

    copyBtn.addEventListener('click', async () => {
      if (!slot.text) return setStatus(`${idx + 1} は空です`);
      try {
        await navigator.clipboard.writeText(slot.text);
        slot.copyHistory.push(slot.text);
        textArea.classList.add('copied-text');
        copyBtn.classList.add('copied');
        saveState();
        setStatus(`${idx + 1} をコピーしました`);
      } catch {
        setStatus('コピーに失敗しました');
      }
    });

    slotsEl.appendChild(node);
  });
}

async function processImages() {
  if (!pendingFiles.length) return setStatus('画像を選択してください');

  const emptySlots = flattenSlots().filter(({ slot }) => !slot.text);
  ensurePageCapacity(emptySlots.length + pendingFiles.length);
  const targets = flattenSlots().filter(({ slot }) => !slot.text);
  if (!targets.length) return setStatus('空き枠がありません');

  const jobs = pendingFiles.splice(0, targets.length);
  const matchMode = matchModeEl.value;
  const matchText = matchTextEl.value.trim();

  for (let i = 0; i < jobs.length; i++) {
    const current = jobs[i];
    const target = targets[i];

    progressLabelEl.textContent = `読込中: ${current.name}`;
    progressCountEl.textContent = `${i + 1}/${jobs.length}`;
    progressFillEl.style.width = `${Math.round((i / jobs.length) * 100)}%`;

    let extracted = '';
    try {
      const preprocessed = await preprocessImage(current);
      const result = await Tesseract.recognize(preprocessed, 'jpn+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const localProgress = Math.round(((i + m.progress) / jobs.length) * 100);
            progressFillEl.style.width = `${Math.min(100, Math.max(0, localProgress))}%`;
          }
        },
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1'
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
  const candidates = rawText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/[\t,、。\s]+/).map((s) => s.trim()).filter(Boolean));

  if (!term) return candidates[0] || '';

  const target = candidates.find((text) => {
    if (mode === 'prefix') return text.startsWith(term);
    return text.endsWith(term);
  });
  return target || '';
}

async function preprocessImage(file) {
  const imageBitmap = await createImageBitmap(file);
  const scale = imageBitmap.width > 1600 ? 1600 / imageBitmap.width : 1;
  const width = Math.max(1, Math.round(imageBitmap.width * scale));
  const height = Math.max(1, Math.round(imageBitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
    const bw = boosted > 145 ? 255 : 0;
    d[i] = bw;
    d[i + 1] = bw;
    d[i + 2] = bw;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
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
  const count = pendingFiles.length;
  progressLabelEl.textContent = '';
  progressCountEl.textContent = '';
  if (!count) progressFillEl.style.width = '0%';
}

function setStatus(text) {
  statusEl.textContent = text;
}
