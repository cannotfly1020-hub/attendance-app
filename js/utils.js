/* 汎用ユーティリティ（全画面共通） */

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeName(name) {
  return (name || '').replace(/[\s\u3000]+/g, '').trim();
}

function normalizeDateKey(val) {
  if (!val) return '';
  const s = String(val).trim().replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

function getDayLabel(date) {
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  if (typeof date === 'number') return labels[date] || '';
  if (date instanceof Date) return labels[date.getDay()] || '';
  return '';
}

function showToast(msg, isError) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `p-3 rounded-xl shadow-lg border text-xs font-bold pointer-events-auto flex items-start gap-2 ${
    isError ? 'bg-rose-900 text-rose-100 border-rose-700' : 'bg-slate-900 text-white border-slate-700'
  }`;
  const icon = document.createElement('span');
  icon.textContent = isError ? '⚠️' : '✅';
  const text = document.createElement('span');
  text.className = 'leading-relaxed';
  text.textContent = msg;
  toast.append(icon, text);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), isError ? 8000 : 3500);
}
