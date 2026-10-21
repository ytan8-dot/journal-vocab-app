let journals = [];
let vocabList = [];
let dragFromIndex = null;

// 日記はこの端末（localStorage）を本体とし、「書き出し」時のみマスタードキュメントへ書き込む。
// journalsDirty: 書き出していない変更があるか
let journalsDirty = false;
const JOURNAL_LOCAL_KEY = 'journalAppLocal.journals';

// 単語帳: 最新データを取得できたか。false のときは前回取得した内容（キャッシュ）を表示中で、閲覧のみ。
let vocabFresh = false;
let vocabCachedAt = null;
const CACHE_KEY_VOCAB = 'journalAppCache.vocab';

const journalListEl = document.getElementById('journal-list');
const vocabTodoListEl = document.getElementById('vocab-todo-list');
const vocabDoneListEl = document.getElementById('vocab-done-list');

/* ---------------- Toast ---------------- */
function toast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------------- Confirm modal ---------------- */
function showConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  modal.classList.add('active');

  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');

  const cleanup = () => {
    modal.classList.remove('active');
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
  };
  const onOk = () => { cleanup(); onConfirm(); };
  const onCancel = () => cleanup();

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
}

/* ---------------- 前回取得分のキャッシュ ---------------- */
function saveCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (e) { /* 容量超過・無効化時は無視（キャッシュなしで動作） */ }
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
}

function updateStaleBanner() {
  const banner = document.getElementById('stale-banner');
  const notes = [];
  const stale = !vocabFresh && vocabCachedAt;
  banner.textContent = stale
    ? `英単語は前回取得した内容を表示中（閲覧のみ）／${formatDateTime(vocabCachedAt)}`
    : '';
  banner.classList.toggle('active', !!stale);
}

// 古い内容を表示している間は、保存・削除などの書き込みを止める。
// （古い一覧で上書きして、スプレッドシート側の新しいデータを消さないため）
function canWrite(fresh) {
  if (fresh) return true;
  toast('前回取得した内容を表示中のため、編集できません（閲覧のみ）', true);
  return false;
}

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
  });
});

/* ---------------- Journal ---------------- */
function saveLocalJournals() {
  try {
    localStorage.setItem(JOURNAL_LOCAL_KEY, JSON.stringify({ journals, dirty: journalsDirty }));
  } catch (e) {
    toast('端末への保存に失敗しました。早めに書き出してください', true);
  }
}

function loadLocalJournals() {
  try {
    const raw = localStorage.getItem(JOURNAL_LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function updateExportIndicator() {
  document.getElementById('export-journal-btn').classList.toggle('dirty', journalsDirty);
  document.getElementById('journal-dirty-note').textContent = journalsDirty
    ? '書き出していない変更があります'
    : '';
}

// 日記を編集したら端末に保存し、未書き出しにする
function commitJournalChange(successMessage) {
  journalsDirty = true;
  saveLocalJournals();
  updateExportIndicator();
  renderJournals();
  if (successMessage) toast(successMessage);
}

// マスタードキュメントから読み込む。
// GAS側の getJournals はエラー時に空配列を返すため、端末に日記がある状態で空が返ったら置き換えない。
async function fetchJournalsFromMaster() {
  const fetched = await Api.getJournals();
  if (fetched.length === 0 && journals.length > 0) {
    throw new Error('マスターが空で返されたため、読み込みを中止しました');
  }
  journals = fetched;
  journalsDirty = false;
  saveLocalJournals();
  updateExportIndicator();
  renderJournals();
}

async function initJournals() {
  const local = loadLocalJournals();
  if (local) {
    journals = local.journals || [];
    journalsDirty = !!local.dirty;
    renderJournals();
    updateExportIndicator();
  }
  // 書き出していない変更があるときは、マスターで上書きしない
  if (journalsDirty) return;
  try {
    await fetchJournalsFromMaster();
  } catch (e) {
    if (!local) {
      renderJournals();
      toast('日記の取得に失敗しました: ' + e.message, true);
    }
  }
}

function renderJournals() {
  journalListEl.innerHTML = '';
  if (journals.length === 0) {
    journalListEl.innerHTML = '<div class="empty-state">日記がまだありません</div>';
    return;
  }

  journals.forEach((j, index) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.index = String(index);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${escapeHtml(j.title)}</div>
        <div class="card-date">${escapeHtml(j.date)}</div>
      </div>
      <div class="card-body">
        <input type="text" class="edit-date" value="${escapeAttr(j.date)}" placeholder="Date" />
        <input type="text" class="edit-title" value="${escapeAttr(j.title)}" placeholder="Title" />
        <textarea class="edit-body" placeholder="本文">${escapeHtml(j.body)}</textarea>
        <div class="card-actions">
          <button class="btn btn-danger delete-btn">削除</button>
          <button class="btn btn-primary save-btn">保存</button>
        </div>
      </div>
    `;

    const bodyTextarea = card.querySelector('.edit-body');

    card.querySelector('.card-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
      if (card.classList.contains('expanded')) autoGrowTextarea(bodyTextarea);
    });

    bodyTextarea.addEventListener('input', () => autoGrowTextarea(bodyTextarea));

    card.querySelector('.save-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const date = card.querySelector('.edit-date').value.trim() || '日付なし';
      const title = card.querySelector('.edit-title').value.trim() || 'タイトルなし';
      const body = card.querySelector('.edit-body').value;
      journals[index] = { ...journals[index], date, title, body };
      commitJournalChange('端末に保存しました（未書き出し）');
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirm('日記の削除', `「${j.title}」を削除しますか？`, () => {
        journals.splice(index, 1);
        commitJournalChange('削除しました（未書き出し）');
      });
    });

    card.addEventListener('dragstart', () => {
      dragFromIndex = index;
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      dragFromIndex = null;
      card.classList.remove('dragging');
    });
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const toIndex = index;
      if (dragFromIndex === null || dragFromIndex === toIndex) return;
      const [moved] = journals.splice(dragFromIndex, 1);
      journals.splice(toIndex, 0, moved);
      commitJournalChange();
    });

    journalListEl.appendChild(card);
  });
}

document.getElementById('export-journal-btn').addEventListener('click', () => {
  showConfirm('マスターへ書き出し', `今の日記 ${journals.length} 件で、マスタードキュメントの中身を全部書き換えます。よろしいですか？`, async () => {
    try {
      await Api.saveJournals(journals);
      journalsDirty = false;
      saveLocalJournals();
      updateExportIndicator();
      toast('マスターへ書き出しました');
    } catch (e) {
      toast('書き出しに失敗しました: ' + e.message, true);
    }
  });
});

document.getElementById('reload-journal-btn').addEventListener('click', () => {
  const message = journalsDirty
    ? '書き出していない変更は消えます。マスタードキュメントから読み直しますか？'
    : 'マスタードキュメントから読み直しますか？';
  showConfirm('マスターから読み直し', message, async () => {
    try {
      await fetchJournalsFromMaster();
      toast('マスターから読み直しました');
    } catch (e) {
      toast('読み直しに失敗しました: ' + e.message, true);
    }
  });
});

document.getElementById('add-journal-fab').addEventListener('click', () => {
  showConfirm('日記の追加', '新しい日記を追加しますか？', () => {
    const today = new Date().toISOString().slice(0, 10);
    journals.unshift({ date: today, title: '', body: '', id: -1 });
    renderJournals();
    const firstCard = journalListEl.querySelector('.card');
    if (firstCard) {
      firstCard.classList.add('expanded');
      firstCard.querySelector('.edit-title').focus();
      autoGrowTextarea(firstCard.querySelector('.edit-body'));
    }
  });
});

/* ---------------- Vocab ---------------- */
async function loadVocab() {
  try {
    vocabList = await Api.getVocabList();
    vocabFresh = true;
    saveCache(CACHE_KEY_VOCAB, vocabList);
    renderVocab();
  } catch (e) {
    const cached = loadCache(CACHE_KEY_VOCAB);
    if (cached) {
      vocabList = cached.data;
      vocabCachedAt = cached.savedAt;
      vocabFresh = false;
      renderVocab();
      toast('単語帳の取得に失敗したため、前回の内容を表示します', true);
    } else {
      toast('単語帳の取得に失敗しました: ' + e.message, true);
    }
  }
  updateStaleBanner();
}

function renderVocab() {
  vocabTodoListEl.innerHTML = '';
  vocabDoneListEl.innerHTML = '';

  const todo = vocabList.filter((v) => v.status !== '完了');
  const done = vocabList.filter((v) => v.status === '完了');

  if (todo.length === 0) {
    vocabTodoListEl.innerHTML = '<div class="empty-state">未完了の単語はありません</div>';
  } else {
    todo.forEach((v) => vocabTodoListEl.appendChild(buildVocabItem(v)));
  }

  if (done.length === 0) {
    vocabDoneListEl.innerHTML = '<div class="empty-state">完了した単語はありません</div>';
  } else {
    done.forEach((v) => vocabDoneListEl.appendChild(buildVocabItem(v)));
  }
}

function buildVocabItem(v) {
  const isDone = v.status === '完了';

  const card = document.createElement('div');
  card.className = 'card vocab-card';
  card.dataset.row = String(v.rowIndex);

  card.innerHTML = `
    <div class="card-header">
      <input type="checkbox" ${isDone ? 'checked' : ''} />
      <div class="card-title${isDone ? ' is-done' : ''}">${escapeHtml(v.japanese)}</div>
    </div>
    <div class="card-body">
      <input type="text" class="edit-english" value="${escapeAttr(v.english)}" placeholder="English" />
      <div class="card-actions">
        <button class="btn btn-danger delete-btn">削除</button>
        <button class="btn btn-primary save-btn">保存</button>
      </div>
    </div>
  `;

  const checkbox = card.querySelector('input[type="checkbox"]');
  const englishInput = card.querySelector('.edit-english');
  const saveBtn = card.querySelector('.save-btn');
  const deleteBtn = card.querySelector('.delete-btn');

  card.querySelector('.card-header').addEventListener('click', (e) => {
    if (e.target === checkbox) return;
    card.classList.toggle('expanded');
  });

  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', async () => {
    if (!canWrite(vocabFresh)) {
      checkbox.checked = !checkbox.checked;
      return;
    }
    const newStatus = checkbox.checked ? '完了' : '未完了';
    try {
      await Api.updateVocabStatus(v.rowIndex, newStatus);
      v.status = newStatus;
      renderVocab();
      toast(newStatus === '完了' ? '完了にしました' : '未完了に戻しました');
    } catch (e) {
      checkbox.checked = !checkbox.checked;
      toast('更新に失敗しました: ' + e.message, true);
    }
  });

  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!canWrite(vocabFresh)) return;
    const newEnglish = englishInput.value.trim();
    try {
      await Api.updateVocabEntry(v.rowIndex, v.japanese, newEnglish);
      v.english = newEnglish;
      toast('保存しました');
    } catch (err) {
      englishInput.value = v.english;
      toast('保存に失敗しました: ' + err.message, true);
    }
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!canWrite(vocabFresh)) return;
    showConfirm('単語の削除', `「${v.japanese}」を削除しますか？`, async () => {
      try {
        await Api.deleteVocabEntry(v.rowIndex);
        vocabList = vocabList.filter((x) => x.rowIndex !== v.rowIndex);
        renderVocab();
        toast('削除しました');
      } catch (err) {
        toast('削除に失敗しました: ' + err.message, true);
      }
    });
  });

  return card;
}

document.getElementById('add-vocab-fab').addEventListener('click', () => {
  if (!canWrite(vocabFresh)) return;
  showConfirm('単語の追加', '新しい単語を追加しますか？', () => {
    addNewVocabCard();
  });
});

function addNewVocabCard() {
  const emptyState = vocabTodoListEl.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const card = document.createElement('div');
  card.className = 'card vocab-card expanded';
  card.innerHTML = `
    <div class="card-header">
      <input type="checkbox" disabled />
      <input type="text" class="edit-japanese" placeholder="日本語" />
    </div>
    <div class="card-body">
      <input type="text" class="edit-english" placeholder="English" />
      <div class="card-actions">
        <button class="btn btn-ghost cancel-btn">キャンセル</button>
        <button class="btn btn-primary save-new-btn">追加</button>
      </div>
    </div>
  `;

  vocabTodoListEl.prepend(card);
  card.querySelector('.edit-japanese').focus();

  card.querySelector('.cancel-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    card.remove();
    if (!vocabTodoListEl.querySelector('.card')) renderVocab();
  });

  card.querySelector('.save-new-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const japanese = card.querySelector('.edit-japanese').value.trim();
    const english = card.querySelector('.edit-english').value.trim();
    if (!japanese && !english) {
      toast('日本語または英語を入力してください', true);
      return;
    }
    try {
      await Api.addVocabEntry(japanese, english);
      toast('単語を追加しました');
      await loadVocab();
    } catch (err) {
      toast('追加に失敗しました: ' + err.message, true);
    }
  });
}

/* ---------------- Sync modal ---------------- */
const syncModal = document.getElementById('sync-modal');
const syncModalMessage = document.getElementById('sync-modal-message');
const syncRunBtn = document.getElementById('sync-run-btn');

async function openSyncModal() {
  syncModal.classList.add('active');
  syncModalMessage.textContent = '確認中...';
  syncRunBtn.disabled = true;
  try {
    const result = await Api.checkUnprocessedFiles();
    // 日記はHTML上で管理するため、同期の案内は単語のみ表示する
    syncModalMessage.textContent = String(result.details || '').replace(/Journal:\s*[^,]*,\s*/, '');
    syncRunBtn.disabled = !result.hasFiles;
  } catch (e) {
    syncModalMessage.textContent = '確認に失敗しました（前回取得した内容で続けられます）: ' + e.message;
  }
}

document.getElementById('sync-btn').addEventListener('click', openSyncModal);

document.getElementById('sync-cancel-btn').addEventListener('click', () => {
  syncModal.classList.remove('active');
});

syncRunBtn.addEventListener('click', async () => {
  syncRunBtn.disabled = true;
  syncModalMessage.textContent = '同期を実行中...';
  try {
    const result = await Api.performSync();
    syncModalMessage.textContent = result.message || '同期が完了しました';
    toast(result.message || '同期が完了しました');
    await loadVocab();
    setTimeout(() => syncModal.classList.remove('active'), 800);
  } catch (e) {
    syncModalMessage.textContent = '同期に失敗しました: ' + e.message;
    syncRunBtn.disabled = false;
  }
});

/* ---------------- Utils ---------------- */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
function autoGrowTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ---------------- Init ---------------- */
// 単語帳は通信を待たずに前回取得した内容をまず表示する（この間は閲覧のみ）
const cachedVocab = loadCache(CACHE_KEY_VOCAB);
if (cachedVocab) {
  vocabList = cachedVocab.data;
  vocabCachedAt = cachedVocab.savedAt;
  renderVocab();
}
updateStaleBanner();

initJournals();
loadVocab();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.error('SW register failed', e));
  });
}
