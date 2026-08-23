/**
 * GAS Web App との通信モジュール
 * デプロイ後、GAS_WEB_APP_URL を実際のWebアプリURLに置き換えること。
 *
 * アクセス制御について:
 * GASのデプロイは「アクセスできるユーザー: 全員」である必要がある
 * （「自分のみ」だとGoogleログイン画面へのリダイレクトが発生し、fetchがCORSでブロックされるため）。
 * その代わり、GAS側で照合する秘密のトークンを毎回のリクエストに付与する。
 * トークンの値はこのファイル（公開されうるソースコード）には書かず、
 * ブラウザのlocalStorageにのみ保存する（初回アクセス時にプロンプトで入力）。
 */
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw9Q4prTRWJnIR1WbjCCV-Pl2eKsszltW68ASZdyZBLWM6LzYXTg15ZdflFTGzjg-18/exec';
const API_TOKEN_STORAGE_KEY = 'journalAppApiToken';

function getApiToken() {
  let token = localStorage.getItem(API_TOKEN_STORAGE_KEY);
  if (!token) {
    token = window.prompt('APIトークンを入力してください（GAS側に設定した値）');
    if (token) localStorage.setItem(API_TOKEN_STORAGE_KEY, token.trim());
  }
  return (token || '').trim();
}

function clearApiToken() {
  localStorage.removeItem(API_TOKEN_STORAGE_KEY);
}

async function apiGet(action) {
  const url = `${GAS_WEB_APP_URL}?action=${encodeURIComponent(action)}&token=${encodeURIComponent(getApiToken())}`;
  const res = await fetch(url, { method: 'GET' });
  const json = await res.json();
  if (!json.success) {
    if (json.message === 'Unauthorized') clearApiToken();
    throw new Error(json.message || `API error: ${action}`);
  }
  return json.data;
}

async function apiPost(action, payload) {
  // Content-Type: text/plain にすることでpreflight(OPTIONS)を回避する
  const res = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: getApiToken(), payload })
  });
  const json = await res.json();
  if (!json.success) {
    if (json.message === 'Unauthorized') clearApiToken();
    throw new Error(json.message || `API error: ${action}`);
  }
  return json;
}

const Api = {
  getJournals: () => apiGet('getJournals'),
  saveJournals: (journals) => apiPost('saveJournals', { journals }),
  getVocabList: () => apiGet('getVocabList'),
  updateVocabStatus: (rowIndex, newStatus) => apiPost('updateVocabStatus', { rowIndex, newStatus }),
  updateVocabEntry: (rowIndex, japanese, english) => apiPost('updateVocabEntry', { rowIndex, japanese, english }),
  deleteVocabEntry: (rowIndex) => apiPost('deleteVocabEntry', { rowIndex }),
  checkUnprocessedFiles: () => apiGet('checkUnprocessedFiles'),
  performSync: () => apiPost('performSync', {})
};
