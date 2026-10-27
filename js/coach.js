const CLUB_NAME = "運動教室"; // 教室名・クラブ名（未設定時の初期値）
const COACH_TITLE = "コーチ"; // 指導者の呼び名（「コーチ」「指導者」「リーダー」「先生」等）
const DEFAULT_ANNOUNCEMENT_TITLE = `${COACH_TITLE}からのおしらせ`;
let activeClubName = CLUB_NAME;
document.title = `【${COACH_TITLE}専用】出欠＆練習予定ダッシュボード`;
document.getElementById('coachClubName').textContent = CLUB_NAME;
document.getElementById('coachPortalTitle').textContent = `【${COACH_TITLE}専用】出欠＆練習予定ダッシュボード`;

let attendanceMap = {};
let schedulesMap = {};
let studentsMap = {};
let studentsReady = false;
const ROSTER_SEED_KEY = 'sports_app_students_seeded';
let currentScheduleStatus = '通常練習';
let manualSelectedStatus = '出席';
let scheduleFormDirty = false;

function timestampText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const date = value.toDate ? value.toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateClubNameDisplay(name) {
  const next = String(name || '').trim() || CLUB_NAME;
  activeClubName = next;
  document.getElementById('coachClubName').textContent = next;
  const input = document.getElementById('clubNameInput');
  if (input && document.activeElement !== input) input.value = next;
}

function openClubNameModal() {
  document.getElementById('clubNameInput').value = activeClubName;
  const modal = document.getElementById('clubNameModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('clubNameInput').focus();
}

function closeClubNameModal() {
  const modal = document.getElementById('clubNameModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function startLiveSync() {
  subscribeClubName(updateClubNameDisplay);

  db.collection('schedules').onSnapshot((snap) => {
    const next = {};
    snap.forEach(doc => {
      const item = doc.data() || {};
      const date = normalizeDateKey(item.date || doc.id);
      if (!date) return;
      next[date] = {
        date: date,
        status: item.status || '通常練習',
        description: item.description || '',
        itemsToBring: String(item.itemsToBring || '').trim(),
        announcementTitle: String(item.announcementTitle || '').trim()
      };
    });
    schedulesMap = next;
    renderDashboard();
  }, (err) => {
    console.error(err);
    showToast('予定を読み込めませんでした。通信環境を確認してください。', true);
  });

  db.collection('attendance').onSnapshot((snap) => {
    const next = {};
    snap.forEach(doc => {
      const item = doc.data() || {};
      if (!item.name) return;
      const date = normalizeDateKey(item.date);
      next[doc.id] = {
        ...item,
        docId: doc.id,
        date: date,
        updatedAt: timestampText(item.updatedAt)
      };
    });
    attendanceMap = next;
    renderDashboard();
  }, (err) => {
    console.error(err);
    showToast('出欠を読み込めませんでした。通信環境を確認してください。', true);
  });

  db.collection('students').onSnapshot((snap) => {
    const next = {};
    snap.forEach(doc => {
      const item = doc.data() || {};
      const normalizedName = item.normalizedName || doc.id;
      if (!item.name || !normalizedName) return;
      next[normalizedName] = {
        name: item.name,
        normalizedName: normalizedName
      };
    });
    studentsMap = next;
    studentsReady = true;
    populateDatalist();
    renderRoster();
  }, (err) => {
    console.error(err);
    showToast('名簿を読み込めませんでした。通信環境を確認してください。', true);
  });
}

function populateDatalist() {
  const dl = document.getElementById('allStudentNames');
  dl.innerHTML = '';
  Object.values(studentsMap)
    .map(student => student.name)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      dl.appendChild(opt);
    });
}

function renderRoster() {
  const list = document.getElementById('rosterList');
  const students = Object.values(studentsMap).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  document.getElementById('rosterCountLabel').textContent = `生徒名簿の管理（現在 ${students.length}名登録中）`;
  list.innerHTML = '';
  if (students.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-slate-400 text-center py-6';
    empty.textContent = '登録されている生徒はいません';
    list.appendChild(empty);
    return;
  }
  students.forEach(student => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 py-2.5 border-b border-slate-100';
    const name = document.createElement('span');
    name.className = 'text-sm font-bold text-slate-800 break-words min-w-0';
    name.textContent = student.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'shrink-0 text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg active:scale-95 transition';
    del.textContent = '削除（退会）';
    del.addEventListener('click', () => deleteStudent(student));
    row.append(name, del);
    list.appendChild(row);
  });
}

async function addStudent(name) {
  const trimmed = (name || '').trim();
  const normalizedName = normalizeName(trimmed);
  if (!trimmed || !normalizedName) {
    showToast('生徒名を入力してください。', true);
    return;
  }
  if (studentsMap[normalizedName]) {
    showToast('すでに名簿に登録されています。', true);
    return false;
  }
  await addStudentMaster(trimmed);
  showToast(`${trimmed} さんを名簿に追加しました`);
  return true;
}

async function deleteStudent(student) {
  const ok = confirm(`${student.name}さんを名簿から削除（退会）しますか？`);
  if (!ok) return;
  try {
    await deleteStudentMaster(student.normalizedName);
    showToast(`${student.name}さんを名簿から削除しました`);
  } catch (err) {
    console.error(err);
    showToast('名簿の削除に失敗しました。通信環境を確認してください。', true);
  }
}

async function seedStudentsFromAttendance() {
  if (!studentsReady || localStorage.getItem(ROSTER_SEED_KEY) === '1') return;
  if (Object.keys(studentsMap).length > 0) {
    localStorage.setItem(ROSTER_SEED_KEY, '1');
    return;
  }
  const seen = new Set();
  const batch = db.batch();
  let count = 0;
  Object.values(attendanceMap).forEach(item => {
    const name = (item && item.name ? item.name : '').trim();
    const normalizedName = (item && item.normalizedName) || normalizeName(name);
    if (!name || !normalizedName || name === '【練習予定】' || seen.has(normalizedName)) return;
    seen.add(normalizedName);
    batch.set(db.collection('students').doc(normalizedName), {
      name: name,
      normalizedName: normalizedName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    count += 1;
  });
  if (count > 0) await batch.commit();
  localStorage.setItem(ROSTER_SEED_KEY, '1');
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadAttendanceCsv() {
  const rows = Object.values(attendanceMap).sort((a, b) => {
    const byDate = String(a.date || '').localeCompare(String(b.date || ''));
    if (byDate !== 0) return byDate;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
  });
  if (rows.length === 0) {
    showToast('出力できる出欠データがありません。', true);
    return;
  }
  const lines = ['日付,生徒名,出欠,連絡事項,登録元,登録日時'];
  rows.forEach(item => {
    lines.push([
      item.date || '',
      item.name || '',
      item.status || '',
      item.note || '',
      item.source || '',
      item.updatedAt || ''
    ].map(csvCell).join(','));
  });
  const today = formatDate(new Date()).replace(/-/g, '');
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${activeClubName}_出欠集計_${today}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('出欠CSVをダウンロードしました！');
}

function updateScheduleUI() {
  const normalBtn = document.getElementById('schStatusNormalBtn');
  const offBtn = document.getElementById('schStatusOffBtn');
  const offBanner = document.getElementById('dayOffBanner');

  if (currentScheduleStatus === '休み') {
    offBtn.className = 'min-h-[44px] text-sm px-3 py-2 rounded-lg font-bold border bg-rose-600 text-white border-rose-700 shadow-sm';
    normalBtn.className = 'min-h-[44px] text-sm px-3 py-2 rounded-lg font-bold border bg-white text-slate-600 border-slate-300 hover:bg-slate-100';
    offBanner.classList.remove('hidden');
  } else {
    normalBtn.className = 'min-h-[44px] text-sm px-3 py-2 rounded-lg font-bold border bg-emerald-600 text-white border-emerald-700 shadow-sm';
    offBtn.className = 'min-h-[44px] text-sm px-3 py-2 rounded-lg font-bold border bg-white text-slate-600 border-slate-300 hover:bg-slate-100';
    offBanner.classList.add('hidden');
  }
}

let lastRenderedDate = '';

function countAttendanceForDate(dateStr) {
  let attend = 0;
  let absent = 0;
  Object.values(attendanceMap).forEach(item => {
    if (!item || item.date !== dateStr) return;
    if (item.status === '出席') attend += 1;
    else if (item.status === '欠席') absent += 1;
  });
  return { attend, absent };
}

function selectDashboardDate(dateStr) {
  const next = normalizeDateKey(dateStr);
  if (!next) return;
  const picker = document.getElementById('targetDatePicker');
  if (picker.value !== next) {
    picker.value = next;
  }
  renderDashboard();
}

function renderWeekSummary() {
  const strip = document.getElementById('weekSummaryStrip');
  if (!strip) return;

  const selectedDate = normalizeDateKey(document.getElementById('targetDatePicker').value);
  const todayStr = formatDate(new Date());
  strip.replaceChildren();

  for (let offset = 0; offset < 7; offset++) {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    const dateStr = formatDate(day);
    const weekday = day.getDay();
    const schedule = schedulesMap[dateStr];
    const isOff = schedule && schedule.status === '休み';
    const counts = countAttendanceForDate(dateStr);
    const selected = dateStr === selectedDate;
    const isToday = dateStr === todayStr;
    const hasItems = !!(schedule && String(schedule.itemsToBring || '').trim());
    const hasNotice = !!(schedule && String(schedule.description || '').trim());

    let dayColor = 'text-slate-800';
    if (weekday === 0) dayColor = 'text-rose-600';
    else if (weekday === 6) dayColor = 'text-blue-600';

    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('role', 'listitem');
    card.dataset.date = dateStr;
    card.className = [
      'week-day-card snap-start shrink-0 w-[5.75rem] min-h-[7.5rem] rounded-xl border px-2 py-2 text-left transition active:scale-95',
      'flex flex-col gap-1.5',
      selected
        ? 'ring-2 ring-slate-900 border-slate-900 shadow-md bg-white'
        : (isOff ? 'border-rose-200 bg-rose-50/70 hover:bg-rose-50' : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300')
    ].join(' ');

    const dateLine = document.createElement('div');
    dateLine.className = `text-[11px] font-black leading-tight ${dayColor}`;
    dateLine.textContent = `${day.getMonth() + 1}/${day.getDate()} (${getDayLabel(weekday)})`;
    card.appendChild(dateLine);

    if (isToday) {
      const todayBadge = document.createElement('span');
      todayBadge.className = 'inline-flex self-start text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-900 text-white';
      todayBadge.textContent = '今日';
      card.appendChild(todayBadge);
    }

    const status = document.createElement('div');
    status.className = `text-[11px] font-bold leading-snug ${isOff ? 'text-rose-700' : 'text-emerald-700'}`;
    status.textContent = isOff ? '🚫 休み' : '🟢 通常';
    card.appendChild(status);

    if (!isOff && (counts.attend > 0 || counts.absent > 0)) {
      const countLine = document.createElement('div');
      countLine.className = 'text-[10px] font-black text-slate-700 leading-snug';
      countLine.textContent = `⭕ ${counts.attend}名 / ❌ ${counts.absent}名`;
      card.appendChild(countLine);
    }

    if (hasItems || hasNotice) {
      const icons = document.createElement('div');
      icons.className = 'mt-auto flex items-center gap-1 text-sm leading-none';
      if (hasNotice) {
        const noticeIcon = document.createElement('span');
        noticeIcon.setAttribute('aria-label', '連絡事項あり');
        noticeIcon.textContent = '📢';
        icons.appendChild(noticeIcon);
      }
      if (hasItems) {
        const itemsIcon = document.createElement('span');
        itemsIcon.setAttribute('aria-label', '特別な持ち物あり');
        itemsIcon.textContent = '🎒';
        icons.appendChild(itemsIcon);
      }
      card.appendChild(icons);
    }

    card.addEventListener('click', () => selectDashboardDate(dateStr));
    strip.appendChild(card);
  }
}

function renderDashboard() {
  const selectedDate = document.getElementById('targetDatePicker').value;
  if (!selectedDate) return;

  if (selectedDate !== lastRenderedDate) {
    scheduleFormDirty = false;
    lastRenderedDate = selectedDate;
  }

  if (!scheduleFormDirty) {
    const schedule = schedulesMap[selectedDate];
    if (schedule) {
      currentScheduleStatus = schedule.status;
      document.getElementById('schDescInput').value = schedule.description || '';
      document.getElementById('schItemsInput').value = schedule.itemsToBring || '';
      document.getElementById('schAnnounceInput').value = schedule.announcementTitle || DEFAULT_ANNOUNCEMENT_TITLE;
    } else {
      currentScheduleStatus = '通常練習';
      document.getElementById('schDescInput').value = '';
      document.getElementById('schItemsInput').value = '';
      document.getElementById('schAnnounceInput').value = DEFAULT_ANNOUNCEMENT_TITLE;
    }
  }
  updateScheduleUI();

  const attendListEl = document.getElementById('attendList');
  const absentListEl = document.getElementById('absentList');
  let attends = [];
  let absents = [];

  Object.values(attendanceMap).forEach(item => {
    if (item && item.date === selectedDate) {
      if (item.status === '出席') attends.push(item);
      else if (item.status === '欠席') absents.push(item);
    }
  });

  document.getElementById('attendCount').textContent = attends.length;
  document.getElementById('absentCount').textContent = absents.length;
  document.getElementById('totalCount').textContent = attends.length + absents.length;
  document.getElementById('attendHeaderBadge').textContent = `${attends.length}名`;
  document.getElementById('absentHeaderBadge').textContent = `${absents.length}名`;

  if (attends.length === 0) {
    attendListEl.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs">出席の回答はありません</div>';
  } else {
    attendListEl.innerHTML = '';
    attends.forEach(item => attendListEl.appendChild(createMemberCard(item)));
  }

  if (absents.length === 0) {
    absentListEl.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs">欠席の連絡はありません</div>';
  } else {
    absentListEl.innerHTML = '';
    absents.forEach(item => absentListEl.appendChild(createMemberCard(item)));
  }

  renderWeekSummary();
}

function createMemberCard(item) {
  const el = document.createElement('div');
  el.className = 'py-2.5 px-2 flex flex-col gap-1 hover:bg-slate-50 transition rounded-lg';

  let sourceLabel = '';
  if (item.source === 'parent') {
    sourceLabel = '<span class="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-bold">保護者</span>';
  } else if (item.source === 'student') {
    sourceLabel = '<span class="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold">本人</span>';
  } else if (item.source === 'coach') {
    sourceLabel = `<span class="text-[10px] bg-slate-100 text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded font-bold">${COACH_TITLE}</span>`;
  }

  const noteBlock = item.note 
    ? `<div class="text-xs bg-amber-50 text-amber-900 border border-amber-200 px-2 py-1 rounded mt-1 font-medium">💬 ${item.note}</div>`
    : '';

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-1 min-w-0">
      <div class="flex flex-wrap items-center gap-1.5 min-w-0">
        <span class="text-sm font-bold text-slate-800 break-words">${item.name}</span>
        ${sourceLabel}
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <span class="text-[10px] text-slate-400">${item.updatedAt ? item.updatedAt.slice(11, 16) : ''}</span>
      </div>
    </div>
    ${noteBlock}
  `;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-attendance-btn text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition active:scale-95';
  deleteBtn.setAttribute('aria-label', `${item.name}さんの出欠を削除`);
  deleteBtn.textContent = '🗑️';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    handleDeleteAttendanceItem(item, deleteBtn);
  });
  el.querySelector('.shrink-0').appendChild(deleteBtn);
  return el;
}

async function handleDeleteAttendanceItem(item, button) {
  const name = item.name || '';
  const ok = confirm(`「${name}」さんのこの日の出欠登録を削除しますか？`);
  if (!ok) return;

  const docId = item.docId || `${item.normalizedName || normalizeName(name)}_${normalizeDateKey(item.date)}`;
  button.disabled = true;
  try {
    await deleteAttendance(docId);
    showToast(`「${name}」さんの登録を削除しました`);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    showToast('削除に失敗しました。通信環境を確認してください。', true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('openClubNameBtn').addEventListener('click', openClubNameModal);
  document.getElementById('closeClubNameBtn').addEventListener('click', closeClubNameModal);
  document.getElementById('clubNameModal').addEventListener('click', (event) => {
    if (event.target.id === 'clubNameModal') closeClubNameModal();
  });
  document.getElementById('saveClubNameBtn').addEventListener('click', async () => {
    const val = document.getElementById('clubNameInput').value.trim();
    if (!val) {
      showToast('教室名を入力してください。', true);
      return;
    }
    const button = document.getElementById('saveClubNameBtn');
    button.disabled = true;
    try {
      await updateClubName(val);
      showToast('教室名を更新しました！');
      closeClubNameModal();
    } catch (err) {
      console.error(err);
      showToast('教室名の保存に失敗しました。通信環境を確認してください。', true);
    } finally {
      button.disabled = false;
    }
  });

  const announceList = document.getElementById('announceSuggestions');
  [DEFAULT_ANNOUNCEMENT_TITLE, '指導者より', '保護者会より', '当番より', '緊急連絡'].forEach(label => {
    const option = document.createElement('option');
    option.value = label;
    announceList.appendChild(option);
  });

  const picker = document.getElementById('targetDatePicker');
  picker.value = formatDate(new Date());

  picker.addEventListener('change', renderDashboard);

  document.getElementById('setTodayBtn').addEventListener('click', () => {
    picker.value = formatDate(new Date());
    renderDashboard();
  });

  document.getElementById('setTomorrowBtn').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    picker.value = formatDate(d);
    renderDashboard();
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.classList.add('opacity-50');
    renderDashboard();
    setTimeout(() => refreshBtn.classList.remove('opacity-50'), 200);
  });

  document.getElementById('schAnnounceInput').addEventListener('input', () => {
    scheduleFormDirty = true;
  });

  document.getElementById('schDescInput').addEventListener('input', () => {
    scheduleFormDirty = true;
  });

  document.getElementById('schItemsInput').addEventListener('input', () => {
    scheduleFormDirty = true;
  });

  document.getElementById('schStatusNormalBtn').addEventListener('click', () => {
    currentScheduleStatus = '通常練習';
    scheduleFormDirty = true;
    updateScheduleUI();
  });

  document.getElementById('schStatusOffBtn').addEventListener('click', () => {
    currentScheduleStatus = '休み';
    scheduleFormDirty = true;
    updateScheduleUI();
  });

  function addDays(dateStr, days) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function closeCopyMenu() {
    document.getElementById('copyScheduleMenu').classList.add('hidden');
  }

  function askCopyConfirm(message) {
    return new Promise(resolve => {
      const modal = document.getElementById('copyConfirmModal');
      document.getElementById('copyConfirmText').textContent = message;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      const okBtn = document.getElementById('copyConfirmOk');
      const cancelBtn = document.getElementById('copyConfirmCancel');
      const finish = (value) => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        resolve(value);
      };
      okBtn.onclick = () => finish(true);
      cancelBtn.onclick = () => finish(false);
    });
  }

  document.getElementById('copyScheduleBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    document.getElementById('copyScheduleMenu').classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#copyScheduleMenu') && event.target.id !== 'copyScheduleBtn') {
      closeCopyMenu();
    }
  });

  document.querySelectorAll('.copy-option').forEach(option => {
    option.addEventListener('click', async () => {
      const sourceDate = picker.value;
      if (!sourceDate) return;
      const desc = document.getElementById('schDescInput').value.trim();
      const items = document.getElementById('schItemsInput').value.trim();
      const announcementTitle = document.getElementById('schAnnounceInput').value.trim() || DEFAULT_ANNOUNCEMENT_TITLE;
      const status = currentScheduleStatus;
      const isNextWeek = option.dataset.copy === 'next-week';
      const targets = isNextWeek
        ? [addDays(sourceDate, 7)]
        : Array.from({ length: 7 }, (_, i) => addDays(sourceDate, i));
      const message = isNextWeek
        ? `${sourceDate} の設定を、来週の ${targets[0]} にコピーして保存しますか？`
        : `${sourceDate} の設定を、向こう7日間（${targets[0]}〜${targets[targets.length - 1]}）すべてにコピーして保存しますか？`;
      closeCopyMenu();
      const ok = await askCopyConfirm(message);
      if (!ok) return;

      const btn = document.getElementById('copyScheduleBtn');
      btn.disabled = true;
      btn.textContent = 'コピー保存中...';
      try {
        await batchCopySchedule(targets, {
          status: status,
          description: desc,
          itemsToBring: items,
          announcementTitle: announcementTitle
        });
        showToast(isNextWeek ? '来週同曜日の予定をコピーしました！' : '向こう7日間の予定を一括コピーしました！');
      } catch (err) {
        console.error(err);
        showToast('コピーに失敗しました。通信環境を確認してください。', true);
      } finally {
        btn.disabled = false;
        btn.textContent = '📋 予定をコピー';
      }
    });
  });

  // 予定保存
  document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
    const date = picker.value;
    const desc = document.getElementById('schDescInput').value.trim();
    const items = document.getElementById('schItemsInput').value.trim();
    const announcementTitle = document.getElementById('schAnnounceInput').value.trim() || DEFAULT_ANNOUNCEMENT_TITLE;
    const btn = document.getElementById('saveScheduleBtn');

    btn.disabled = true;
    btn.innerText = '保存中...';

    try {
      await saveSchedule(date, {
        status: currentScheduleStatus,
        description: desc,
        itemsToBring: items,
        announcementTitle: announcementTitle
      });
      scheduleFormDirty = false;
      showToast(`${date} の練習予定を保存しました！`);
    } catch (err) {
      console.error(err);
      showToast('予定の保存に失敗しました。通信環境を確認してください。', true);
    } finally {
      btn.disabled = false;
      btn.innerText = '予定を保存';
    }
  });

  document.getElementById('exportCsvBtn').addEventListener('click', downloadAttendanceCsv);

  const rosterModal = document.getElementById('rosterModal');
  const openRoster = async () => {
    rosterModal.classList.remove('hidden');
    rosterModal.classList.add('flex');
    const started = Date.now();
    while (!studentsReady && Date.now() - started < 8000) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    try {
      await seedStudentsFromAttendance();
    } catch (err) {
      console.error(err);
      showToast('過去の出欠から名簿を取り込めませんでした。', true);
    }
    renderRoster();
    document.getElementById('rosterNameInput').focus();
  };
  const closeRoster = () => {
    rosterModal.classList.add('hidden');
    rosterModal.classList.remove('flex');
  };
  document.getElementById('openRosterBtn').addEventListener('click', openRoster);
  document.getElementById('closeRosterBtn').addEventListener('click', closeRoster);

  document.getElementById('addStudentBtn').addEventListener('click', async () => {
    const input = document.getElementById('rosterNameInput');
    const btn = document.getElementById('addStudentBtn');
    btn.disabled = true;
    btn.textContent = '追加中...';
    try {
      const added = await addStudent(input.value);
      if (added) input.value = '';
    } catch (err) {
      console.error(err);
      showToast('名簿への追加に失敗しました。通信環境を確認してください。', true);
    } finally {
      btn.disabled = false;
      btn.textContent = '追加';
    }
  });

  document.getElementById('rosterNameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('addStudentBtn').click();
  });

  // 代理モーダル
  const manualModal = document.getElementById('manualModal');
  document.getElementById('openManualModalBtn').addEventListener('click', () => {
    manualModal.classList.remove('hidden');
  });
  document.getElementById('closeManualModalBtn').addEventListener('click', () => {
    manualModal.classList.add('hidden');
  });

  document.querySelectorAll('.manual-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      manualSelectedStatus = btn.dataset.val;
      document.querySelectorAll('.manual-status-btn').forEach(b => {
        b.classList.toggle('ring-2', b.dataset.val === manualSelectedStatus);
      });
    });
  });

  document.getElementById('submitManualBtn').addEventListener('click', async () => {
    const name = document.getElementById('manualNameInput').value.trim();
    const note = document.getElementById('manualNoteInput').value.trim();
    const date = picker.value;
    const btn = document.getElementById('submitManualBtn');

    if (!name) return showToast('生徒名を入力してください。', true);

    btn.disabled = true;
    btn.innerText = '登録中...';

    try {
      await saveAttendance({
        name: name,
        date: date,
        status: manualSelectedStatus,
        note: note,
        source: 'coach'
      });
      manualModal.classList.add('hidden');
      document.getElementById('manualNameInput').value = '';
      document.getElementById('manualNoteInput').value = '';
      showToast(`${name} さんの出欠を保存しました！`);
    } catch (err) {
      console.error(err);
      showToast('登録に失敗しました。通信環境を確認してください。', true);
    } finally {
      btn.disabled = false;
      btn.innerText = '保存して反映';
    }
  });

  startLiveSync();
});
