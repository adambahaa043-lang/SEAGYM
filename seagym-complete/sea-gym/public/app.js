'use strict';
/* SEAGYM Admin dashboard front-end */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { sort: 'member_id', dir: 'asc', page: 1, current: null };

const say = msg => { const s = $('#status'); if (s) { s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 40); } };

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/login'; throw new Error('Session expired'); }
  if (res.status === 403) { throw new Error(data.message || 'Forbidden'); }
  if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong.'), { errors: data.errors || {} });
  return data;
}

const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const badge = s => el('span', s, 'badge s-' + String(s).replace(/ /g, '-'));
const remaining = d => d < 0 ? `${-d} days overdue` : `${d} days left`;

function setErr(prefix, name, msg) {
  const f = document.getElementById(prefix + name);
  if (f) f.textContent = msg || '';
  const input = document.getElementById(prefix === 'err-' ? name : 'e_' + name);
  if (input) msg ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');
}

/* Auth gate */
async function ensureAdmin() {
  try {
    const { user } = await api('/api/me');
    if (user.role !== 'admin') {
      location.href = user.role === 'member' ? '/member' : '/login';
      return null;
    }
    $('#whoami').textContent = user.username + ' (admin)';
    $('#app').hidden = false;
    return user;
  } catch {
    location.href = '/login';
    return null;
  }
}

$('#logout')?.addEventListener('click', async () => {
  await api('/api/logout', 'POST').catch(() => {});
  location.href = '/login';
});

/* Navigation */
function show(view) {
  if (!$('#v-' + view)) view = 'dashboard';
  $$('#app .app-main > section').forEach(s => { s.hidden = s.id !== 'v-' + view; });
  $$('.nav').forEach(n => n.dataset.view === view ? n.setAttribute('aria-current', 'page') : n.removeAttribute('aria-current'));
  const titles = { dashboard: 'Dashboard', register: 'Register member', members: 'Members' };
  $('#page-title').textContent = titles[view] || view;
  document.title = (titles[view] || view) + ' – SEAGYM Admin';
  if (view === 'dashboard') loadDashboard();
  if (view === 'members') loadMembers();
  say((titles[view] || view) + ' page');
}
$$('.nav').forEach(n => n.addEventListener('click', () => show(n.dataset.view)));

/* Dashboard */
async function loadDashboard() {
  const ul = $('#stat-cards');
  ul.replaceChildren(el('li', 'Loading…'));
  try {
    const s = await api('/api/stats');
    ul.replaceChildren(...[
      ['Total members', s.total],
      ['Active', s.active],
      ['Expired', s.expired],
      ['Expiring soon', s.expiring],
      ['Frozen', s.frozen],
      ['New this month', s.newThisMonth]
    ].map(([l, n]) => { const li = el('li'); li.append(el('strong', String(n)), el('span', l)); return li; }));
    const fill = (id, items, fn, empty) => {
      const node = $(id);
      node.replaceChildren(...(items.length ? items.map(fn) : [el('li', empty)]));
    };
    fill('#recent', s.recent, m => el('li', `${m.full_name} (${m.member_id}) · ${m.created_at?.slice(0, 10) || ''}`), 'No members yet.');
    fill('#alerts', s.alerts, m => el('li', `${m.full_name} (${m.member_id}): ${remaining(m.remaining_days)}`), 'None expiring in the next 7 days.');
    fill('#dist', s.byType, t => el('li', `${t.type}: ${t.count} members`), 'No data.');
  } catch (e) {
    ul.replaceChildren(el('li', e.message));
  }
}

/* Register */
$('#has-ec')?.addEventListener('change', e => { $('#ec').hidden = !e.target.checked; });
$('#start_date') && ($('#start_date').value = new Date().toISOString().slice(0, 10));

$('#reg-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  body.gender = form.querySelector('input[name=gender]:checked')?.value || '';
  ['full_name','national_id','phone','email','dob','type','start_date','ec_name','ec_phone','notes'].forEach(k => setErr('err-', k, ''));
  $('#reg-summary').hidden = true;
  const btn = $('#reg-btn');
  btn.disabled = true; btn.textContent = 'Registering…';
  try {
    const member = await api('/api/members', 'POST', body);
    say(`Registered ${member.full_name} (${member.member_id})`);
    form.reset();
    $('#ec').hidden = true;
    $('#start_date').value = new Date().toISOString().slice(0, 10);
    show('members');
  } catch (ex) {
    if (ex.errors) {
      Object.entries(ex.errors).forEach(([k, v]) => setErr('err-', k, v));
      $('#reg-summary').textContent = ex.message;
      $('#reg-summary').hidden = false;
    } else {
      $('#reg-summary').textContent = ex.message;
      $('#reg-summary').hidden = false;
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Register member';
  }
});

/* Members list */
const COLS = [['member_id', 'Member ID'], ['full_name', 'Name'], ['phone', 'Phone'], ['type', 'Type'], ['start_date', 'Start'], ['end_date', 'End'], ['status', 'Status']];

function renderHead() {
  const tr = $('#thead-row');
  tr.replaceChildren(...COLS.map(([k, label]) => {
    const th = el('th');
    const b = el('button', label + (state.sort === k ? (state.dir === 'asc' ? ' ↑' : ' ↓') : ''));
    b.addEventListener('click', () => {
      if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = k; state.dir = 'asc'; }
      state.page = 1;
      loadMembers();
    });
    th.append(b);
    return th;
  }));
  tr.append(el('th', 'Actions'));
}

async function loadMembers() {
  renderHead();
  const q = $('#q')?.value || '';
  const status = $('#f-status')?.value || '';
  const tbody = $('#rows');
  tbody.replaceChildren(el('tr', null).appendChild(el('td', 'Loading…')));
  try {
    const data = await api(`/api/members?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&sort=${state.sort}&dir=${state.dir}&page=${state.page}&size=10`);
    $('#count').textContent = `${data.total} member${data.total === 1 ? '' : 's'}`;
    $('#pageinfo').textContent = `Page ${data.page} of ${data.pages}`;
    $('#prev').disabled = data.page <= 1;
    $('#next').disabled = data.page >= data.pages;
    if (!data.members.length) {
      tbody.replaceChildren();
      const tr = el('tr');
      const td = el('td', 'No members match your search.');
      td.colSpan = COLS.length + 1;
      tr.append(td);
      tbody.append(tr);
      return;
    }
    tbody.replaceChildren(...data.members.map(m => {
      const tr = el('tr');
      COLS.forEach(([k]) => {
        const td = el('td');
        if (k === 'status') td.append(badge(m.status));
        else td.textContent = m[k] ?? '';
        tr.append(td);
      });
      const act = el('td');
      const btn = el('button', 'View', 'btn alt sm');
      btn.addEventListener('click', () => openDetail(m.id));
      act.append(btn);
      tr.append(act);
      return tr;
    }));
  } catch (e) {
    tbody.replaceChildren();
    const tr = el('tr');
    const td = el('td', e.message);
    td.colSpan = 8;
    tr.append(td);
    tbody.append(tr);
  }
}

$('#filters')?.addEventListener('submit', e => { e.preventDefault(); state.page = 1; loadMembers(); });
$('#prev')?.addEventListener('click', () => { if (state.page > 1) { state.page--; loadMembers(); } });
$('#next')?.addEventListener('click', () => { state.page++; loadMembers(); });

/* Detail dialog */
async function openDetail(id) {
  const dlg = $('#detail');
  try {
    const m = await api('/api/members/' + id);
    state.current = m;
    $('#d-title').textContent = m.full_name;
    const info = $('#d-info');
    info.replaceChildren();
    [['Member ID', m.member_id], ['Status', m.status], ['Plan', m.type], ['Start', m.start_date], ['End', m.end_date],
     ['Remaining', remaining(m.remaining_days)]].forEach(([k, v]) => {
      info.append(el('dt', k), el('dd', String(v)));
    });
    $('#e_full_name').value = m.full_name;
    $('#e_national_id').value = m.national_id;
    $('#e_phone').value = m.phone;
    $('#e_email').value = m.email || '';
    $('#e_dob').value = m.dob;
    $('#e_gender').value = m.gender;
    $('#e_type').value = m.type;
    $('#e_ec_name').value = m.ec_name || '';
    $('#e_ec_phone').value = m.ec_phone || '';
    $('#e_notes').value = m.notes || '';
    $('#d-freeze').textContent = m.frozen ? 'Unfreeze' : 'Freeze';
    $('#d-deactivate').textContent = m.active ? 'Deactivate' : 'Activate';
    $('#d-summary').hidden = true;
    dlg.showModal();
  } catch (e) {
    say(e.message);
  }
}

$('#d-close')?.addEventListener('click', () => $('#detail').close());

$('#edit-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.current) return;
  const body = {
    full_name: $('#e_full_name').value,
    national_id: $('#e_national_id').value,
    phone: $('#e_phone').value,
    email: $('#e_email').value,
    dob: $('#e_dob').value,
    gender: $('#e_gender').value,
    type: $('#e_type').value,
    ec_name: $('#e_ec_name').value,
    ec_phone: $('#e_ec_phone').value,
    notes: $('#e_notes').value
  };
  try {
    const m = await api('/api/members/' + state.current.id, 'PUT', body);
    state.current = m;
    say('Saved changes for ' + m.full_name);
    $('#detail').close();
    loadMembers();
    loadDashboard();
  } catch (ex) {
    if (ex.errors) Object.entries(ex.errors).forEach(([k, v]) => setErr('eerr-', k, v));
    $('#d-summary').textContent = ex.message;
    $('#d-summary').hidden = false;
  }
});

$('#d-renew')?.addEventListener('click', async () => {
  if (!state.current) return;
  const type = $('#e_type').value || state.current.type;
  try {
    const m = await api('/api/members/' + state.current.id + '/renew', 'POST', { type });
    state.current = m;
    say('Renewed to ' + m.end_date);
    openDetail(m.id);
    loadMembers();
  } catch (e) { say(e.message); }
});

$('#d-freeze')?.addEventListener('click', async () => {
  if (!state.current) return;
  const path = state.current.frozen ? 'unfreeze' : 'freeze';
  try {
    const m = await api('/api/members/' + state.current.id + '/' + path, 'POST');
    state.current = m;
    say(m.frozen ? 'Frozen' : 'Unfrozen');
    openDetail(m.id);
    loadMembers();
  } catch (e) { say(e.message); }
});

$('#d-deactivate')?.addEventListener('click', async () => {
  if (!state.current) return;
  const path = state.current.active ? 'deactivate' : 'activate';
  try {
    const m = await api('/api/members/' + state.current.id + '/' + path, 'POST');
    state.current = m;
    say(m.active ? 'Activated' : 'Deactivated');
    openDetail(m.id);
    loadMembers();
  } catch (e) { say(e.message); }
});

$('#d-delete')?.addEventListener('click', async () => {
  if (!state.current) return;
  if (!confirm(`Permanently delete ${state.current.full_name}? This cannot be undone.`)) return;
  try {
    await api('/api/members/' + state.current.id, 'DELETE');
    say('Member deleted');
    $('#detail').close();
    loadMembers();
    loadDashboard();
  } catch (e) { say(e.message); }
});

/* Boot */
(async () => {
  const user = await ensureAdmin();
  if (user) show(location.hash.slice(1) || 'dashboard');
})();
