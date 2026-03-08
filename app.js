const MAX_PAGES = 20;
const SLOTS_PER_PAGE = 10;
const MAX_FILES = MAX_PAGES * SLOTS_PER_PAGE;
const STORAGE_KEY = 'photo-ocr-keeper-v5';
const OCR_API_ENDPOINT = '/api/ocr';

const photoInputEl = document.getElementById('photoInput');
const processBtnEl = document.getElementById('processBtn');
const pageSelectEl = document.getElementById('pageSelect');
const deletePageBtnEl = document.getElementById('deletePageBtn');
const slotsEl = document.getElementById('slots');
const slotTemplate = document.getElementById('slotTemplate');
const matchModeEl = document.getElementById('matchMode');
const matchTextEl = document.getElementById('matchText');
const progressFillEl = document.getElementById('progressFill');
const progressLabelEl = document.getElementById('progressLabel');
const progressCountEl = document.getElementById('progressCount');

const pendingFiles = [];

const defaultSlot = () => ({ text: '', ocrFailed: false, copyHistory: [] });
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
    updateQueueStatus('選択写真は200枚までです');
    photoInputEl.value = '';
    return;
  }

  const accepted = selected.slice(0, room);
  pendingFiles.push(...accepted);
  if (selected.length > room) updateQueueStatus(`200枚上限のため ${selected.length - room} 枚は追加されませんでした`);
  else updateQueueStatus(`${accepted.length}枚を追加しました`);

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
      updateQueueStatus();
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

    node.querySelector('.slot-index').textContent = String(idx + 1);
    textArea.value = slot.text;
    meta.textContent = slot.text ? `${slot.text.length}字` : '';

    textArea.addEventListener('focus', () => textArea.classList.add('selected'));
    textArea.addEventListener('blur', () => textArea.classList.remove('selected'));
    textArea.addEventListener('input', () => {
      slot.text = textArea.value;
      meta.textContent = slot.text ? `${slot.text.length}字` : '';
      saveState();
      updateQueueStatus();
    });

    copyBtn.addEventListener('click', async () => {
      if (!slot.text) return;
      try {
        await navigator.clipboard.writeText(slot.text);
        slot.copyHistory.push(slot.text);
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'コピーしました';
        copyBtn.disabled = true;
        setTimeout(() => {
          copyBtn.textContent = prev;
          copyBtn.disabled = false;
        }, 1600);
        saveState();
      } catch {
        // noop
      }
    });

    slotsEl.appendChild(node);
  });
}

async function processImages() {
  const canExtract = getExtractableCount();
  if (!canExtract) return;

  const emptySlots = flattenSlots().filter(({ slot }) => !slot.text);
  ensurePageCapacity(emptySlots.length + pendingFiles.length);
  const targets = flattenSlots().filter(({ slot }) => !slot.text);
  if (!targets.length) return;

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
      const text = await recognizeWithFallback(current, i, jobs.length);
      extracted = findMatch(text, matchMode, matchText);
    } catch {
      extracted = '';
    }

    target.page.slots[target.slotIdx] = extracted
      ? { ...defaultSlot(), text: extracted }
      : { ...defaultSlot(), text: '読み取れませんでした', ocrFailed: true };
  }

  pendingFiles.length = 0;
  progressLabelEl.textContent = '完了';
  progressCountEl.textContent = jobs.length ? `${jobs.length}/${jobs.length}` : '';
  progressFillEl.style.width = '100%';

  saveState();
  renderPager();
  renderSlots();
  updateQueueStatus();
}

async function recognizeWithFallback(file, index, total) {
  try {
    const apiText = await recognizeByBackend(file);
    if (apiText) return apiText;
  } catch {
    // fallback to local
  }
  const preprocessed = await preprocessImage(file);
  const result = await Tesseract.recognize(preprocessed, 'jpn+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        const localProgress = Math.round(((index + m.progress) / total) * 100);
        progressFillEl.style.width = `${Math.min(100, Math.max(0, localProgress))}%`;
      }
    },
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1'
  });
  return result.data.text || '';
}

async function recognizeByBackend(file) {
  const formData = new FormData();
  formData.append('image', file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(OCR_API_ENDPOINT, { method: 'POST', body: formData, signal: controller.signal });
    if (!res.ok) throw new Error('backend unavailable');
    const data = await res.json();
    return typeof data.text === 'string' ? data.text : '';
  } finally {
    clearTimeout(timer);
  }
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
  const scale = imageBitmap.width > 1400 ? 1400 / imageBitmap.width : 1;
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
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.25 + 128));
    const bw = boosted > 150 ? 255 : 0;
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
    updateQueueStatus();
    return;
  }

  state.pages = state.pages.filter((p) => p.id !== state.currentPage);
  state.currentPage = state.pages[0].id;
  saveState();
  renderPager();
  renderSlots();
  updateQueueStatus();
}

function getExtractableCount() {
  const used = flattenSlots().filter(({ slot }) => !!slot.text).length;
  const free = MAX_FILES - used;
  return Math.max(0, Math.min(pendingFiles.length, free));
}

function updateQueueStatus(message = '') {
  const extractable = getExtractableCount();
  processBtnEl.disabled = extractable === 0;
  processBtnEl.textContent = extractable > 0 ? `文字抽出（${extractable}件）` : '文字抽出';

  if (message) {
    progressLabelEl.textContent = message;
    progressCountEl.textContent = pendingFiles.length ? `${pendingFiles.length}枚選択 / 抽出可能${extractable}件` : '';
    return;
  }

  progressLabelEl.textContent = pendingFiles.length ? `選択中: ${pendingFiles.length}枚` : '';
  progressCountEl.textContent = pendingFiles.length ? `抽出可能: ${extractable}件` : '';
  if (!pendingFiles.length) progressFillEl.style.width = '0%';
}
