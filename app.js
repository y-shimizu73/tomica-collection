/**
 * トミカ コレクション カタログ - Firebase対応版（リアルタイム同期＆クライアント側画像圧縮）
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- Firebase 接続設定 ---
let firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let serverGeminiApiKey = null;

// Git管理外の設定ファイルがあれば動的に読み込む
try {
  const localConfig = await import('./firebase-config.js').catch(() => null);
  if (localConfig) {
    if (localConfig.firebaseConfig) {
      firebaseConfig = localConfig.firebaseConfig;
    }
    if (localConfig.geminiApiKey) {
      serverGeminiApiKey = localConfig.geminiApiKey;
    }
  }
} catch (e) {
  console.log("Local firebase-config.js not found, using default credentials.");
}

// Firebase の初期化（安全なエラーハンドリング）
let firebaseApp = null;
let db = null;
let tomicaCollectionRef = null;

try {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_") || firebaseConfig.apiKey === "") {
    throw new Error("Firebase API key is not configured.");
  }
  firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
  tomicaCollectionRef = collection(db, "tomicas");
} catch (e) {
  console.error("Firebase initialization failed:", e);
}


// --- データの同期 (Firestore Realtime Listener) ---
function subscribeToTomicas() {
  if (!tomicaCollectionRef) {
    console.warn("Firestore sync skipped because Firebase was not initialized.");
    alert("データベースの接続設定（APIキー等）が完了していないか、誤っています。Vercelの環境変数またはローカルの設定ファイルを確認してください。");
    return;
  }
  // Firestoreの更新をリアルタイム監視
  onSnapshot(tomicaCollectionRef, (snapshot) => {
    const items = [];
    snapshot.forEach((doc) => {
      items.push(doc.data());
    });
    
    state.items = items;
    updateStats();
    renderCatalogGrid();
  }, (error) => {
    console.error("Firestore sync error:", error);
    alert("データベースへの接続に失敗しました。Firebaseのセキュリティルール（テストモード）が正しく設定されているかご確認ください。");
  });
}

// トミカの保存 (Firestore)
async function saveTomica(tomica) {
  if (!tomicaCollectionRef) {
    alert("データベースが初期化されていないため、保存できません。");
    return;
  }
  const docRef = doc(tomicaCollectionRef, tomica.id);
  await setDoc(docRef, tomica);
}

// トミカの削除 (Firestore)
async function deleteTomicaFromDB(id) {
  if (!tomicaCollectionRef) {
    alert("データベースが初期化されていないため、削除できません。");
    return;
  }
  const docRef = doc(tomicaCollectionRef, id);
  await deleteDoc(docRef);
}


// --- 旧ローカルデータベース定義 (データ移行用) ---
const LOCAL_DB_NAME = 'TomicaCatalogDB';
const LOCAL_STORE_NAME = 'tomicas';

function getLocalDBData() {
  return new Promise((resolve) => {
    const request = indexedDB.open(LOCAL_DB_NAME, 1);
    request.onerror = () => resolve([]);
    request.onsuccess = (event) => {
      const localDb = event.target.result;
      if (!localDb.objectStoreNames.contains(LOCAL_STORE_NAME)) {
        resolve([]);
        return;
      }
      const transaction = localDb.transaction([LOCAL_STORE_NAME], 'readonly');
      const store = transaction.objectStore(LOCAL_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    };
  });
}

function clearLocalDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open(LOCAL_DB_NAME, 1);
    request.onsuccess = (event) => {
      const localDb = event.target.result;
      if (!localDb.objectStoreNames.contains(LOCAL_STORE_NAME)) {
        resolve();
        return;
      }
      const transaction = localDb.transaction([LOCAL_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(LOCAL_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    };
  });
}

// 自動移行処理
async function migrateLocalDataToCloud() {
  try {
    const localItems = await getLocalDBData();
    if (localItems && localItems.length > 0) {
      const confirmMigration = confirm(`端末のローカルデータベースに ${localItems.length} 件のデータが見つかりました。\nこれを新しく追加したクラウドデータベースへ同期しますか？`);
      if (confirmMigration) {
        let successCount = 0;
        for (const item of localItems) {
          // 画像を含むデータをFirestoreへアップロード
          await saveTomica(item);
          successCount++;
        }
        await clearLocalDB(); // 移行完了後にローカルを空に
        alert(`${successCount} 件のローカルデータをクラウドに移行完了しました！`);
      }
    }
  } catch (error) {
    console.error("Migration failed:", error);
  }
}


// --- アプリケーション状態 ---
const state = {
  items: [],
  searchQuery: '',
  activeCategory: 'all',
  sortBy: 'dateDesc',
  theme: 'dark',
  currentImageBase64: null,
  editingId: null,
  isNewImageSelected: false // 画像が新しく選択されたかのフラグ
};


// --- カテゴリの和訳マップ ---
const CATEGORY_MAP = {
  standard: '定番トミカ',
  premium: 'トミカプレミアム',
  long: 'ロングタイプ',
  dream: 'ドリームトミカ',
  limited: 'リミテッド/特注',
  other: 'その他'
};

// --- DOM 要素の取得 ---
const catalogGrid = document.getElementById('catalogGrid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const categoryFilterBar = document.getElementById('categoryFilterBar');
const addTomicaBtn = document.getElementById('addTomicaBtn');

// 統計要素
const statTotalCount = document.getElementById('statTotalCount');
const statFavCount = document.getElementById('statFavCount');
const statCleanCount = document.getElementById('statCleanCount');

// ダイアログ要素 (追加/編集)
const addEditDialog = document.getElementById('addEditDialog');
const addEditForm = document.getElementById('addEditForm');
const dialogTitle = document.getElementById('dialogTitle');
const tomicaIdInput = document.getElementById('tomicaId');
const tomicaNameInput = document.getElementById('tomicaName');
const tomicaNumberInput = document.getElementById('tomicaNumber');
const tomicaBrandInput = document.getElementById('tomicaBrand');
const tomicaCategorySelect = document.getElementById('tomicaCategory');
const tomicaConditionSelect = document.getElementById('tomicaCondition');
const tomicaIsFavoriteInput = document.getElementById('tomicaIsFavorite');
const tomicaNotesInput = document.getElementById('tomicaNotes');
const favStatusText = document.getElementById('favStatusText');

// 画像アップロード要素
const imageInput = document.getElementById('imageInput');
const cameraInput = document.getElementById('cameraInput');
const aiScanInput = document.getElementById('aiScanInput');
const cameraUploadBtn = document.getElementById('cameraUploadBtn');
const fileUploadBtn = document.getElementById('fileUploadBtn');
const aiScanBtn = document.getElementById('aiScanBtn');
const imageUploadWrapper = document.getElementById('imageUploadWrapper');
const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const removeImageBtn = document.getElementById('removeImageBtn');




// ダイアログ閉じるボタン
const closeAddEditBtn = document.getElementById('closeAddEditBtn');
const cancelAddEditBtn = document.getElementById('cancelAddEditBtn');

// 詳細ダイアログ要素
const detailDialog = document.getElementById('detailDialog');
const closeDetailBtn = document.getElementById('closeDetailBtn');
const closeDetailFooterBtn = document.getElementById('closeDetailFooterBtn');
const editTomicaBtn = document.getElementById('editTomicaBtn');
const deleteTomicaBtn = document.getElementById('deleteTomicaBtn');
const detailImg = document.getElementById('detailImg');
const detailTitleName = document.getElementById('detailTitleName');
const detailTitleNumber = document.getElementById('detailTitleNumber');
const detailCategoryLabel = document.getElementById('detailCategoryLabel');
const detailBrand = document.getElementById('detailBrand');

const detailCondition = document.getElementById('detailCondition');
const detailCreatedDate = document.getElementById('detailCreatedDate');
const detailNotes = document.getElementById('detailNotes');
const detailNotesBox = document.getElementById('detailNotesBox');
const detailFavBtn = document.getElementById('detailFavBtn');

// テーマ
const themeToggle = document.getElementById('themeToggle');


// トリミング（Cropper）要素
let cropper = null;
const cropperDialog = document.getElementById('cropperDialog');
const cropperImage = document.getElementById('cropperImage');
const cropperRotateLeftBtn = document.getElementById('cropperRotateLeftBtn');
const cropperRotateRightBtn = document.getElementById('cropperRotateRightBtn');
const cancelCropperBtn = document.getElementById('cancelCropperBtn');
const confirmCropperBtn = document.getElementById('confirmCropperBtn');

// 設定ダイアログ要素
const settingsBtn = document.getElementById('settingsBtn');
const settingsDialog = document.getElementById('settingsDialog');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');


// --- ユーティリティ関数 ---

// ID生成 (タイムスタンプベースのユニーク文字列)
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}



// 日付フォーマット
function formatDate(timestamp) {
  if (!timestamp) return '不明';
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}


// --- データの集計 ---

// 統計表示の更新
function updateStats() {
  const total = state.items.length;
  const favorites = state.items.filter(item => item.isFavorite).length;
  const clean = state.items.filter(item => item.condition === 'new').length;

  statTotalCount.textContent = total;
  statFavCount.textContent = favorites;
  statCleanCount.textContent = clean;
}


// --- カタロググリッドのレンダリング ---

function renderCatalogGrid() {
  // 1. フィルター処理
  let filtered = state.items.filter(item => {
    // 検索語でフィルタ
    const matchesSearch = 
      item.name.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
      (item.number && item.number.toLowerCase().includes(state.searchQuery.toLowerCase())) ||
      (item.brand && item.brand.toLowerCase().includes(state.searchQuery.toLowerCase())) ||
      (item.notes && item.notes.toLowerCase().includes(state.searchQuery.toLowerCase()));

    // カテゴリでフィルタ
    const matchesCategory = state.activeCategory === 'all' || item.category === state.activeCategory;

    return matchesSearch && matchesCategory;
  });

  // 2. ソート処理
  filtered.sort((a, b) => {
    if (state.sortBy === 'dateDesc') {
      return (b.createdAt || 0) - (a.createdAt || 0); // 最新順
    }
    if (state.sortBy === 'dateAsc') {
      return (a.createdAt || 0) - (b.createdAt || 0); // 古い順
    }
    if (state.sortBy === 'numAsc') {
      const numA = parseInt(a.number?.replace(/[^0-9]/g, '')) || 9999;
      const numB = parseInt(b.number?.replace(/[^0-9]/g, '')) || 9999;
      return numA - numB;
    }
    if (state.sortBy === 'nameAsc') {
      return a.name.localeCompare(b.name, 'ja'); // 名前順 (50音)
    }
    return 0;
  });

  // 既存のカードを削除 (空の状態テンプレートを残す)
  const cards = catalogGrid.querySelectorAll('.tomica-card');
  cards.forEach(card => card.remove());

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    if (state.searchQuery || state.activeCategory !== 'all') {
      emptyState.querySelector('h3').textContent = '条件に合うトミカが見つかりません';
      emptyState.querySelector('p').textContent = '検索キーワードやカテゴリを変更してみてください。';
    } else {
      emptyState.querySelector('h3').textContent = 'トミカがまだ登録されていません';
      emptyState.querySelector('p').textContent = '上の「トミカを追加」ボタンを押して、コレクションを記録しましょう！';
    }
    return;
  }

  emptyState.style.display = 'none';

  // カードを動的に作成して配置
  filtered.forEach(item => {
    const card = document.createElement('article');
    card.className = 'tomica-card';
    card.dataset.id = item.id;

    const numberBadgeHtml = item.number ? `<span class="number-badge">${escapeHTML(item.number)}</span>` : '';
    const favActive = item.isFavorite ? 'active' : '';


    
    let condClass = 'cond-good';
    let condText = '普通';
    if (item.condition === 'new') {
      condClass = 'cond-new';
      condText = '✨ きれい';
    } else if (item.condition === 'loved') {
      condClass = 'cond-loved';
      condText = '🔧 キズ多め';
    }

    const imageHtml = item.image 
      ? `<img src="${item.image}" alt="${escapeHTML(item.name)}" class="card-image" loading="lazy">`
      : `<div class="card-image-fallback">
          <span>🚗</span>
          <span style="font-size:0.65rem; color:var(--text-muted);">No Image</span>
         </div>`;

    card.innerHTML = `
      <div class="card-image-wrapper">
        ${numberBadgeHtml}
        <button class="fav-badge-btn ${favActive}" aria-label="お気に入り登録" data-fav-toggle="${item.id}">
          ❤️
        </button>
        ${imageHtml}
      </div>
      <div class="card-content">
        <div class="card-meta">
          <span class="card-category">${CATEGORY_MAP[item.category] || item.category}</span>
        </div>
        <h3 class="card-title">${escapeHTML(item.name)}</h3>
        <p class="card-manufacturer">${escapeHTML(item.brand || '---')}</p>
        <div class="card-badges-row">
          <span class="ui-badge ${condClass}">${condText}</span>
        </div>
      </div>
    `;

    // カードクリックで詳細表示
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav-toggle]')) return;
      openDetailModal(item.id);
    });

    // お気に入りボタンのイベント登録
    const favBtn = card.querySelector('[data-fav-toggle]');
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      item.isFavorite = !item.isFavorite;
      await saveTomica(item);
      // Firebaseのリアルタイムリスナーが検知してUIは自動更新されます
    });

    catalogGrid.appendChild(card);
  });
}

// XSS対策用エスケープ
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}


// --- 画像の圧縮処理 (Firestore保存容量対策 1MB上限回避) ---

/**
 * 画像をクライアント側でリサイズし、軽量なBase64文字列に圧縮変換します
 */
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.6) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // アスペクト比を維持しながら縮小サイズを計算
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // JPEGに圧縮変換してBase64を返す（容量は通常30〜80KB程度に収まります）
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}


// --- AI画像解析 (Gemini API) ---

async function startImageAnalysis(base64Data) {
  let apiKey = localStorage.getItem('gemini-api-key') || serverGeminiApiKey;
  if (apiKey) apiKey = apiKey.trim();
  if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
    console.log("Gemini API key is not configured.");
    return;
  }

  const overlay = document.getElementById('aiLoadingOverlay');
  if (overlay) overlay.style.display = 'flex';

  try {
    const rawBase64 = base64Data.split(',')[1];
    
    // Base64データURLからMIMEタイプを動的に抽出 (例: data:image/png;base64,... -> image/png)
    let mimeType = "image/jpeg";
    const mimeMatch = base64Data.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "このおもちゃの車（トミカ）の写真を分析し、以下の情報を正確に判別して日本語のJSON形式で返してください。\n\nJSONのキーと値:\n- name: 車の正式名称（例: 'トヨタ プリウス', '日産 GT-R'）\n- brand: 自動車メーカーまたは車種分類（例: 'トヨタ', 'ホンダ', '救急車'）\n- number: トミカの番号（No.から始まる数字。写真から読み取れない場合や不明な場合はnull）\n- category: トミカのカテゴリ（選択肢: 'standard' (定番トミカ), 'premium' (トミカプレミアム), 'long' (ロングタイプ), 'dream' (ドリームトミカ), 'limited' (リミテッド/特注), 'other' (その他)）\n- notes: この車に関する親しみやすい1〜2文の説明（例: 'ハイブリッドカーの先駆けとなったトヨタの代表的な車です。エコで静かな走りが特徴です。'）"
              },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: rawBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = "";
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.error?.message || errorText;
      } catch (e) {
        errorDetail = errorText;
      }
      throw new Error(`HTTP Error ${response.status}: ${errorDetail}`);
    }

    const resData = await response.json();

    // 候補（candidates）のバリデーション
    if (!resData.candidates || resData.candidates.length === 0 || !resData.candidates[0].content) {
      if (resData.promptFeedback) {
        throw new Error(`AIポリシー・安全フィルターにより解析がブロックされました: ${JSON.stringify(resData.promptFeedback)}`);
      }
      throw new Error("AIから有効な応答が得られませんでした。");
    }

    let jsonText = resData.candidates[0].content.parts[0].text;
    
    // JSON文字列が ```json ... ``` で囲まれている場合のフォールバック抽出
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0];
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0];
    }

    const result = JSON.parse(jsonText.trim());

    // フォームに値をマッピング
    if (result.name) tomicaNameInput.value = result.name;
    if (result.brand) tomicaBrandInput.value = result.brand;
    
    // トミカ番号の挿入
    if (result.number) {
      tomicaNumberInput.value = result.number;
    } else {
      tomicaNumberInput.value = '';
    }

    if (result.category) tomicaCategorySelect.value = result.category;
    if (result.notes) tomicaNotesInput.value = result.notes;

  } catch (err) {
    console.error("AI Analysis failed:", err);
    alert(`AI画像解析に失敗しました。\n詳細: ${err.message}\n\n※APIキーが有効か、Google AI Studioの設定をご確認ください。`);
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}


// --- 追加/編集フォームの処理 ---

// トリミングモーダルの起動とCropperの初期化
function openCropper(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    cropperImage.src = e.target.result;
    
    // ダイアログを表示
    cropperDialog.showModal();
    
    // 既存のCropperインスタンスがあれば破棄する
    if (cropper) {
      cropper.destroy();
    }
    
    // ダイアログが開いて寸法が確定するのを待ってから初期化 (50ms)
    setTimeout(() => {
      cropper = new window.Cropper(cropperImage, {
        aspectRatio: 4 / 3, // 4:3の横長に比率固定
        viewMode: 1, // クロップ枠を画像サイズ内に制限
        dragMode: 'move', // キャンバスをドラッグ可能にする
        autoCropArea: 0.9, // 初期表示時のクロップエリアの大きさ
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
      });
    }, 50);
  };
  reader.readAsDataURL(file);
}



// 追加フォームを開く
function openAddModal() {
  state.editingId = null;
  state.currentImageBase64 = null;
  state.isNewImageSelected = false;
  dialogTitle.textContent = 'トミカを登録する';
  addEditForm.reset();
  
  previewContainer.style.display = 'none';
  previewImage.src = '';
  
  favStatusText.textContent = 'お気に入り (🖤)';

  addEditDialog.showModal();
}

// 編集フォームを開く
async function openEditModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  state.editingId = item.id;
  state.isNewImageSelected = false; // 新規選択されていない状態にリセット
  dialogTitle.textContent = 'トミカを編集する';
  
  tomicaIdInput.value = item.id;
  tomicaNameInput.value = item.name;
  tomicaNumberInput.value = item.number || '';
  tomicaBrandInput.value = item.brand || '';
  tomicaCategorySelect.value = item.category;
  tomicaConditionSelect.value = item.condition || 'good';
  tomicaIsFavoriteInput.checked = !!item.isFavorite;
  tomicaNotesInput.value = item.notes || '';

  favStatusText.textContent = item.isFavorite ? 'お気に入り (❤️)' : 'お気に入り (🖤)';

  // 画像プレビュー設定
  if (item.image) {
    state.currentImageBase64 = item.image; // 既存画像を保持
    previewImage.src = item.image;
    previewContainer.style.display = 'flex';
  } else {
    state.currentImageBase64 = null;
    previewContainer.style.display = 'none';
    previewImage.src = '';
  }

  detailDialog.close();
  addEditDialog.showModal();
}


// --- 詳細表示モーダルの処理 ---

function openDetailModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  detailDialog.dataset.id = id;

  if (item.image) {
    detailImg.src = item.image;
    detailImg.style.display = 'block';
  } else {
    detailImg.src = '';
    detailImg.style.display = 'none';
  }

  detailTitleName.textContent = item.name;
  detailTitleNumber.textContent = item.number || 'No.無';
  detailTitleNumber.style.display = item.number ? 'inline-block' : 'none';
  detailCategoryLabel.textContent = CATEGORY_MAP[item.category] || item.category;
  detailBrand.textContent = item.brand || '---';
  

  
  let condText = '普通 (🚗)';
  if (item.condition === 'new') condText = '新品に近い (✨)';
  if (item.condition === 'loved') condText = 'よく遊んだ (🔧)';
  detailCondition.textContent = condText;

  detailCreatedDate.textContent = formatDate(item.createdAt);

  if (item.isFavorite) {
    detailFavBtn.classList.add('active');
  } else {
    detailFavBtn.classList.remove('active');
  }

  if (item.notes && item.notes.trim()) {
    detailNotes.textContent = item.notes;
    detailNotesBox.style.display = 'block';
  } else {
    detailNotes.textContent = '';
    detailNotesBox.style.display = 'none';
  }

  detailDialog.showModal();
}




// --- テーマ（ダーク/ライト）の制御 ---

function initTheme() {
  const savedTheme = localStorage.getItem('tomica-theme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('tomica-theme', theme);
  
  if (theme === 'light') {
    themeToggle.textContent = '☀️';
    themeToggle.setAttribute('title', 'ダークモードに切り替え');
  } else {
    themeToggle.textContent = '🌙';
    themeToggle.setAttribute('title', 'ライトモードに切り替え');
  }
}


// --- イベントリスナーの登録 ---

function setupEventListeners() {
  
  // 1. 検索・ソート・フィルター
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderCatalogGrid();
  });

  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderCatalogGrid();
  });

  categoryFilterBar.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;

    categoryFilterBar.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
    pill.classList.add('active');

    state.activeCategory = pill.dataset.category;
    renderCatalogGrid();
  });

  // 2. モーダル起動・終了
  addTomicaBtn.addEventListener('click', openAddModal);
  closeAddEditBtn.addEventListener('click', () => addEditDialog.close());
  cancelAddEditBtn.addEventListener('click', () => addEditDialog.close());

  // 3. 画像のアップロード
  imageUploadWrapper.addEventListener('click', (e) => {
    if (e.target.closest('#cameraUploadBtn') || e.target.closest('#fileUploadBtn') || e.target.closest('#aiScanBtn') || e.target.closest('#removeImageBtn')) {
      return;
    }
    imageInput.click();
  });
  
  cameraUploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cameraInput.click();
  });

  fileUploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    imageInput.click();
  });

  aiScanBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    aiScanInput.click();
  });

  aiScanInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      const overlay = document.getElementById('aiLoadingOverlay');
      if (overlay) overlay.style.display = 'flex';
      
      try {
        const base64 = await compressImage(file, 800, 800, 0.6);
        if (base64) {
          await startImageAnalysis(base64);
        }
      } catch (err) {
        console.error(err);
        alert("画像の読み込みまたは解析に失敗しました。");
      } finally {
        if (overlay) overlay.style.display = 'none';
        aiScanInput.value = ''; // 選択をクリア
      }
    }
  });
  
  imageInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      openCropper(e.target.files[0]);
    }
  });

  cameraInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      openCropper(e.target.files[0]);
    }
  });

  imageUploadWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageUploadWrapper.classList.add('dragover');
  });

  imageUploadWrapper.addEventListener('dragleave', () => {
    imageUploadWrapper.classList.remove('dragover');
  });

  imageUploadWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    imageUploadWrapper.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      openCropper(e.dataTransfer.files[0]);
    }
  });

  // プレビュー画像の削除
  removeImageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.currentImageBase64 = null;
    state.isNewImageSelected = true; // 画像なし状態に変更したことを示すためフラグを立てる
    imageInput.value = '';
    cameraInput.value = '';
    previewContainer.style.display = 'none';
    previewImage.src = '';
  });

  // --- トリミング（Cropper）ダイアログのイベント ---
  cropperRotateLeftBtn.addEventListener('click', () => {
    if (cropper) cropper.rotate(-90);
  });

  cropperRotateRightBtn.addEventListener('click', () => {
    if (cropper) cropper.rotate(90);
  });

  cancelCropperBtn.addEventListener('click', () => {
    cropperDialog.close();
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    imageInput.value = ''; // 選択クリア
    cameraInput.value = ''; // 選択クリア
  });

  confirmCropperBtn.addEventListener('click', () => {
    if (!cropper) return;
    
    // クロップされた画像を指定サイズで取得（4:3、最大横800px）
    const canvas = cropper.getCroppedCanvas({
      width: 800,
      height: 600,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    
    // JPEG圧縮を施してBase64化
    const base64 = canvas.toDataURL('image/jpeg', 0.6);
    
    state.currentImageBase64 = base64;
    state.isNewImageSelected = true;
    previewImage.src = base64;
    previewContainer.style.display = 'flex';
    
    cropperDialog.close();
    cropper.destroy();
    cropper = null;

    // AIで画像解析を実行 (APIキーが設定されており、名前欄が空の場合のみ自動実行)
    if (!tomicaNameInput.value.trim()) {
      startImageAnalysis(base64);
    }
  });



  tomicaIsFavoriteInput.addEventListener('change', (e) => {
    favStatusText.textContent = e.target.checked ? 'お気に入り (❤️)' : 'お気に入り (🖤)';
  });

  // 5. フォーム送信 (新規・更新)
  addEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = tomicaNameInput.value.trim();
    if (!name) {
      alert('トミカの名前を入力してください。');
      return;
    }

    // 保存ボタンを一時的に無効化して多重送信を防ぐ
    const submitBtn = document.getElementById('saveTomicaBtn');
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中...';

    try {
      // Cropper確定時にすでに圧縮済みのBase64が入っているため、そのまま保存します
      const finalImageBase64 = state.currentImageBase64;

      const id = state.editingId || generateUniqueId();
      const tomicaData = {
        id,
        name,
        number: tomicaNumberInput.value.trim(),
        brand: tomicaBrandInput.value.trim(),
        category: tomicaCategorySelect.value,
        condition: tomicaConditionSelect.value,
        isFavorite: tomicaIsFavoriteInput.checked,
        notes: tomicaNotesInput.value.trim(),
        image: finalImageBase64,
        createdAt: state.editingId 
          ? (state.items.find(i => i.id === state.editingId)?.createdAt || Date.now()) 
          : Date.now()
      };

      await saveTomica(tomicaData);
      addEditDialog.close();
    } catch (err) {
      console.error(err);
      alert(`保存に失敗しました。画像が大きすぎるか、回線エラーの可能性があります。\nエラー: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  });

  // 6. 詳細モーダルのイベント
  closeDetailBtn.addEventListener('click', () => detailDialog.close());
  closeDetailFooterBtn.addEventListener('click', () => detailDialog.close());
  
  editTomicaBtn.addEventListener('click', () => {
    const id = detailDialog.dataset.id;
    if (id) openEditModal(id);
  });

  deleteTomicaBtn.addEventListener('click', async () => {
    const id = detailDialog.dataset.id;
    if (!id) return;

    const item = state.items.find(i => i.id === id);
    if (!item) return;

    if (confirm(`トミカ「${item.name}」を削除してもよろしいですか？`)) {
      try {
        await deleteTomicaFromDB(id);
        detailDialog.close();
      } catch (err) {
        alert(`削除に失敗しました: ${err.message}`);
      }
    }
  });

  detailFavBtn.addEventListener('click', async () => {
    const id = detailDialog.dataset.id;
    if (!id) return;

    const item = state.items.find(i => i.id === id);
    if (!item) return;

    item.isFavorite = !item.isFavorite;
    await saveTomica(item);
    
    if (item.isFavorite) {
      detailFavBtn.classList.add('active');
    } else {
      detailFavBtn.classList.remove('active');
    }
  });

  // 7. テーマ
  themeToggle.addEventListener('click', () => {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  });

  // 8. 設定ダイアログ (APIキー) のイベント
  settingsBtn.addEventListener('click', () => {
    const savedKey = localStorage.getItem('gemini-api-key') || '';
    geminiApiKeyInput.value = savedKey;
    
    // サーバーの環境変数でキーが提供されている場合の表示調整
    if (serverGeminiApiKey) {
      geminiApiKeyInput.placeholder = "サーバー環境変数で設定されています（上書き可能）";
    } else {
      geminiApiKeyInput.placeholder = "AIzaSy...";
    }
    
    settingsDialog.showModal();
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsDialog.close();
  });

  saveSettingsBtn.addEventListener('click', () => {
    const key = geminiApiKeyInput.value.trim();
    if (key) {
      localStorage.setItem('gemini-api-key', key);
      alert('設定を保存しました！トミカ登録時に自動画像解析が利用可能になります。');
    } else {
      localStorage.removeItem('gemini-api-key');
      if (serverGeminiApiKey) {
        alert('ローカルのAPIキーを削除しました。今後はサーバー（Vercel）の設定が適用されます。');
      } else {
        alert('APIキーを削除しました。自動入力機能は無効化されます。');
      }
    }
    settingsDialog.close();
  });
}


// --- アプリケーション起動 ---
async function startApp() {
  try {
    initTheme();
    setupEventListeners();
    
    // 1. Firebaseのリアルタイム同期を開始
    subscribeToTomicas();
    
    // 2. 旧ローカルデータがある場合、クラウドへの自動移行を実行
    await migrateLocalDataToCloud();
    
  } catch (error) {
    console.error(error);
    alert('初期化中にエラーが発生しました。インターネット接続やブラウザのCookie設定をご確認ください。');
  }
}

// ドキュメント読み込み完了時に起動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
