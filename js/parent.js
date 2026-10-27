const CLUB_NAME = "運動教室"; // 教室名・クラブ名（未設定時の初期値）
const COACH_TITLE = "コーチ"; // 指導者の呼び名（「コーチ」「指導者」「リーダー」「先生」等）
const DEFAULT_ANNOUNCEMENT_TITLE = `${COACH_TITLE}からのおしらせ`;

function updateClubNameDisplay(name) {
  const next = String(name || '').trim() || CLUB_NAME;
  document.title = `【保護者用】${next} 出欠管理ポータル`;
  document.getElementById('parentPortalTitle').textContent = `${next} 保護者ポータル`;
}

updateClubNameDisplay(CLUB_NAME);

const STORAGE_KEY_NAME = 'sports_app_parent_kid';

let attendanceMap = {};
let attendanceRaw = {};
let schedulesMap = {};
let selectedDate = null;
let selectedStatus = '出席';

function syncAttendanceMapForCurrentChild() {
  const normKey = normalizeName(document.getElementById('studentNameInput').value.trim());
  const next = {};
  if (normKey) {
    Object.keys(attendanceRaw).forEach(id => {
      const item = attendanceRaw[id];
      if (!item) return;
      const itemNorm = item.normalizedName || normalizeName(item.name);
      if (itemNorm === normKey) next[id] = item;
    });
  }
  attendanceMap = next;
}

function refreshParentViews() {
  syncAttendanceMapForCurrentChild();
  renderUpcomingNotice();
  renderList();
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
        isOff: item.status === '休み',
        description: String(item.description || '').trim(),
        itemsToBring: String(item.itemsToBring || '').trim(),
        announcementTitle: String(item.announcementTitle || '').trim()
      };
    });
    schedulesMap = next;
    refreshParentViews();
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
      next[doc.id] = date ? { ...item, date: date } : item;
    });
    attendanceRaw = next;
    refreshParentViews();
  }, (err) => {
    console.error(err);
    showToast('出欠を読み込めませんでした。通信環境を確認してください。', true);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPracticeOff(schedule) {
  return !!(schedule && (schedule.status === '休み' || schedule.isOff));
}

function getSchedule(dateStr) {
  return schedulesMap[normalizeDateKey(dateStr)] || null;
}

function findAttendance(normKey, dateStr) {
  const target = normalizeDateKey(dateStr);
  if (!normKey || !target) return null;
  const direct = attendanceMap[`${normKey}_${target}`];
  if (direct) return direct;
  return Object.values(attendanceMap).find(item => {
    if (!item || normalizeDateKey(item.date) !== target) return false;
    const itemNorm = item.normalizedName || normalizeName(item.name);
    return itemNorm === normKey;
  }) || null;
}

function renderUpcomingNotice() {
  const el = document.getElementById('upcomingNotice');
  const picks = [];
  for (let offset = 0; offset < 2; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = formatDate(d);
    const schedule = getSchedule(dateStr);
    if (!schedule) continue;
    const off = isPracticeOff(schedule);
    const description = (schedule.description || '').trim();
    const items = (schedule.itemsToBring || '').trim();
    const announce = (schedule.announcementTitle || '').trim();
    const customAnnounce = announce && announce !== DEFAULT_ANNOUNCEMENT_TITLE;
    if (!off && !description && !items && !customAnnounce) continue;
    picks.push({
      label: offset === 0 ? '今日' : '明日',
      dateStr: dateStr,
      off: off,
      description: description,
      items: items,
      announce: customAnnounce ? announce : ''
    });
  }

  el.replaceChildren();
  if (picks.length === 0) {
    el.className = 'hidden';
    return;
  }

  const hasOff = picks.some(pick => pick.off);
  el.className = `p-4 rounded-2xl border-2 shadow-sm space-y-3 ${
    hasOff ? 'bg-rose-100 border-rose-400 text-rose-950' : 'bg-blue-50 border-blue-300 text-blue-950'
  }`;

  const heading = document.createElement('div');
  heading.className = 'text-sm sm:text-base font-black';
  heading.textContent = hasOff ? '直近の練習予定・休講案内' : '直近の練習内容・持ち物';
  el.appendChild(heading);

  picks.forEach(pick => {
    const block = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'text-sm font-black leading-snug break-words';
    title.textContent = pick.off
      ? `🚫 ${pick.label}（${pick.dateStr}）は休講です`
      : (pick.announce
        ? `📢 ${pick.announce}（${pick.label}）`
        : `📢 ${pick.label}（${pick.dateStr}）の連絡`);
    block.appendChild(title);
    if (pick.description) {
      const body = document.createElement('div');
      body.className = 'text-sm font-bold mt-1 leading-relaxed break-words';
      body.textContent = pick.description;
      block.appendChild(body);
    }
    if (pick.items) {
      const badge = document.createElement('div');
      badge.className = 'mt-1 text-sm font-black text-amber-950 break-words';
      badge.textContent = `🎒 持ち物: ${pick.items}`;
      block.appendChild(badge);
    }
    el.appendChild(block);
  });
}

function renderList() {
  const container = document.getElementById('scheduleList');
  const studentName = document.getElementById('studentNameInput').value.trim();
  const normKey = normalizeName(studentName);

  const days = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    days.push({
      dateStr: formatDate(d),
      dayLabel: getDayLabel(d),
      isSunday: d.getDay() === 0,
      isSaturday: d.getDay() === 6
    });
  }

  container.innerHTML = '';

  days.forEach(day => {
    const record = findAttendance(normKey, day.dateStr);
    const schedule = getSchedule(day.dateStr);
    const isOff = isPracticeOff(schedule);

    const row = document.createElement('div');
    row.className = `p-3.5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between transition cursor-pointer ${
      isOff ? 'bg-rose-50 hover:bg-rose-100/70' : 'hover:bg-slate-50'
    }`;
    row.onclick = () => openModal(day.dateStr, record, schedule);

    let statusBadge = '<span class="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-400 font-bold">未登録</span>';
    if (isOff) {
      statusBadge = '<span class="text-xs px-2.5 py-1 rounded-full bg-rose-200 text-rose-950 font-black border border-rose-400">🚫 休講（練習休み）</span>';
    } else if (record) {
      if (record.status === '出席') {
        statusBadge = '<span class="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">⭕ 出席</span>';
      } else if (record.status === '欠席') {
        statusBadge = '<span class="text-xs px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-bold border border-rose-200">❌ 欠席</span>';
      }
    }

    const dayColor = day.isSunday ? 'text-rose-600 font-bold' : (day.isSaturday ? 'text-blue-600 font-bold' : 'text-slate-800');

    let descLine = '';
    if (isOff) {
      const reason = schedule.description
        ? escapeHtml(schedule.description)
        : 'この日は練習がありません';
      descLine = `<div class="text-sm font-bold text-rose-950 mt-1 leading-relaxed break-words">${reason}</div>`;
    } else if (schedule && schedule.description) {
      descLine = `<div class="text-xs sm:text-sm text-indigo-600 font-semibold mt-1 leading-relaxed break-words">📌 練習内容: ${escapeHtml(schedule.description)}</div>`;
    }

    if (schedule && (schedule.itemsToBring || '').trim()) {
      descLine += `<div class="mt-1"><span class="bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full text-xs font-black inline-flex items-center gap-1">🎒 持ち物: ${escapeHtml(schedule.itemsToBring.trim())}</span></div>`;
    }

    let announceBadge = '';
    const announce = schedule && String(schedule.announcementTitle || '').trim();
    if (announce && announce !== DEFAULT_ANNOUNCEMENT_TITLE) {
      announceBadge = `<span class="bg-purple-100 text-purple-800 text-[10px] px-1.5 py-0.5 rounded font-bold">${escapeHtml(announce)}</span>`;
    }

    let coachBadge = '';
    if (record && record.source === 'coach') {
      coachBadge = `<span class="inline-flex items-center text-[10px] bg-slate-100 text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded font-bold">${COACH_TITLE}</span>`;
    }

    let selfEntryBadge = '';
    if (record && record.source === 'student') {
      selfEntryBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full">👦 本人入力</span>';
    }

    row.innerHTML = `
      <div class="min-w-0 w-full">
        <div class="text-sm flex flex-wrap items-center gap-1.5">
          <span class="${dayColor}">${day.dateStr}</span>
          <span class="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">${day.dayLabel}</span>
          ${announceBadge}
          ${coachBadge}
        </div>
        ${descLine}
        ${record && record.note ? `<div class="text-xs text-slate-500 font-medium mt-0.5 break-words">💬 連絡事項: ${escapeHtml(record.note)}</div>` : ''}
      </div>
      <div class="shrink-0 max-w-full flex flex-wrap items-center justify-start sm:justify-end gap-1.5">${statusBadge}${selfEntryBadge}</div>
    `;
    container.appendChild(row);
  });
}

function openModal(dateStr, currentRecord, schedule) {
  const studentName = document.getElementById('studentNameInput').value.trim();
  if (!studentName) {
    showToast('先にお子さんのお名前を入力・保存してください。', true);
    document.getElementById('studentNameInput').focus();
    return;
  }

  selectedDate = dateStr;
  document.getElementById('modalDateTitle').textContent = `${dateStr} の出欠登録`;

  const notice = document.getElementById('modalScheduleNotice');
  notice.replaceChildren();
  const items = schedule && schedule.itemsToBring ? String(schedule.itemsToBring).trim() : '';
  const announce = schedule ? (String(schedule.announcementTitle || '').trim() || DEFAULT_ANNOUNCEMENT_TITLE) : '';
  const appendSender = () => {
    if (!announce) return;
    const sender = document.createElement('div');
    sender.className = announce === DEFAULT_ANNOUNCEMENT_TITLE
      ? 'font-black text-sm leading-snug break-words'
      : 'inline-flex bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded font-black';
    sender.textContent = `📢 ${announce}`;
    notice.prepend(sender);
  };
  const appendItemsWarning = () => {
    if (!items) return;
    const warn = document.createElement('div');
    warn.className = 'font-black text-sm leading-relaxed break-words';
    warn.textContent = `⚠️ 必要持参物: ${items}`;
    notice.prepend(warn);
  };
  if (isPracticeOff(schedule)) {
    notice.className = 'rounded-xl border-2 border-rose-400 bg-rose-100 text-rose-950 p-3 space-y-2';
    const heading = document.createElement('div');
    heading.className = 'font-black text-sm sm:text-base';
    heading.textContent = 'この日は休講日です';
    notice.appendChild(heading);
    const body = document.createElement('div');
    body.className = 'text-sm font-bold mt-1 leading-relaxed break-words';
    body.textContent = (schedule && schedule.description) ? schedule.description : '練習休みのため、出欠の登録は不要です。';
    notice.appendChild(body);
    appendItemsWarning();
    appendSender();
  } else if (schedule && schedule.description) {
    notice.className = 'rounded-xl border-2 border-blue-300 bg-blue-50 text-blue-950 p-3 space-y-2';
    const heading = document.createElement('div');
    heading.className = 'font-black text-sm';
    heading.textContent = '練習内容';
    notice.appendChild(heading);
    const body = document.createElement('div');
    body.className = 'text-sm font-bold mt-1 leading-relaxed break-words';
    body.textContent = schedule.description;
    notice.appendChild(body);
    appendItemsWarning();
    appendSender();
  } else if (items || (announce && announce !== DEFAULT_ANNOUNCEMENT_TITLE)) {
    notice.className = items
      ? 'rounded-xl border-2 border-amber-400 bg-amber-100 text-amber-950 p-3 space-y-2'
      : 'rounded-xl border-2 border-purple-300 bg-purple-50 text-purple-950 p-3 space-y-2';
    appendItemsWarning();
    appendSender();
  } else {
    notice.className = 'hidden';
  }

  const selfNotice = document.getElementById('modalSelfEntryNotice');
  if (currentRecord && currentRecord.source === 'student') {
    selfNotice.className = 'p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-1.5';
    selfNotice.textContent = `👦 お子さん本人が「${currentRecord.status || ''}」で登録しています（ここから保護者の方が変更・上書きも可能です）`;
  } else {
    selfNotice.className = 'hidden';
    selfNotice.textContent = '';
  }

  selectedStatus = currentRecord ? currentRecord.status : '出席';
  document.getElementById('modalNoteInput').value = currentRecord ? currentRecord.note : '';
  updateModalBtnUI();

  document.getElementById('statusModal').classList.remove('hidden');
}

function updateModalBtnUI() {
  document.querySelectorAll('.status-choice-btn').forEach(btn => {
    if (btn.dataset.val === selectedStatus) {
      btn.classList.add('ring-2', 'ring-offset-2', 'ring-indigo-500', 'bg-indigo-50');
    } else {
      btn.classList.remove('ring-2', 'ring-offset-2', 'ring-indigo-500', 'bg-indigo-50');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(STORAGE_KEY_NAME);
  if (saved) document.getElementById('studentNameInput').value = saved;

  const guideModal = document.getElementById('parentGuideModal');
  const openParentGuide = () => {
    guideModal.classList.remove('hidden');
    guideModal.classList.add('flex');
  };
  const closeParentGuide = () => {
    guideModal.classList.add('hidden');
    guideModal.classList.remove('flex');
  };
  document.getElementById('openParentGuideBtn').addEventListener('click', openParentGuide);
  document.getElementById('closeParentGuideBtn').addEventListener('click', closeParentGuide);
  document.getElementById('closeParentGuideConfirmBtn').addEventListener('click', closeParentGuide);
  guideModal.addEventListener('click', (event) => {
    if (event.target.id === 'parentGuideModal') closeParentGuide();
  });

  document.getElementById('saveNameBtn').addEventListener('click', () => {
    const name = document.getElementById('studentNameInput').value.trim();
    if (name) {
      localStorage.setItem(STORAGE_KEY_NAME, name);
      showToast(`お子さんのお名前「${name}」を保存しました`);
      refreshParentViews();
    }
  });

  document.getElementById('studentNameInput').addEventListener('change', () => {
    refreshParentViews();
  });

  document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.getElementById('statusModal').classList.add('hidden');
  });

  document.querySelectorAll('.status-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStatus = btn.dataset.val;
      updateModalBtnUI();
    });
  });

  document.getElementById('submitAttendanceBtn').addEventListener('click', async () => {
    const studentName = document.getElementById('studentNameInput').value.trim();
    const note = document.getElementById('modalNoteInput').value.trim();
    const btn = document.getElementById('submitAttendanceBtn');

    if (!studentName || !selectedDate) {
      showToast('先にお子さんのお名前を入力・保存してください。', true);
      return;
    }

    btn.disabled = true;
    btn.innerText = '保存中...';

    try {
      await saveAttendance({
        name: studentName,
        date: selectedDate,
        status: selectedStatus,
        note: note,
        source: 'parent'
      });
      localStorage.setItem(STORAGE_KEY_NAME, studentName);
      document.getElementById('statusModal').classList.add('hidden');
      showToast(`${selectedDate} の出欠を【${selectedStatus}】で保存しました！`);
    } catch (err) {
      console.error(err);
      showToast('出欠の更新に失敗しました。通信環境を確認してください。', true);
    } finally {
      btn.disabled = false;
      btn.innerText = '確定して保存';
    }
  });

  startLiveSync();
});
