let journals = [];
let vocabList = [];
let dragFromIndex = null;

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
async function loadJournals() {
  try {
    journals = await Api.getJournals();
    renderJournals();
  } catch (e) {
    toast('日記の取得に失敗しました: ' + e.message, true);
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

    card.querySelector('.card-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });

    card.querySelector('.save-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const date = card.querySelector('.edit-date').value.trim() || '日付なし';
      const title = card.querySelector('.edit-title').value.trim() || 'タイトルなし';
      const body = card.querySelector('.edit-body').value;
      journals[index] = { ...journals[index], date, title, body };
      await persistJournals('保存しました');
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirm('日記の削除', `「${j.title}」を削除しますか？`, async () => {
        journals.splice(index, 1);
        await persistJournals('削除しました');
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
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      const toIndex = index;
      if (dragFromIndex === null || dragFromIndex === toIndex) return;
      const [moved] = journals.splice(dragFromIndex, 1);
      journals.splice(toIndex, 0, moved);
      await persistJournals();
    });

    journalListEl.appendChild(card);
  });
}

async function persistJournals(successMessage) {
  try {
    await Api.saveJournals(journals);
    if (successMessage) toast(successMessage);
    await loadJournals();
  } catch (e) {
    toast('保存に失敗しました: ' + e.message, true);
  }
}

document.getElementById('add-journal-fab').addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);
  journals.unshift({ date: today, title: '', body: '', id: -1 });
  renderJournals();
  const firstCard = journalListEl.querySelector('.card');
  if (firstCard) {
    firstCard.classList.add('expanded');
    firstCard.querySelector('.edit-title').focus();
  }
});

/* ---------------- Vocab ---------------- */
async function loadVocab() {
  try {
    vocabList = await Api.getVocabList();
    renderVocab();
  } catch (e) {
    toast('単語帳の取得に失敗しました: ' + e.message, true);
  }
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

/* ---------------- Sync modal ---------------- */
const syncModal = document.getElementById('sync-modal');
const syncModalMessage = document.getElementById('sync-modal-message');
const syncRunBtn = document.getElementById('sync-run-btn');

document.getElementById('sync-btn').addEventListener('click', async () => {
  syncModal.classList.add('active');
  syncModalMessage.textContent = '確認中...';
  syncRunBtn.disabled = true;
  try {
    const result = await Api.checkUnprocessedFiles();
    syncModalMessage.textContent = result.details;
    syncRunBtn.disabled = !result.hasFiles;
  } catch (e) {
    syncModalMessage.textContent = '確認に失敗しました: ' + e.message;
  }
});

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
    await loadJournals();
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

/* ---------------- Init ---------------- */
loadJournals();
loadVocab();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.error('SW register failed', e));
  });
}
