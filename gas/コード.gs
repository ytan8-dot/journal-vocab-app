/**
 * Master IDs
 */
const JOURNAL_MASTER_ID = '15vzRnUhnCPwrPv6W3dt8dBiUO59bYup_-4_aCA7CShY';
const VOCAB_MASTER_ID = '1KcJME_SBXIaXIJiL3M9CZ-0M8lnmq9e9dR0xpjoxIW4';

/**
 * =========================
 * API エントリーポイント
 * =========================
 * 読み取り系: GET  ?action=xxx&token=xxx
 * 書き込み系: POST body(JSON文字列) = { action: 'xxx', token: 'xxx', payload: {...} }
 *   ※ ブラウザからのpreflight(OPTIONS)を避けるため、
 *     fetch側は Content-Type: text/plain で送信すること。
 *
 * デプロイの「アクセスできるユーザー」は「全員」のままにする必要がある
 * （「自分のみ」だとGoogleログイン画面へのリダイレクトが発生し、
 *   外部サイトからのfetchがCORSでブロックされるため）。
 * 代わりに、ここで独自のトークン照合を行うことでアクセスを制限する。
 * トークンの実際の値はコードに書かず、
 * 「プロジェクトの設定」→「スクリプト プロパティ」に API_TOKEN として保存すること。
 */
function isAuthorized(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  return !!expected && token === expected;
}

function doGet(e) {
  if (!isAuthorized(e.parameter.token)) {
    return jsonResponse({ success: false, message: 'Unauthorized' });
  }
  const action = e.parameter.action;
  try {
    let data;
    switch (action) {
      case 'getJournals':
        data = getJournals();
        break;
      case 'getVocabList':
        data = getVocabList();
        break;
      case 'checkUnprocessedFiles':
        data = checkUnprocessedFiles();
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }
    return jsonResponse({ success: true, data: data });
  } catch (err) {
    return jsonResponse({ success: false, message: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!isAuthorized(body.token)) {
      return jsonResponse({ success: false, message: 'Unauthorized' });
    }
    const action = body.action;
    const payload = body.payload || {};
    let result;

    switch (action) {
      case 'saveJournals':
        result = saveJournals(payload.journals);
        break;
      case 'updateVocabStatus':
        result = updateVocabStatus(payload.rowIndex, payload.newStatus);
        break;
      case 'updateVocabEntry':
        result = updateVocabEntry(payload.rowIndex, payload.japanese, payload.english);
        break;
      case 'deleteVocabEntry':
        result = deleteVocabEntry(payload.rowIndex);
        break;
      case 'performSync':
        result = performSync();
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    // 既存関数は { success, message } を返すものが多いので、そのまま透過する
    if (result && typeof result === 'object' && 'success' in result) {
      return jsonResponse(result);
    }
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    return jsonResponse({ success: false, message: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getVocabSheet() {
  if (!VOCAB_MASTER_ID) {
    throw new Error('VocabMasterのスプレッドシートIDが設定されていません。');
  }
  return SpreadsheetApp.openById(VOCAB_MASTER_ID).getSheetByName('VocabList') ||
         SpreadsheetApp.openById(VOCAB_MASTER_ID).getActiveSheet();
}

/**
 * ファイルが「マイドライブ直下」にあるかどうかを判定する補助関数
 */
function isFileInRoot(file, rootFolderId) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === rootFolderId) {
      return true;
    }
  }
  return false;
}

/**
 * マイドライブ直下のみを対象に未処理ファイルを判定
 */
function checkUnprocessedFiles() {
  try {
    const rootFolder = DriveApp.getRootFolder();
    const rootFolderId = rootFolder.getId();
    const files = rootFolder.getFiles();
    let hasJournal = false, hasVocab = false;

    while (files.hasNext()) {
      const f = files.next();
      if (!isFileInRoot(f, rootFolderId)) continue; // フォルダ内のファイルはスキップ

      const n = f.getName();
      if (n.startsWith('Journal_')) hasJournal = true;
      if (n.startsWith('Vocab_')) hasVocab = true;
    }
    return { hasFiles: hasJournal || hasVocab, details: `Journal: ${hasJournal ? 'あり' : 'なし'}, Vocab: ${hasVocab ? 'あり' : 'なし'}` };
  } catch (e) {
    return { hasFiles: false, details: '判定エラー: ' + e.toString() };
  }
}

/**
 * マイドライブ直下のみを対象に同期を実行
 */
function performSync() {
  const rootFolder = DriveApp.getRootFolder();
  const rootFolderId = rootFolder.getId();
  let oldFolder;
  const oldFolders = rootFolder.getFoldersByName('old');
  oldFolder = oldFolders.hasNext() ? oldFolders.next() : rootFolder.createFolder('old');

  let jCount = 0, vCount = 0;
  const files = rootFolder.getFiles();

  let currentJournals = getJournals();

  while (files.hasNext()) {
    const file = files.next();
    if (!isFileInRoot(file, rootFolderId)) continue; // フォルダ内のファイルはスキップ

    const name = file.getName(), mime = file.getMimeType();
    if (name.startsWith('Journal_') && mime === MimeType.GOOGLE_DOCS) {
      const text = DocumentApp.openById(file.getId()).getBody().getText().trim();
      const parsed = parseSingleJournalFast(text);
      if (parsed) {
        currentJournals.push(parsed);
        jCount++;
      }
      file.moveTo(oldFolder);
    } else if (name.startsWith('Vocab_') && mime === MimeType.GOOGLE_SHEETS) {
      const data = SpreadsheetApp.openById(file.getId()).getActiveSheet().getDataRange().getValues();
      const rows = [];
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] || data[i][1]) {
          rows.push([data[i][0] || '', data[i][1] || '', data[i][2] || '未完了']);
        }
      }
      if (rows.length > 0) { appendVocabToMaster(rows); vCount += rows.length; }
      file.moveTo(oldFolder);
    }
  }

  if (jCount > 0) {
    sortJournalsByDate(currentJournals);
    saveJournals(currentJournals);
  }

  return { success: true, message: `同期完了（日記: ${jCount}件、単語: ${vCount}件）` };
}

function parseSingleJournalFast(raw) {
  if (!raw) return null;
  const cleanText = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleanText) return null;

  const lines = cleanText.split('\n');
  let date = '';
  let title = '';
  const bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!date && /^Date[:：]/i.test(line)) {
      date = line.replace(/^Date[:：]\s*/i, '').trim();
    } else if (!title && /^Title[:：]/i.test(line)) {
      title = line.replace(/^Title[:：]\s*/i, '').trim();
    } else {
      bodyLines.push(lines[i]);
    }
  }

  return {
    date: date || '日付なし',
    title: title || 'タイトルなし',
    body: bodyLines.join('\n').trim()
  };
}

function sortJournalsByDate(journals) {
  if (!journals || !Array.isArray(journals)) return;
  journals.sort((a, b) => {
    if (a.date === '日付なし') return 1;
    if (b.date === '日付なし') return -1;
    return b.date.localeCompare(a.date);
  });
}

function appendVocabToMaster(rows) {
  try {
    const sheet = getVocabSheet();
    if (sheet.getLastRow() === 0) sheet.appendRow(['日本語', '英語', 'ステータス']);
    rows.forEach(r => sheet.appendRow(r));
  } catch (e) {
    Logger.log('appendVocabToMaster error: ' + e.toString());
  }
}

function getJournals() {
  try {
    const doc = DocumentApp.openById(JOURNAL_MASTER_ID);
    const fullText = doc.getBody().getText();
    if (!fullText || !fullText.trim()) return [];

    const entriesRaw = fullText.split(/---ENTRY_BREAK---|===ENTRY_BREAK===/);
    const journals = [];

    for (let i = 0; i < entriesRaw.length; i++) {
      const raw = entriesRaw[i];
      if (!raw || !raw.trim()) continue;

      const parsed = parseSingleJournalFast(raw);
      if (parsed) {
        parsed.id = i;
        journals.push(parsed);
      }
    }

    return journals;
  } catch (e) {
    Logger.log('Error in getJournals: ' + e.toString());
    return [];
  }
}

function saveJournals(journals) {
  try {
    const masterDoc = DocumentApp.openById(JOURNAL_MASTER_ID);
    const body = masterDoc.getBody();
    body.clear();

    const textBlocks = journals.map(j => `Date: ${j.date}\nTitle: ${j.title}\n${j.body}`);
    body.setText(textBlocks.join('\n---ENTRY_BREAK---\n'));
    masterDoc.saveAndClose();

    return { success: true, message: '変更を保存しました。' };
  } catch (e) {
    return { success: false, message: '保存エラー: ' + e.toString() };
  }
}

function getVocabList() {
  try {
    const sheet = getVocabSheet();
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return [];
    return values.slice(1).map((v, i) => ({ rowIndex: i + 2, japanese: v[0] || '', english: v[1] || '', status: v[2] || '未完了' }));
  } catch (e) {
    Logger.log('Error in getVocabList: ' + e.toString());
    return [];
  }
}

function updateVocabStatus(rowIndex, newStatus) {
  try {
    const sheet = getVocabSheet();
    sheet.getRange(rowIndex, 3).setValue(newStatus);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function updateVocabEntry(rowIndex, japanese, english) {
  try {
    const sheet = getVocabSheet();
    sheet.getRange(rowIndex, 1, 1, 2).setValues([[japanese, english]]);
    return { success: true, message: '単語情報を更新しました。' };
  } catch (e) {
    return { success: false, message: '更新エラー: ' + e.toString() };
  }
}

function deleteVocabEntry(rowIndex) {
  try {
    const sheet = getVocabSheet();
    sheet.deleteRow(rowIndex);
    return { success: true, message: '単語を削除しました。' };
  } catch (e) {
    return { success: false, message: '削除エラー: ' + e.toString() };
  }
}
