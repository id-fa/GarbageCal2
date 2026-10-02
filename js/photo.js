// カレンダーの代わりに表示する写真。端末内のファイルは場所を覚えておいても後から開けないので、
// 選ばれた画像を縮小し、中身ごとこのブラウザの IndexedDB に保存する。
// 設定（localStorage）とは別の保存先で、エクスポートや設定付きURLには含まれない。

const DB_NAME = 'sgcal';
const STORE = 'photos';
const KEY = 'calendar';
// 保存する画像の長辺の上限（px）。タブレットの画面には十分で、数MBの写真も数百KBに収まる
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ストアへの操作を1つ実行し、その結果を返す
async function runInStore(mode, operate) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operate(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// 保存してある写真（Blob）。無いとき・IndexedDB が使えない環境では null
export async function loadPhoto() {
  try {
    const blob = await runInStore('readonly', (store) => store.get(KEY));
    return blob instanceof Blob ? blob : null;
  } catch {
    return null;
  }
}

// 写真を保存する。null を渡すと削除する。保存できなければ false
export async function storePhoto(blob) {
  try {
    await runInStore('readwrite', (store) => (blob ? store.put(blob, KEY) : store.delete(KEY)));
    // 端末の空き容量が減ってもブラウザに消されにくくする（認められるかはブラウザ次第）
    if (blob) navigator.storage?.persist?.()?.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// 選ばれた画像ファイルを、保存用に縮小した JPEG にする。画像として読めなければ例外を投げる。
export async function preparePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    // img 経由で読むと、スマホの写真の向き（EXIF）が反映された状態で描ける
    const img = new Image();
    img.src = url;
    await img.decode();

    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const context = canvas.getContext('2d');
    // 透過のある画像は JPEG にすると透明部分が黒くなるので、白を敷いておく
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('画像を変換できませんでした');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
