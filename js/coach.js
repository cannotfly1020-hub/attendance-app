const CLUB_NAME = "運動教室"; // 教室名・クラブ名（未設定時の初期値）
const COACH_TITLE = "コーチ"; // 指導者の呼び名（未設定時の初期値）
let activeClubName = CLUB_NAME;
let activeCoachTitle = COACH_TITLE;

function getDefaultAnnouncementTitle() {
  return `${activeCoachTitle}からのおしらせ`;
}

function isDefaultAnnouncementTitle(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (t === getDefaultAnnouncementTitle()) return true;
  return ['コーチ', '指導者', '先生', 'リーダー', '代表', '監督'].some(role => t === `${role}からのおしらせ`);
}

document.title = `【${activeCoachTitle}専用】出欠＆練習予定ダッシュボード`;
document.getElementById('coachClubName').textContent = CLUB_NAME;
document.getElementById('coachPortalTitle').textContent = '出欠＆練習予定ダッシュボード';

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

function refreshAnnounceSuggestions() {
  const announceList = document.getElementById('announceSuggestions');
  if (!announceList) return;
  announceList.innerHTML = '';
  [getDefaultAnnouncementTitle(), '指導者より', '保護者会より', '当番より', '緊急連絡'].forEach(label => {
    const option = document.createElement('option');
    option.value = label;
    announceList.appendChild(option);
  });
}

function updateAppSettingsDisplay(settings) {
  const nextClub = String((settings && settings.clubName) || '').trim() || CLUB_NAME;
  const nextTitle = String((settings && settings.coachTitle) || '').trim() || COACH_TITLE;
  const titleChanged = nextTitle !== activeCoachTitle;

  activeClubName = nextClub;
  activeCoachTitle = nextTitle;

  document.getElementById('coachClubName').textContent = nextClub;
  document.title = `【${nextTitle}専用】出欠＆練習予定ダッシュボード`;

  const clubInput = document.getElementById('clubNameInput');
  if (clubInput && document.activeElement !== clubInput) clubInput.value = nextClub;
  const titleInput = document.getElementById('coachTitleInput');
  if (titleInput && document.activeElement !== titleInput) titleInput.value = nextTitle;

  refreshAnnounceSuggestions();

  const announceInput = document.getElementById('schAnnounceInput');
  if (announceInput && document.activeElement !== announceInput) {
    const current = String(announceInput.value || '').trim();
    if (!current || isDefaultAnnouncementTitle(current)) {
      announceInput.value = getDefaultAnnouncementTitle();
    }
  }

  if (titleChanged) renderDashboard();
}

function openClubNameModal() {
  document.getElementById('clubNameInput').value = activeClubName;
  document.getElementById('coachTitleInput').value = activeCoachTitle;
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
  subscribeAppSettings(updateAppSettingsDisplay);

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
      if (!item.name) return;
      // 旧データは doc.id が生の氏名正規化値の場合もある
      const normalizedName = item.normalizedName || normalizeName(item.name) || doc.id;
      if (!normalizedName) return;
      const kana = item.kana || '';
      next[normalizedName] = {
        name: item.name,
        kana: kana,
        normalizedName: normalizedName,
        normalizedKana: item.normalizedKana || normalizeKana(kana),
        docId: doc.id
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
  if (!list) return;

  const students = Object.values(studentsMap).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const countLabel = document.getElementById('rosterCountLabel');
  if (countLabel) {
    countLabel.textContent = `生徒名簿の管理（現在 ${students.length}名登録中）`;
  }
  list.innerHTML = '';

  if (students.length === 0) {
    list.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">登録されている生徒はいません</p>';
    return;
  }

  students.forEach(student => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 py-2.5 border-b border-slate-100';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'min-w-0 flex-1';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'text-sm font-bold text-slate-800 break-words';
    nameSpan.textContent = student.name;

    const kanaSpan = document.createElement('div');
    kanaSpan.className = 'text-[11px] text-slate-400 font-normal';
    kanaSpan.textContent = student.kana ? `（${student.kana}）` : '※ふりがな未設定';

    infoDiv.append(nameSpan, kanaSpan);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex items-center gap-1 shrink-0';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg active:scale-95 transition';
    editBtn.textContent = '✏️ 編集';
    editBtn.addEventListener('click', () => openEditStudentModal(student));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg active:scale-95 transition';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => deleteStudent(student));

    btnGroup.append(editBtn, delBtn);
    row.append(infoDiv, btnGroup);
    list.appendChild(row);
  });
}

function findExactStudentByName(trimmedName) {
  const target = String(trimmedName || '').trim();
  if (!target) return null;
  return Object.values(studentsMap).find(student => student.name === target) || null;
}

async function addStudent(name, kana) {
  const trimmed = String(name || '').trim();
  const trimmedKana = String(kana || '').trim();
  if (!trimmed) {
    showToast('生徒名を入力してください', true);
    return false;
  }
  const normalizedName = normalizeName(trimmed);
  if (!normalizedName) {
    showToast('生徒名を入力してください（空白のみは登録できません）', true);
    return false;
  }
  if (findExactStudentByName(trimmed)) {
    showToast('すでに名簿に登録されています。', true);
    return false;
  }
  try {
    await addStudentMaster(trimmed, trimmedKana);
    showToast(`${trimmed} さんを名簿に追加しました`);
    return true;
  } catch (err) {
    console.error(err);
    showToast('名簿への追加に失敗しました: ' + (err.message || '通信エラー'), true);
    return false;
  }
}

function openEditStudentModal(student) {
  document.getElementById('editStudentOldNormalizedName').value = student.normalizedName || normalizeName(student.name);
  document.getElementById('editStudentNameInput').value = student.name || '';
  document.getElementById('editStudentKanaInput').value = student.kana || '';

  const modal = document.getElementById('editStudentModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => document.getElementById('editStudentNameInput').focus(), 0);
}

function closeEditStudentModal() {
  const modal = document.getElementById('editStudentModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function deleteStudent(student) {
  const ok = confirm(`${student.name}さんを名簿から削除（退会）しますか？`);
  if (!ok) return;
  try {
    await deleteStudentMaster(student);
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
  try {
    await syncStudentsFromAttendanceHistory();
  } catch (err) {
    console.error(err);
  }
  localStorage.setItem(ROSTER_SEED_KEY, '1');
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

const SUMMARY_DAY_COUNT = 30;
let lastSummaryScrollDate = '';

function selectDashboardDate(dateStr) {
  const next = normalizeDateKey(dateStr);
  if (!next) return;
  const picker = document.getElementById('targetDatePicker');
  if (picker.value !== next) {
    picker.value = next;
  }
  // 日付切替時は必ずサマリー側も追従スクロール
  lastSummaryScrollDate = '';
  renderDashboard();
}

function scrollSummaryToSelectedDate() {
  const strip = document.getElementById('weekSummaryStrip');
  if (!strip) return;
  const selectedDate = normalizeDateKey(document.getElementById('targetDatePicker').value);
  if (!selectedDate) return;
  if (selectedDate === lastSummaryScrollDate) return;
  lastSummaryScrollDate = selectedDate;
  const card = strip.querySelector(`.week-day-card[data-date="${selectedDate}"]`);
  if (!card) return;
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
}

function renderWeekSummary() {
  const strip = document.getElementById('weekSummaryStrip');
  if (!strip) return;

  const selectedDate = normalizeDateKey(document.getElementById('targetDatePicker').value);
  const todayStr = formatDate(new Date());
  strip.replaceChildren();

  for (let offset = 0; offset < SUMMARY_DAY_COUNT; offset++) {
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
    if (selected) card.setAttribute('aria-current', 'date');
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

  scrollSummaryToSelectedDate();
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
      document.getElementById('schAnnounceInput').value = schedule.announcementTitle || getDefaultAnnouncementTitle();
    } else {
      currentScheduleStatus = '通常練習';
      document.getElementById('schDescInput').value = '';
      document.getElementById('schItemsInput').value = '';
      document.getElementById('schAnnounceInput').value = getDefaultAnnouncementTitle();
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
    sourceLabel = `<span class="text-[10px] bg-slate-100 text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded font-bold">${activeCoachTitle}</span>`;
  }

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-1 min-w-0">
      <div class="flex flex-wrap items-center gap-1.5 min-w-0">
        <span class="text-sm font-bold text-slate-800 break-words"></span>
        ${sourceLabel}
      </div>
      <div class="flex items-center gap-0.5 shrink-0 card-actions">
        <span class="text-[10px] text-slate-400">${item.updatedAt ? item.updatedAt.slice(11, 16) : ''}</span>
      </div>
    </div>
  `;
  el.querySelector('.text-sm.font-bold').textContent = item.name || '';

  const noteText = String(item.note || '').trim();
  if (noteText) {
    const noteRow = document.createElement('div');
    noteRow.className = 'flex flex-wrap items-center gap-1.5 mt-0.5';

    const noteBlock = document.createElement('div');
    noteBlock.className = 'text-xs bg-amber-50 text-amber-900 border border-amber-200 px-2 py-1 rounded font-medium break-words min-w-0';
    noteBlock.textContent = `💬 ${noteText}`;

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    const isRead = !!item.isReadByCoach;
    if (isRead) {
      readBtn.className = 'shrink-0 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100 active:scale-95 transition';
      readBtn.textContent = '✅ 確認済';
      readBtn.setAttribute('aria-label', '確認を取り消す');
    } else {
      readBtn.className = 'shrink-0 text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200 active:scale-95 transition';
      readBtn.textContent = '👀 確認する';
      readBtn.setAttribute('aria-label', '連絡事項を確認済みにする');
    }
    readBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const docId = item.docId || `${item.normalizedName || normalizeName(item.name)}_${normalizeDateKey(item.date)}`;
      const nextChecked = !item.isReadByCoach;
      readBtn.disabled = true;
      try {
        await setAttendanceNoteReadByCoach(docId, nextChecked);
        showToast(nextChecked ? `${item.name}さんの連絡事項を確認しました` : '確認を取り消しました');
      } catch (err) {
        console.error(err);
        readBtn.disabled = false;
        showToast('確認状態の更新に失敗しました。通信環境を確認してください。', true);
      }
    });

    noteRow.append(noteBlock, readBtn);
    el.appendChild(noteRow);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-attendance-btn text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition active:scale-95';
  deleteBtn.setAttribute('aria-label', `${item.name}さんの出欠を削除`);
  deleteBtn.textContent = '🗑️';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    handleDeleteAttendanceItem(item, deleteBtn);
  });
  el.querySelector('.card-actions').appendChild(deleteBtn);
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
  const settingsMenu = document.getElementById('settingsDropdownMenu');
  const settingsBtn = document.getElementById('openSettingsMenuBtn');
  const closeSettingsMenu = () => {
    settingsMenu.classList.add('hidden');
    settingsBtn.setAttribute('aria-expanded', 'false');
  };
  const toggleSettingsMenu = () => {
    const open = settingsMenu.classList.toggle('hidden') === false;
    settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  settingsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSettingsMenu();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#settingsMenuWrap')) closeSettingsMenu();
  });

  document.getElementById('closeClubNameBtn').addEventListener('click', closeClubNameModal);
  document.getElementById('clubNameModal').addEventListener('click', (event) => {
    if (event.target.id === 'clubNameModal') closeClubNameModal();
  });
  document.getElementById('saveClubNameBtn').addEventListener('click', async () => {
    const clubVal = document.getElementById('clubNameInput').value.trim();
    const titleVal = document.getElementById('coachTitleInput').value.trim();
    if (!clubVal) {
      showToast('教室名を入力してください。', true);
      return;
    }
    if (!titleVal) {
      showToast('指導者の呼称を入力してください。', true);
      return;
    }
    const button = document.getElementById('saveClubNameBtn');
    button.disabled = true;
    try {
      await updateAppSettings({ clubName: clubVal, coachTitle: titleVal });
      showToast('教室名・呼称を更新しました！');
      closeClubNameModal();
    } catch (err) {
      console.error(err);
      showToast('設定の保存に失敗しました。通信環境を確認してください。', true);
    } finally {
      button.disabled = false;
    }
  });

  refreshAnnounceSuggestions();

  const picker = document.getElementById('targetDatePicker');
  picker.value = formatDate(new Date());

  picker.addEventListener('change', () => {
    lastSummaryScrollDate = '';
    renderDashboard();
  });

  document.getElementById('setTodayBtn').addEventListener('click', () => {
    lastSummaryScrollDate = '';
    picker.value = formatDate(new Date());
    renderDashboard();
  });

  document.getElementById('setTomorrowBtn').addEventListener('click', () => {
    lastSummaryScrollDate = '';
    const d = new Date();
    d.setDate(d.getDate() + 1);
    picker.value = formatDate(d);
    renderDashboard();
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
      const announcementTitle = document.getElementById('schAnnounceInput').value.trim() || getDefaultAnnouncementTitle();
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
    const announcementTitle = document.getElementById('schAnnounceInput').value.trim() || getDefaultAnnouncementTitle();
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

  const rosterModal = document.getElementById('rosterModal');
  const openRoster = async () => {
    closeSettingsMenu();
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
  document.getElementById('openRosterBtnFromMenu').addEventListener('click', openRoster);
  document.getElementById('openClubNameBtnFromMenu').addEventListener('click', () => {
    closeSettingsMenu();
    openClubNameModal();
  });
  document.getElementById('closeRosterBtn').addEventListener('click', closeRoster);

  document.getElementById('addStudentBtn').addEventListener('click', async () => {
    const input = document.getElementById('rosterNameInput');
    const kanaInput = document.getElementById('rosterKanaInput');
    const btn = document.getElementById('addStudentBtn');
    btn.disabled = true;
    btn.textContent = '追加中...';
    try {
      const added = await addStudent(input.value, kanaInput ? kanaInput.value : '');
      if (added) {
        input.value = '';
        if (kanaInput) kanaInput.value = '';
        input.focus();
      }
    } catch (err) {
      console.error(err);
      showToast('名簿への追加に失敗しました。通信環境を確認してください。', true);
    } finally {
      btn.disabled = false;
      btn.textContent = '追加';
    }
  });

  const submitRosterOnEnter = (event) => {
    if (event.key === 'Enter') document.getElementById('addStudentBtn').click();
  };
  document.getElementById('rosterNameInput').addEventListener('keydown', submitRosterOnEnter);
  document.getElementById('rosterKanaInput').addEventListener('keydown', submitRosterOnEnter);

  const forceSyncBtn = document.getElementById('forceSyncAttendanceStudentsBtn');
  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', async () => {
      forceSyncBtn.disabled = true;
      forceSyncBtn.innerHTML = '<span>🔄</span> 取り込み中...';
      try {
        // 過去フラグに依存せず、毎回 Firestore を全走査して強制取り込み
        localStorage.removeItem(ROSTER_SEED_KEY);
        const count = await syncStudentsFromAttendanceHistory();
        localStorage.setItem(ROSTER_SEED_KEY, '1');
        if (count > 0) {
          showToast(`${count}名の生徒を名簿に新しく取り込みました！`);
        } else {
          showToast('未登録の生徒はいませんでした（すべて名簿に存在します）');
        }
      } catch (err) {
        console.error(err);
        showToast('取り込み処理に失敗しました: ' + (err.message || '通信エラー'), true);
      } finally {
        forceSyncBtn.disabled = false;
        forceSyncBtn.innerHTML = '<span>🔄</span> 過去の出欠から生徒を取り込む';
      }
    });
  }

  document.getElementById('closeEditStudentModalBtn').addEventListener('click', closeEditStudentModal);
  document.getElementById('cancelEditStudentBtn').addEventListener('click', closeEditStudentModal);
  document.getElementById('editStudentModal').addEventListener('click', (event) => {
    if (event.target.id === 'editStudentModal') closeEditStudentModal();
  });
  document.getElementById('saveEditStudentBtn').addEventListener('click', async () => {
    const oldNorm = document.getElementById('editStudentOldNormalizedName').value;
    const newName = document.getElementById('editStudentNameInput').value.trim();
    const newKana = document.getElementById('editStudentKanaInput').value.trim();
    const btn = document.getElementById('saveEditStudentBtn');

    if (!newName) {
      showToast('生徒名を入力してください', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await updateStudentMaster(oldNorm, newName, newKana);
      showToast(`${newName} さんの情報を更新しました！`);
      closeEditStudentModal();
    } catch (err) {
      console.error(err);
      showToast('更新に失敗しました: ' + (err.message || '通信エラー'), true);
    } finally {
      btn.disabled = false;
      btn.textContent = '変更を保存';
    }
  });
  document.getElementById('editStudentKanaInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('saveEditStudentBtn').click();
  });
  document.getElementById('editStudentNameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('editStudentKanaInput').focus();
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
