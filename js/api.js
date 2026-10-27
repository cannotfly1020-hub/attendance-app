/* Firestore API（全画面共通） */

var DEFAULT_CLUB_NAME = '運動教室';

function subscribeClubName(callback) {
  return db.collection('settings').doc('general').onSnapshot((doc) => {
    const data = doc.exists ? (doc.data() || {}) : {};
    const clubName = String(data.clubName || '').trim() || DEFAULT_CLUB_NAME;
    callback(clubName);
  }, (err) => {
    console.error(err);
    callback(DEFAULT_CLUB_NAME);
  });
}

async function updateClubName(name) {
  const clubName = String(name || '').trim();
  if (!clubName) throw new Error('clubName is required');
  await db.collection('settings').doc('general').set({
    clubName: clubName,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
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
  await db.collection('attendance').doc(`${normalizedName}_${dateStr}`).set({
    name: name,
    normalizedName: normalizedName,
    date: dateStr,
    status: data.status || '',
    note: data.note || '',
    source: data.source || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function deleteAttendance(docId) {
  if (!docId) throw new Error('docId is required');
  await db.collection('attendance').doc(docId).delete();
}

async function addStudentMaster(name, kana) {
  const trimmed = String(name || '').trim();
  const trimmedKana = String(kana || '').trim();
  const normalizedName = normalizeName(trimmed);
  if (!trimmed || !normalizedName) throw new Error('name is required');
  const payload = {
    name: trimmed,
    kana: trimmedKana,
    normalizedName: normalizedName,
    normalizedKana: normalizeKana(trimmedKana),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('students').doc(normalizedName).set(payload);
  return {
    name: trimmed,
    kana: trimmedKana,
    normalizedName: normalizedName,
    normalizedKana: payload.normalizedKana
  };
}

async function deleteStudentMaster(normalizedName) {
  const key = normalizeName(normalizedName);
  if (!key) throw new Error('normalizedName is required');
  await db.collection('students').doc(key).delete();
}
