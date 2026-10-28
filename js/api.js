/* Firestore API（全画面共通） */

var DEFAULT_CLUB_NAME = '運動教室';
var DEFAULT_COACH_TITLE = 'コーチ';

function normalizeCoachTitle(title) {
  return String(title || '').trim() || DEFAULT_COACH_TITLE;
}

function parseAppSettings(data) {
  const raw = data || {};
  return {
    clubName: String(raw.clubName || '').trim() || DEFAULT_CLUB_NAME,
    coachTitle: normalizeCoachTitle(raw.coachTitle)
  };
}

/** 教室名・指導者呼称をリアルタイム購読 */
function subscribeAppSettings(callback) {
  return db.collection('settings').doc('general').onSnapshot((doc) => {
    const data = doc.exists ? (doc.data() || {}) : {};
    callback(parseAppSettings(data));
  }, (err) => {
    console.error(err);
    callback({ clubName: DEFAULT_CLUB_NAME, coachTitle: DEFAULT_COACH_TITLE });
  });
}

/** 後方互換: 教室名のみ受け取るコールバック用 */
function subscribeClubName(callback) {
  return subscribeAppSettings((settings) => callback(settings.clubName));
}

async function updateClubName(name) {
  const clubName = String(name || '').trim();
  if (!clubName) throw new Error('clubName is required');
  await db.collection('settings').doc('general').set({
    clubName: clubName,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/** 教室名＋指導者呼称を一括保存 */
async function updateAppSettings(settings) {
  const data = settings || {};
  const clubName = String(data.clubName || '').trim();
  const coachTitle = String(data.coachTitle || '').trim();
  if (!clubName) throw new Error('教室名を入力してください');
  if (!coachTitle) throw new Error('指導者の呼称を入力してください');
  await db.collection('settings').doc('general').set({
    clubName: clubName,
    coachTitle: coachTitle,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { clubName: clubName, coachTitle: coachTitle };
}

function buildScheduleDoc(dateStr, payload) {
  const data = payload || {};
  return {
    date: dateStr,
    status: data.status || '通常練習',
    announcementTitle: data.announcementTitle || '',
    description: data.description || '',
    itemsToBring: data.itemsToBring || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

async function saveSchedule(dateStr, payload) {
  const key = normalizeDateKey(dateStr);
  await db.collection('schedules').doc(key).set(buildScheduleDoc(key, payload));
}

async function batchCopySchedule(dates, payload) {
  const batch = db.batch();
  (dates || []).forEach((date) => {
    const key = normalizeDateKey(date);
    if (!key) return;
    batch.set(db.collection('schedules').doc(key), buildScheduleDoc(key, payload), { merge: true });
  });
  await batch.commit();
}

async function saveAttendance(payload) {
  const data = payload || {};
  const name = data.name || '';
  const normalizedName = data.normalizedName || normalizeName(name);
  const dateStr = normalizeDateKey(data.date);
  if (!normalizedName || !dateStr) throw new Error('name and date are required');

  const note = String(data.note || '');
  const docId = `${normalizedName}_${dateStr}`;
  const docRef = db.collection('attendance').doc(docId);

  let isReadByCoach = false;
  let readByCoachAt = null;
  try {
    const existing = await docRef.get();
    if (existing.exists) {
      const prev = existing.data() || {};
      const prevNote = String(prev.note || '');
      // 連絡事項が同じ内容のままなら確認状態を維持／書き換え・新規なら未確認にリセット
      if (note && prevNote === note) {
        isReadByCoach = !!prev.isReadByCoach;
        readByCoachAt = prev.readByCoachAt || null;
      } else {
        isReadByCoach = false;
        readByCoachAt = null;
      }
    }
  } catch (err) {
    console.warn('saveAttendance: failed to read previous attendance', err);
  }

  await docRef.set({
    name: name,
    normalizedName: normalizedName,
    date: dateStr,
    status: data.status || '',
    note: note,
    source: data.source || '',
    isReadByCoach: isReadByCoach,
    readByCoachAt: readByCoachAt,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * 連絡事項の指導者確認フラグを更新
 * @param {string} docId - attendance ドキュメントID
 * @param {boolean} checked - true=確認済 / false=未確認に戻す
 */
async function setAttendanceNoteReadByCoach(docId, checked) {
  const id = String(docId || '').trim();
  if (!id) throw new Error('docId is required');
  const isChecked = !!checked;
  await db.collection('attendance').doc(id).set({
    isReadByCoach: isChecked,
    readByCoachAt: isChecked
      ? firebase.firestore.FieldValue.serverTimestamp()
      : null,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function deleteAttendance(docId) {
  if (!docId) throw new Error('docId is required');
  await db.collection('attendance').doc(docId).delete();
}

function studentDocIdCandidates(normalizedName, preferredDocId) {
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    const key = String(id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    ids.push(key);
  };
  push(preferredDocId);
  push(typeof toStudentDocId === 'function' ? toStudentDocId(normalizedName) : normalizedName);
  push(normalizedName);
  return ids;
}

/**
 * 生徒情報の追加（ふりがな対応・安全なドキュメントID）
 */
async function addStudentMaster(name, kana = '') {
  const trimmedName = String(name || '').trim();
  const trimmedKana = String(kana || '').trim();
  const normalizedName = normalizeName(trimmedName);
  if (!normalizedName) throw new Error('生徒名を入力してください');

  const docId = (typeof toStudentDocId === 'function' ? toStudentDocId(normalizedName) : normalizedName) || normalizedName;
  const docRef = db.collection('students').doc(docId);
  await docRef.set({
    name: trimmedName,
    kana: trimmedKana,
    normalizedName: normalizedName,
    normalizedKana: typeof normalizeKana === 'function' ? normalizeKana(trimmedKana) : trimmedKana,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    name: trimmedName,
    kana: trimmedKana,
    normalizedName: normalizedName,
    normalizedKana: typeof normalizeKana === 'function' ? normalizeKana(trimmedKana) : trimmedKana,
    docId: docId
  };
}

/**
 * 生徒情報の更新・編集（名前変更時は旧ドキュメントの削除＋新規作成）
 */
async function updateStudentMaster(oldNormalizedName, newName, newKana = '') {
  const trimmedNewName = String(newName || '').trim();
  const trimmedNewKana = String(newKana || '').trim();
  const newNormalizedName = normalizeName(trimmedNewName);
  if (!newNormalizedName) throw new Error('生徒名を入力してください');

  const oldNorm = String(oldNormalizedName || '').trim();
  const newDocId = (typeof toStudentDocId === 'function' ? toStudentDocId(newNormalizedName) : newNormalizedName) || newNormalizedName;
  const oldCandidates = studentDocIdCandidates(oldNorm);

  const batch = db.batch();
  if (oldNorm && oldNorm !== newNormalizedName) {
    oldCandidates.forEach(oldId => {
      if (oldId && oldId !== newDocId) batch.delete(db.collection('students').doc(oldId));
    });
  }

  batch.set(db.collection('students').doc(newDocId), {
    name: trimmedNewName,
    kana: trimmedNewKana,
    normalizedName: newNormalizedName,
    normalizedKana: typeof normalizeKana === 'function' ? normalizeKana(trimmedNewKana) : trimmedNewKana,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await batch.commit();
  return {
    name: trimmedNewName,
    kana: trimmedNewKana,
    normalizedName: newNormalizedName,
    normalizedKana: typeof normalizeKana === 'function' ? normalizeKana(trimmedNewKana) : trimmedNewKana,
    docId: newDocId
  };
}

/**
 * 過去の出欠履歴（attendance）を全走査し、名簿（students）に未登録の名前を一括インポート
 */
async function syncStudentsFromAttendanceHistory() {
  const [attSnap, stuSnap] = await Promise.all([
    db.collection('attendance').get(),
    db.collection('students').get()
  ]);

  const existingNormalized = new Set();
  stuSnap.forEach(doc => {
    const data = doc.data() || {};
    const norm = data.normalizedName || normalizeName(data.name) || doc.id;
    if (norm) {
      existingNormalized.add(norm);
      existingNormalized.add(doc.id);
      if (typeof toStudentDocId === 'function') existingNormalized.add(toStudentDocId(norm));
    }
  });

  const missingMap = new Map();
  attSnap.forEach(doc => {
    const item = doc.data() || {};
    const rawName = String(item.name || '').trim();
    const norm = item.normalizedName || normalizeName(rawName);
    if (!rawName || !norm || rawName === '【練習予定】') return;
    const safeId = typeof toStudentDocId === 'function' ? toStudentDocId(norm) : norm;
    if (existingNormalized.has(norm) || (safeId && existingNormalized.has(safeId))) return;
    if (!missingMap.has(norm)) missingMap.set(norm, rawName);
  });

  if (missingMap.size === 0) return 0;

  const entries = Array.from(missingMap.entries());
  const chunkSize = 400;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const batch = db.batch();
    entries.slice(i, i + chunkSize).forEach(([norm, rawName]) => {
      const docId = (typeof toStudentDocId === 'function' ? toStudentDocId(norm) : norm) || norm;
      batch.set(db.collection('students').doc(docId), {
        name: rawName,
        kana: '',
        normalizedName: norm,
        normalizedKana: '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();
  }
  return missingMap.size;
}

async function deleteStudentMaster(studentOrNormalizedName) {
  let preferredDocId = '';
  let norm = '';
  if (studentOrNormalizedName && typeof studentOrNormalizedName === 'object') {
    norm = studentOrNormalizedName.normalizedName || normalizeName(studentOrNormalizedName.name);
    preferredDocId = studentOrNormalizedName.docId || '';
  } else {
    norm = normalizeName(studentOrNormalizedName);
  }
  const candidates = studentDocIdCandidates(norm, preferredDocId);
  if (candidates.length === 0) throw new Error('normalizedName is required');
  await Promise.all(candidates.map(id => db.collection('students').doc(id).delete().catch(() => null)));
}
