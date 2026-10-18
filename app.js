'use strict';
/* Pelindung: bila brand.js belum ikut terunggah / index.html masih versi lama, tampilkan pesan jelas (bukan layar loading macet) */
if (!window.Brand) {
  document.addEventListener('DOMContentLoaded', () => {
    const o = document.getElementById('loadingOverlay');
    if (o) o.innerHTML = '<div style="max-width:420px;text-align:center;padding:1.5rem"><h5>Berkas aplikasi belum lengkap</h5><p style="opacity:.8;font-size:.9rem">File <b>brand.js</b> belum terunggah atau <b>index.html</b> belum diperbarui. Unggah <b>index.html, brand.js, config.js, app.js, dan style.css</b> bersamaan, lalu muat ulang dengan Ctrl+Shift+R.</p></div>';
  });
  throw new Error('brand.js tidak dimuat');
}
/* ============================================================
   Inventory — app.js (Supabase)
   URL & key Supabase TIDAK diisi di sini, melainkan di file config.js
   (agar memperbarui app.js tidak menimpa konfigurasi Anda).
   ============================================================ */
const CFG = window.APP_CONFIG || {};
const SUPABASE_URL = String(CFG.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(CFG.SUPABASE_ANON_KEY || '').trim();
const CONFIG_OK = /^https:\/\/\S+$/.test(SUPABASE_URL) && !/XXXX/.test(SUPABASE_URL) &&
                  SUPABASE_ANON_KEY.length > 40 && !/\s/.test(SUPABASE_ANON_KEY) && !/ISI_ANON/.test(SUPABASE_ANON_KEY);
const sb = CONFIG_OK ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ───────────────────────── STATE ───────────────────────── */
const AppState = { user: null, profile: null, role: null, config: {}, masterBarang: [], masterVarian: [], masterPelanggan: [], masterSumber: [], currentPage: 'dashboard' };
let chartInstances = {};
let bootedUserId = null;
let dashboardFilter = { from: null, to: null };
let dashData = { keluar: [], masuk: [], from: '', to: '' };
let riwayatMap = {};
let kasirEditId = null;
let masukEditId = null;
let isKeluar = true;          // halaman item aktif: true = Kasir (barang keluar), false = Barang Masuk
let stokOnlyLow = false;
let stokMerk = '', stokKat = '';   // filter halaman Stok (nilai = kunci ter-normalisasi)

const MENU = {
  admin: [
    { id: 'dashboard',   icon: 'bi-speedometer2',      label: 'Dashboard' },
    { id: 'kasir',       icon: 'bi-cart-check',        label: 'Barang Keluar (Kasir)' },
    { id: 'barangMasuk', icon: 'bi-box-arrow-in-down', label: 'Barang Masuk' },
    { id: 'stok',        icon: 'bi-boxes',             label: 'Stok & Master Barang' },
    { id: 'riwayat',     icon: 'bi-clock-history',     label: 'Riwayat Transaksi' },
    { id: 'pelanggan',   icon: 'bi-people',            label: 'Pelanggan' },
    { id: 'invoice',     icon: 'bi-file-earmark-pdf',  label: 'Invoice' },
    { id: 'pengaturan',  icon: 'bi-gear',              label: 'Pengaturan' }
  ],
  owner: [
    { id: 'dashboard', icon: 'bi-speedometer2', label: 'Dashboard' }
  ]
};
/* Bottom navigation (smartphone): Dashboard | Stok | Kasir | Masuk | Lainnya */
const BOTTOM_NAV = [
  { id: 'dashboard',   label: 'Dashboard' },
  { id: 'stok',        label: 'Stok' },
  { id: 'kasir',       label: 'Kasir' },
  { id: 'barangMasuk', label: 'Masuk' }
];
const MORE_IDS = ['riwayat', 'pelanggan', 'invoice', 'pengaturan'];

/* ───────────────────────── HELPER ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const fmtNum = v => num(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, '0');
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const dateToStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => dateToStr(new Date());
const firstOfMonthStr = () => { const d = new Date(); return dateToStr(new Date(d.getFullYear(), d.getMonth(), 1)); };
const parseDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const tglPanjang = s => { const d = parseDate(s); return `${HARI_ID[d.getDay()]}, ${pad(d.getDate())} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`; };
const tglSingkat = s => { const d = parseDate(s); return `${d.getDate()} ${BULAN_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const tglKode = s => { const d = parseDate(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`; };
const getModal = id => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
const spinnerBlock = () => '<div class="page-loading"><div class="spinner-border text-success"></div></div>';
const errBox = (msg, retry) => `<div class="section-card text-center"><i class="bi bi-exclamation-triangle text-danger fs-2"></i><p class="mt-2 mb-2">${esc(msg)}</p>${retry ? `<button class="btn btn-outline-accent btn-sm" onclick="${retry}">Coba Lagi</button>` : ''}</div>`;
const badgeStatus = s => `<span class="badge-status ${s === 'Aktif' ? 'badge-ok' : 'badge-off'}">${esc(s)}</span>`;
const labelItem = (nama, varian) => varian ? `${nama} · ${varian}` : nama;
const sumQty = items => (items || []).reduce((a, i) => a + num(i.jumlah), 0);

function showToast(title, msg, type = 'success') {
  const el = $('#appToast');
  $('#toastTitle').textContent = title;
  $('#toastBody').textContent = msg;
  el.classList.remove('text-bg-success', 'text-bg-danger', 'text-bg-warning');
  if (type === 'success') el.classList.add('text-bg-success');
  if (type === 'danger') el.classList.add('text-bg-danger');
  if (type === 'warning') el.classList.add('text-bg-warning');
  bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show();
}

function friendlyError(err) {
  const code = err && err.code, msg = (err && err.message) || '';
  if (code === '23503') return 'Data ini masih dipakai di transaksi lain, sehingga tidak bisa dihapus. Ubah statusnya menjadi Nonaktif.';
  if (code === '23505') return 'Data dengan nilai yang sama (nama/kode) sudah ada.';
  if (code === '23514') return 'Ada nilai yang tidak valid (tidak boleh negatif atau nol).';
  if (code === '42501' || /row-level security/i.test(msg)) return 'Anda tidak memiliki izin untuk aksi ini.';
  if (/JWT|expired/i.test(msg)) return 'Sesi berakhir. Silakan login ulang.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Koneksi gagal. Periksa internet Anda.';
  if (code === '42P01' || code === '42703' || /master_varian|varian_id|min_stok|punya_varian|merk/i.test(msg)) return 'Database belum diperbarui. Jalankan migrasi-inventory.sql lalu migrasi-merk.sql di Supabase SQL Editor.';
  if (code === 'P0001') return msg;
  return msg || 'Terjadi kesalahan tak terduga.';
}

let busyCount = 0;
function setBusy(on) { busyCount += on ? 1 : -1; if (busyCount < 0) busyCount = 0; $('#topProgress').classList.toggle('active', busyCount > 0); }

/* Semua pemanggilan Supabase lewat sini: loading bar + error ramah */
async function callSb(promise, successMsg, opts = {}) {
  setBusy(true);
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (successMsg) showToast('Berhasil', successMsg, 'success');
    return { success: true, data };
  } catch (err) {
    const message = friendlyError(err);
    if (!opts.silent) showToast('Gagal', message, 'danger');
    return { success: false, data: null, message };
  } finally { setBusy(false); }
}

function setBtnBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-inline"></span> ' + (label || 'Memproses...'); }
  else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

function confirmDelete(fn, text) {
  $('#deleteModalText').textContent = text || 'Apakah Anda yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan.';
  const btn = $('#confirmDeleteBtn');
  btn.onclick = async () => { btn.disabled = true; await fn(); btn.disabled = false; getModal('deleteModal').hide(); };
  getModal('deleteModal').show();
}
function showForm(title, html) { $('#formModalTitle').textContent = title; $('#formModalBody').innerHTML = html; getModal('formModal').show(); }
function hideForm() { getModal('formModal').hide(); }
function showDetail(title, html) { $('#detailModalTitle').textContent = title; $('#detailModalBody').innerHTML = html; getModal('detailModal').show(); }
function destroyCharts() { Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) { } }); chartInstances = {}; }

/* ───────────────────────── VARIAN & PENGINGAT STOK ───────────────────────── */
const variansOf = bid => AppState.masterVarian.filter(v => v.barang_id === bid);
const isLow = (stok, min) => num(min) > 0 && num(stok) <= num(min);
const barangLow = b => { const vs = variansOf(b.id); return vs.length ? vs.some(v => v.status === 'Aktif' && isLow(v.stok, v.min_stok)) : isLow(b.stok, b.min_stok); };

/* Daftar item (barang atau varian) yang stoknya sudah di bawah / sama dengan batas minimum */
function stokAlerts() {
  const out = [];
  AppState.masterBarang.forEach(b => {
    if (b.status !== 'Aktif') return;
    const vs = variansOf(b.id);
    if (vs.length) {
      vs.forEach(v => { if (v.status === 'Aktif' && isLow(v.stok, v.min_stok)) out.push({ barang: b, nama: b.nama, varianNama: v.nama, stok: num(v.stok), min: num(v.min_stok), satuan: b.satuan }); });
    } else if (isLow(b.stok, b.min_stok)) out.push({ barang: b, nama: b.nama, varianNama: '', stok: num(b.stok), min: num(b.min_stok), satuan: b.satuan });
  });
  return out.sort((a, b) => (a.stok / a.min) - (b.stok / b.min));
}
function updateNavBadges() {
  const n = stokAlerts().length;
  document.querySelectorAll('[data-stok-badge]').forEach(el => { el.textContent = n > 99 ? '99+' : n; el.style.display = n > 0 ? '' : 'none'; });
}

/* ───────────────────────── TEMA & SIDEBAR ───────────────────────── */
function toggleDarkMode() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('m3wt-theme', next); } catch (e) { }
  if (AppState.currentPage === 'dashboard' && AppState.role) { renderTop10Chart(); renderCompare(); }
}
function toggleSidebar() { $('#sidebar').classList.toggle('show'); document.querySelector('.sidebar-overlay').classList.toggle('show'); }
function closeSidebar() { $('#sidebar').classList.remove('show'); document.querySelector('.sidebar-overlay').classList.remove('show'); }

/* ───────────────────────── CONFIG ───────────────────────── */
async function loadConfig() {
  const r = await callSb(sb.from('app_config').select('key,value'), null, { silent: true });
  if (r.success) { AppState.config = {}; r.data.forEach(x => AppState.config[x.key] = x.value); }
  applyConfig();
}
function applyConfig() { Brand.set(AppState.config); }   // identitas dikelola terpusat di brand.js

/* ───────────────────────── AUTH ───────────────────────── */
function showLogin(msg) {
  $('#loadingOverlay').style.display = 'none';
  $('#sidebar').style.display = 'none';
  $('#mainContent').style.display = 'none';
  $('#bottomNav').style.display = 'none';
  $('#loginView').style.display = 'flex';
  const e = $('#loginError');
  if (msg) { e.textContent = msg; e.style.display = 'block'; } else e.style.display = 'none';
}

async function doLogin() {
  const email = $('#loginEmail').value.trim(), password = $('#loginPassword').value;
  if (!email || !password) return showLogin('Email dan password wajib diisi.');
  const btn = $('#loginBtn'); setBtnBusy(btn, true, 'Masuk...');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  setBtnBusy(btn, false);
  if (error) showLogin(/Invalid login/i.test(error.message) ? 'Email atau password salah.' : friendlyError(error));
}

async function logout() { bootedUserId = null; await sb.auth.signOut(); }

async function handleSession(session) {
  if (!session) { bootedUserId = null; AppState.user = null; AppState.role = null; showLogin(); return; }
  if (bootedUserId === session.user.id) return;
  bootedUserId = session.user.id;
  await bootApp(session.user);
}

async function bootApp(user) {
  const p = await callSb(sb.from('profiles').select('*').eq('id', user.id).maybeSingle(), null, { silent: true });
  if (!p.success || !p.data) { bootedUserId = null; await sb.auth.signOut(); return showLogin('Profil pengguna tidak ditemukan. Hubungi admin.'); }
  AppState.user = user; AppState.profile = p.data; AppState.role = p.data.role;
  await loadConfig();
  await loadMasterCaches();
  $('#userEmailLabel').textContent = user.email;
  $('#userRoleLabel').textContent = AppState.role;
  renderSidebarNav();
  renderBottomNav();
  $('#loginView').style.display = 'none';
  $('#loadingOverlay').style.display = 'none';
  $('#sidebar').style.display = 'flex';
  $('#mainContent').style.display = 'block';
  $('#bottomNav').style.display = '';
  navigateTo('dashboard');
}

async function loadMasterCaches() {
  Object.keys(langgananCache).forEach(k => delete langgananCache[k]);
  const [b, v, p, s] = await Promise.all([
    callSb(sb.from('master_barang').select('*').order('nama'), null, { silent: true }),
    callSb(sb.from('master_varian').select('*').order('nama'), null, { silent: true }),
    callSb(sb.from('master_pelanggan').select('*').order('nama'), null, { silent: true }),
    callSb(sb.from('master_sumber').select('*').order('nama'), null, { silent: true })
  ]);
  if (b.success) AppState.masterBarang = b.data;
  if (v.success) AppState.masterVarian = v.data;
  else if (b.success && !AppState.masterVarian.length && !loadMasterCaches.warned) { loadMasterCaches.warned = true; showToast('Perlu pembaruan database', 'Jalankan migrasi-inventory.sql di Supabase SQL Editor agar varian & stok minimum aktif.', 'warning'); }
  if (p.success) AppState.masterPelanggan = p.data;
  if (s.success) AppState.masterSumber = s.data;
  updateNavBadges();
}

/* ───────────────────────── NAVIGASI ───────────────────────── */
function renderSidebarNav() {
  $('#sidebarNav').innerHTML = (MENU[AppState.role] || []).map(m =>
    `<li><a class="nav-link" data-page="${m.id}" onclick="navigateTo('${m.id}')"><i class="bi ${m.icon}"></i> <span>${m.label}</span>${m.id === 'stok' ? '<span class="nav-badge" data-stok-badge style="display:none"></span>' : ''}</a></li>`).join('');
  updateNavBadges();
}

function renderBottomNav() {
  const menu = MENU[AppState.role] || [];
  const items = BOTTOM_NAV.map(n => ({ ...n, m: menu.find(x => x.id === n.id) })).filter(n => n.m);
  const btn = n => `<button type="button" class="bn-item ${n.id === 'kasir' ? 'bn-center' : ''}" data-bn="${n.id}" onclick="navigateTo('${n.id}')">
      <span class="bn-ico"><i class="bi ${n.m.icon}"></i>${n.id === 'stok' ? '<span class="bn-badge" data-stok-badge style="display:none"></span>' : ''}</span><span class="bn-lbl">${n.label}</span></button>`;
  $('#bottomNav').innerHTML = items.map(btn).join('') +
    `<button type="button" class="bn-item" data-bn="more" onclick="openMore()"><span class="bn-ico"><i class="bi bi-grid-3x3-gap-fill"></i></span><span class="bn-lbl">Lainnya</span></button>`;
  updateNavBadges();
}

function openMore() {
  const menu = MENU[AppState.role] || [];
  const links = MORE_IDS.map(id => menu.find(m => m.id === id)).filter(Boolean);
  $('#moreSheetBody').innerHTML =
    (links.length ? `<div class="more-grid">${links.map(m => `<button type="button" class="more-item ${AppState.currentPage === m.id ? 'active' : ''}" onclick="moreGo('${m.id}')"><i class="bi ${m.icon}"></i><span>${m.label}</span></button>`).join('')}</div>` : '') +
    `<div class="more-actions"><button type="button" class="more-act" onclick="toggleDarkMode()"><i class="bi bi-moon-stars"></i> Mode Gelap</button><button type="button" class="more-act danger" onclick="logout()"><i class="bi bi-box-arrow-right"></i> Keluar</button></div>
     <div class="small text-secondary text-center mt-3">${esc(AppState.user ? AppState.user.email : '')} · ${esc(AppState.role || '')}</div>`;
  bootstrap.Offcanvas.getOrCreateInstance($('#moreSheet')).show();
}
function moreGo(id) { bootstrap.Offcanvas.getOrCreateInstance($('#moreSheet')).hide(); navigateTo(id); }

const PAGES = {};
function navigateTo(page, arg) {
  const menu = MENU[AppState.role] || [];
  if (!menu.some(m => m.id === page)) page = 'dashboard';
  AppState.currentPage = page;
  document.querySelectorAll('#sidebarNav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  document.querySelectorAll('#bottomNav .bn-item').forEach(b => b.classList.toggle('active', b.dataset.bn === page || (b.dataset.bn === 'more' && MORE_IDS.includes(page))));
  const m = menu.find(x => x.id === page);
  $('#pageTitle').textContent = m ? m.label : '';
  destroyCharts(); closeSidebar(); window.scrollTo(0, 0); Brand.clearPreview();
  PAGES[page](arg);
}

/* ───────────────────────── DASHBOARD ───────────────────────── */
PAGES.dashboard = function () {
  $('#app-container').innerHTML = `
    <div class="section-card mb-3"><div class="row g-2 align-items-end">
      <div class="col-6 col-md-3"><label class="form-label">Dari</label><input type="date" id="dbFrom" class="form-control" value="${dashboardFilter.from || firstOfMonthStr()}"></div>
      <div class="col-6 col-md-3"><label class="form-label">Sampai</label><input type="date" id="dbTo" class="form-control" value="${dashboardFilter.to || todayStr()}"></div>
      <div class="col-12 col-md-auto"><button class="btn btn-accent w-100" onclick="applyDashboardFilter()"><i class="bi bi-funnel"></i> Terapkan</button></div>
    </div></div>
    <div id="dashboardBody"></div>`;
  loadDashboard();
};
function applyDashboardFilter() {
  const f = $('#dbFrom').value, t = $('#dbTo').value;
  if (!f || !t || f > t) return showToast('Validasi', 'Rentang tanggal tidak valid.', 'warning');
  dashboardFilter = { from: f, to: t }; loadDashboard();
}

function alertCardHtml() {
  const al = stokAlerts();
  const anyMin = AppState.masterBarang.some(b => b.status === 'Aktif' && (variansOf(b.id).length ? variansOf(b.id).some(v => num(v.min_stok) > 0) : num(b.min_stok) > 0));
  const row = a => `<div class="mini-card stok-alert ${a.stok <= 0 ? 'habis' : ''}"><div><div class="mc-name">${esc(a.nama)}${a.varianNama ? ` <span class="text-secondary fw-normal">· ${esc(a.varianNama)}</span>` : ''}</div><div class="small text-secondary">Minimum ${fmtNum(a.min)} ${esc(a.satuan)}</div></div><span class="badge-status badge-low">${a.stok <= 0 ? 'Habis' : 'Sisa ' + fmtNum(a.stok) + ' ' + esc(a.satuan)}</span></div>`;
  const body = al.length ? al.slice(0, 10).map(row).join('') + (al.length > 10 ? `<p class="small text-secondary mb-0 text-center">+ ${al.length - 10} item lainnya</p>` : '')
    : anyMin ? '<p class="text-secondary small mb-0"><i class="bi bi-check-circle-fill text-success"></i> Semua stok masih di atas batas minimum.</p>'
    : '<p class="text-secondary small mb-0">Belum ada batas stok minimum. Atur di menu <b>Stok & Master Barang</b> (kolom Stok Minimum) agar pengingat aktif.</p>';
  return `<div class="section-card mb-3 ${al.length ? 'alert-card' : ''}"><h6><span><i class="bi bi-bell-fill ${al.length ? 'text-danger' : 'text-secondary'}"></i> Pengingat Stok${al.length ? ` <span class="badge-status badge-low ms-1">${al.length}</span>` : ''}</span>${al.length ? `<button class="btn btn-outline-accent btn-sm" onclick="navigateTo('stok','low')">Lihat di Stok</button>` : ''}</h6>${body}</div>`;
}

let top10Data = [];
async function loadDashboard() {
  const body = $('#dashboardBody'); body.innerHTML = spinnerBlock();
  const from = dashboardFilter.from || firstOfMonthStr(), to = dashboardFilter.to || todayStr();
  const [kel, mas, hari] = await Promise.all([
    callSb(sb.from('barang_keluar').select('id,tanggal,pelanggan_id,pelanggan_nama,barang_keluar_item(barang_id,nama_barang,varian_nama,satuan,jumlah)').gte('tanggal', from).lte('tanggal', to), null, { silent: true }),
    callSb(sb.from('barang_masuk').select('id,tanggal,sumber_id,sumber_nama,barang_masuk_item(nama_barang,varian_nama,satuan,jumlah)').gte('tanggal', from).lte('tanggal', to), null, { silent: true }),
    callSb(sb.from('barang_keluar').select('id,pelanggan_nama,barang_keluar_item(nama_barang,varian_nama,satuan,jumlah)').eq('tanggal', todayStr()), null, { silent: true })
  ]);
  if (![kel, mas, hari].every(r => r.success)) { body.innerHTML = errBox('Gagal memuat data dashboard.', 'loadDashboard()'); return; }
  dashData = { keluar: kel.data, masuk: mas.data, from, to };

  const qtyKeluar = kel.data.reduce((s, k) => s + sumQty(k.barang_keluar_item), 0);
  const qtyMasuk = mas.data.reduce((s, m) => s + sumQty(m.barang_masuk_item), 0);
  const stokAda = AppState.masterBarang.filter(b => num(b.stok) > 0);
  const alerts = stokAlerts();

  const perPel = AppState.masterPelanggan.filter(p => p.status === 'Aktif').map(p => ({ id: p.id, nama: p.nama, qty: kel.data.filter(k => k.pelanggan_id === p.id).reduce((s, k) => s + sumQty(k.barang_keluar_item), 0) })).sort((a, b) => b.qty - a.qty);
  const perSum = AppState.masterSumber.filter(s => s.status === 'Aktif').map(s => ({ id: s.id, nama: s.nama, qty: mas.data.filter(m => m.sumber_id === s.id).reduce((a, m) => a + sumQty(m.barang_masuk_item), 0) }));

  const agg = {};
  kel.data.forEach(k => (k.barang_keluar_item || []).forEach(i => { agg[i.nama_barang] = agg[i.nama_barang] || { nama: i.nama_barang, qty: 0 }; agg[i.nama_barang].qty += num(i.jumlah); }));
  top10Data = Object.values(agg).sort((a, b) => b.qty - a.qty).slice(0, 10);

  const hariGroup = {};
  hari.data.forEach(k => { const key = k.pelanggan_nama || '-'; hariGroup[key] = hariGroup[key] || []; (k.barang_keluar_item || []).forEach(i => hariGroup[key].push(i)); });

  const insights = buildInsights({ qtyKeluar, qtyMasuk, perPel, kel: kel.data, alerts });
  const kpi = (cls, icon, label, value, btn) => `<div class="col-6 col-lg-3"><div class="kpi-card ${cls}"><i class="bi ${icon} kpi-icon"></i><div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>${btn || ''}</div></div>`;

  body.innerHTML = `
    <div class="row g-3 mb-3">
      ${kpi('kpi-purple', 'bi-box-arrow-up', 'Barang Keluar (Qty)', fmtNum(qtyKeluar))}
      ${kpi('kpi-blue', 'bi-box-arrow-in-down', 'Barang Masuk (Qty)', fmtNum(qtyMasuk))}
      ${kpi('kpi-teal', 'bi-boxes', 'Jenis Barang Berstok', fmtNum(stokAda.length), '<button class="kpi-btn" onclick="showDetailStok()">Detail</button>')}
      ${kpi(alerts.length ? 'kpi-pink' : 'kpi-green', alerts.length ? 'bi-bell-fill' : 'bi-check2-circle', 'Stok Menipis', fmtNum(alerts.length), alerts.length ? `<button class="kpi-btn" onclick="navigateTo('stok','low')">Lihat</button>` : '')}
    </div>

    ${alertCardHtml()}

    <div class="section-card mb-3"><h6><span><i class="bi bi-lightbulb text-warning"></i> Insight Otomatis</span></h6>
      <ul class="insight-list">${insights.map(i => `<li class="${i.warn ? 'warn' : ''}"><i class="bi ${i.warn ? 'bi-exclamation-triangle' : 'bi-check2-circle'}"></i><span>${i.text}</span></li>`).join('')}</ul>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-7"><div class="section-card chart-card"><h6>Top 10 Barang Terlaris (Qty)</h6><div style="position:relative;height:320px;"><canvas id="top10Chart"></canvas></div></div></div>
      <div class="col-lg-5"><div class="section-card"><h6>Transaksi Hari Ini</h6>
        ${Object.keys(hariGroup).length ? Object.entries(hariGroup).map(([n, items]) => `<div class="today-trx-card"><div class="tc-head"><span>${esc(n)}</span></div><ul>${items.map(i => `<li>${esc(labelItem(i.nama_barang, i.varian_nama))} — ${fmtNum(i.jumlah)} ${esc(i.satuan || '')}</li>`).join('')}</ul></div>`).join('') : '<p class="text-secondary small mb-0">Belum ada transaksi hari ini.</p>'}
      </div></div>
    </div>

    ${compareCardHtml()}

    <div class="row g-3">
      <div class="col-lg-6"><div class="section-card"><h6>Barang Keluar per Pelanggan</h6>
        ${perPel.length ? perPel.map(p => `<div class="mini-card"><div><div class="mc-name">${esc(p.nama)}</div><div class="mc-value">${fmtNum(p.qty)} unit</div></div><button class="mc-btn" onclick="showDetailPelanggan('${p.id}')">Detail</button></div>`).join('') : '<p class="text-secondary small mb-0">Belum ada pelanggan aktif.</p>'}
      </div></div>
      <div class="col-lg-6"><div class="section-card"><h6>Barang Masuk per Sumber</h6>
        ${perSum.length ? perSum.map(s => `<div class="mini-card"><div><div class="mc-name">${esc(s.nama)}</div><div class="mc-value">${fmtNum(s.qty)} unit</div></div><button class="mc-btn" onclick="showDetailSumber('${s.id}')">Detail</button></div>`).join('') : '<p class="text-secondary small mb-0">Belum ada sumber aktif.</p>'}
      </div></div>
    </div>`;
  renderTop10Chart();
  loadCompareChart();
}

/* ── Perbandingan barang keluar per item: bulan lalu vs bulan ini (qty) ── */
let compareData = null;
let compareOpt = { mode: 'penuh', top: 10, pelanggan: '', kategori: '' };
const katKey = b => (String((b && b.kategori) || '').trim().toUpperCase()) || '(TANPA KATEGORI)';
function kategoriList() {
  const m = new Map();
  AppState.masterBarang.forEach(b => { const k = katKey(b); if (!m.has(k)) m.set(k, k === '(TANPA KATEGORI)' ? '(Tanpa kategori)' : String(b.kategori).trim()); });
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'id'));
}
const optSel = (v, cur) => String(v) === String(cur) ? 'selected' : '';
function compareCardHtml() {
  return `<div class="section-card mb-3"><h6><span><i class="bi bi-bar-chart-steps text-success"></i> Perbandingan Barang Keluar per Item: Bulan Lalu vs Bulan Ini</span></h6>
    <div class="row g-2 mb-3">
      <div class="col-6 col-md-3"><label class="form-label small mb-1">Pembanding</label><select id="cmpMode" class="form-select form-select-sm" onchange="onCompareOpt()"><option value="penuh" ${optSel('penuh', compareOpt.mode)}>Bulan lalu penuh</option><option value="sama" ${optSel('sama', compareOpt.mode)}>Bulan lalu s/d tgl sama</option></select></div>
      <div class="col-6 col-md-3"><label class="form-label small mb-1">Pelanggan</label><select id="cmpPel" class="form-select form-select-sm" onchange="onCompareOpt()"><option value="">Semua pelanggan</option>${AppState.masterPelanggan.map(p => `<option value="${p.id}" ${optSel(p.id, compareOpt.pelanggan)}>${esc(p.nama)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label small mb-1">Jenis Barang</label><select id="cmpKat" class="form-select form-select-sm" onchange="onCompareOpt()"><option value="">Semua jenis</option>${kategoriList().map(([k, l]) => `<option value="${esc(k)}" ${optSel(k, compareOpt.kategori)}>${esc(l)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label small mb-1">Tampilkan</label><select id="cmpTop" class="form-select form-select-sm" onchange="onCompareOpt()"><option value="10" ${optSel(10, compareOpt.top)}>Top 10 item</option><option value="20" ${optSel(20, compareOpt.top)}>Top 20 item</option><option value="999" ${optSel(999, compareOpt.top)}>Semua item</option></select></div>
    </div>
    <div id="compareBody">${spinnerBlock()}</div></div>`;
}
async function loadCompareChart() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const thisStart = dateToStr(new Date(y, m, 1)), thisEnd = dateToStr(new Date(y, m + 1, 0));
  const lastStart = dateToStr(new Date(y, m - 1, 1)), lastEnd = dateToStr(new Date(y, m, 0));
  const rows = await fetchAllPages(() => sb.from('barang_keluar').select('tanggal,pelanggan_id,barang_keluar_item(barang_id,nama_barang,satuan,jumlah)').gte('tanggal', lastStart).lte('tanggal', thisEnd).order('tanggal').order('id'));
  const box = $('#compareBody'); if (!box) return;   // pengguna sudah pindah halaman
  if (!rows) { box.innerHTML = errBox('Gagal memuat data perbandingan.', 'loadCompareChart()'); return; }
  compareData = { rows, thisStart, lastStart, lastEnd, today: now.getDate(), lastLabel: `${BULAN_ID[(m + 11) % 12]} ${m === 0 ? y - 1 : y}`, thisLabel: `${BULAN_ID[m]} ${y}` };
  renderCompare();
}
function onCompareOpt() {
  compareOpt = { mode: $('#cmpMode').value, top: num($('#cmpTop').value), pelanggan: $('#cmpPel').value, kategori: $('#cmpKat').value };
  renderCompare();
}
function renderCompare() {
  const box = $('#compareBody'); if (!box || !compareData) return;
  const d = compareData, sama = compareOpt.mode === 'sama';
  const cutDay = Math.min(d.today, num(d.lastEnd.slice(8, 10)));
  const lastCut = sama ? d.lastStart.slice(0, 8) + pad(cutDay) : d.lastEnd;
  const agg = {}, bMap = new Map(AppState.masterBarang.map(b => [b.id, b]));
  d.rows.forEach(r => {
    if (compareOpt.pelanggan && r.pelanggan_id !== compareOpt.pelanggan) return;
    const ini = r.tanggal >= d.thisStart;
    if (!ini && r.tanggal > lastCut) return;
    (r.barang_keluar_item || []).forEach(i => {
      if (compareOpt.kategori && katKey(bMap.get(i.barang_id)) !== compareOpt.kategori) return;
      const e = agg[i.nama_barang] = agg[i.nama_barang] || { nama: i.nama_barang, lalu: 0, ini: 0 }; e[ini ? 'ini' : 'lalu'] += num(i.jumlah); });
  });
  const list = Object.values(agg).sort((a, b) => (b.lalu + b.ini) - (a.lalu + a.ini));
  if (!list.length) { box.innerHTML = '<p class="text-secondary small mb-0">Tidak ada barang keluar untuk filter ini pada bulan lalu maupun bulan ini.</p>'; return; }
  const pelNama = compareOpt.pelanggan ? (AppState.masterPelanggan.find(p => p.id === compareOpt.pelanggan) || {}).nama : '';
  const katLabel = compareOpt.kategori ? (kategoriList().find(([k]) => k === compareOpt.kategori) || [])[1] : '';
  const filterInfo = [pelNama && 'Pelanggan: ' + pelNama, katLabel && 'Jenis: ' + katLabel].filter(Boolean).join('  ·  ');
  const totLalu = list.reduce((s, e) => s + e.lalu, 0), totIni = list.reduce((s, e) => s + e.ini, 0);
  const pct = (a, b) => a > 0 ? ((b - a) / a * 100) : null;
  const pTot = pct(totLalu, totIni), up = totIni >= totLalu;
  const shown = list.slice(0, compareOpt.top);
  const h = Math.max(260, shown.length * 40 + 70);
  const lblLalu = d.lastLabel + (sama ? ` (s/d tgl ${cutDay})` : ''), lblIni = d.thisLabel + ' (s/d hari ini)';
  box.innerHTML = `
    <div class="row g-2 mb-3">
      <div class="col-md-4"><div class="mini-card mb-0"><div><div class="mc-name">${esc(lblLalu)}</div><div class="mc-value" style="color:#64748b">${fmtNum(totLalu)} unit</div></div></div></div>
      <div class="col-md-4"><div class="mini-card mb-0"><div><div class="mc-name">${esc(lblIni)}</div><div class="mc-value">${fmtNum(totIni)} unit</div></div></div></div>
      <div class="col-md-4"><div class="mini-card mb-0"><div><div class="mc-name">Perubahan total</div><div class="mc-value ${up ? 'text-success' : 'text-danger'}">${up ? '▲' : '▼'} ${pTot === null ? (totIni > 0 ? 'Baru' : '-') : Math.abs(pTot).toFixed(0) + '%'}</div></div></div></div>
    </div>
    ${filterInfo ? `<p class="small fw-bold text-success mb-2"><i class="bi bi-funnel-fill"></i> ${esc(filterInfo)}</p>` : ''}
    <div style="position:relative;height:${h}px;"><canvas id="compareChart"></canvas></div>
    <div class="table-responsive mt-3" style="max-height:300px;overflow:auto;"><table class="table"><thead><tr><th>Item</th><th class="text-end">Bulan Lalu</th><th class="text-end">Bulan Ini</th><th class="text-end">Selisih</th><th class="text-end">%</th></tr></thead><tbody>
      ${shown.map(e => { const sel = e.ini - e.lalu, p = pct(e.lalu, e.ini); return `<tr><td class="fw-bold">${esc(e.nama)}</td><td class="text-end">${fmtNum(e.lalu)}</td><td class="text-end">${fmtNum(e.ini)}</td><td class="text-end ${sel >= 0 ? 'text-success' : 'text-danger'}">${sel >= 0 ? '+' : '-'}${fmtNum(Math.abs(sel))}</td><td class="text-end">${p === null ? (e.ini > 0 ? 'Baru' : '-') : (sel >= 0 ? '+' : '-') + Math.abs(p).toFixed(0) + '%'}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  if (chartInstances.compare) chartInstances.compare.destroy();
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tc = dark ? '#9aa0bc' : '#6b7280', gc = dark ? '#262c47' : '#e5e7eb';
  chartInstances.compare = new Chart($('#compareChart'), {
    type: 'bar',
    data: { labels: shown.map(e => e.nama), datasets: [
      { label: lblLalu, data: shown.map(e => e.lalu), backgroundColor: '#94a3b8', borderRadius: 5 },
      { label: lblIni, data: shown.map(e => e.ini), backgroundColor: Brand.accent(), borderRadius: 5 } ] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { color: tc } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtNum(c.parsed.x)}` } } },
      scales: { x: { ticks: { color: tc, callback: v => fmtNum(v) }, grid: { color: gc } }, y: { ticks: { color: tc }, grid: { display: false } } } }
  });
}

function buildInsights({ qtyKeluar, qtyMasuk, perPel, kel, alerts }) {
  const out = [];
  if (!kel.length) out.push({ text: 'Belum ada barang keluar pada periode ini.' });
  else {
    out.push({ text: `Barang keluar periode ini <b>${fmtNum(qtyKeluar)}</b> unit dari ${fmtNum(kel.length)} transaksi; barang masuk <b>${fmtNum(qtyMasuk)}</b> unit.` });
    const top = perPel[0];
    if (top && top.qty > 0 && qtyKeluar > 0) out.push({ text: `Pelanggan dengan barang keluar terbanyak: <b>${esc(top.nama)}</b> (${(top.qty / qtyKeluar * 100).toFixed(0)}% dari total qty).` });
    if (top10Data[0]) out.push({ text: `Barang terlaris: <b>${esc(top10Data[0].nama)}</b> (${fmtNum(top10Data[0].qty)} unit).` });
  }
  if (alerts.length) {
    const habis = alerts.filter(a => a.stok <= 0).length;
    out.push({ text: `<b>${alerts.length}</b> item stoknya sudah di bawah atau sama dengan batas minimum${habis ? `, ${habis} di antaranya habis` : ''}.`, warn: true });
  }
  return out;
}

function renderTop10Chart() {
  const cv = $('#top10Chart'); if (!cv) return;
  if (chartInstances.top10) chartInstances.top10.destroy();
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tc = dark ? '#9aa0bc' : '#6b7280', gc = dark ? '#262c47' : '#e5e7eb';
  chartInstances.top10 = new Chart(cv, {
    type: 'bar',
    data: { labels: top10Data.map(i => i.nama), datasets: [{ label: 'Qty', data: top10Data.map(i => i.qty), backgroundColor: Brand.accent(), borderRadius: 6 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: tc }, grid: { color: gc } }, y: { ticks: { color: tc }, grid: { display: false } } } }
  });
}

function aggItems(rows, itemKey) {
  const a = {};
  rows.forEach(r => (r[itemKey] || []).forEach(i => { const k = labelItem(i.nama_barang, i.varian_nama); a[k] = a[k] || { nama: k, satuan: i.satuan, qty: 0 }; a[k].qty += num(i.jumlah); }));
  return Object.values(a).sort((x, y) => y.qty - x.qty);
}
function showDetailPelanggan(id) {
  const p = AppState.masterPelanggan.find(x => x.id === id);
  const list = aggItems(dashData.keluar.filter(k => k.pelanggan_id === id), 'barang_keluar_item');
  showDetail('Detail Barang Keluar — ' + (p ? p.nama : ''), `<p class="small text-secondary">Periode ${tglSingkat(dashData.from)} – ${tglSingkat(dashData.to)}</p>` +
    (list.length ? `<div class="table-responsive"><table class="table"><thead><tr><th>Barang</th><th class="text-end">Qty</th></tr></thead><tbody>${list.map(i => `<tr><td>${esc(i.nama)}</td><td class="text-end">${fmtNum(i.qty)} ${esc(i.satuan || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-secondary">Tidak ada transaksi.</p>'));
}
function showDetailSumber(id) {
  const s = AppState.masterSumber.find(x => x.id === id);
  const list = aggItems(dashData.masuk.filter(m => m.sumber_id === id), 'barang_masuk_item');
  showDetail('Detail Barang Masuk — ' + (s ? s.nama : ''), `<p class="small text-secondary">Periode ${tglSingkat(dashData.from)} – ${tglSingkat(dashData.to)}</p>` +
    (list.length ? `<div class="table-responsive"><table class="table"><thead><tr><th>Barang</th><th class="text-end">Qty</th></tr></thead><tbody>${list.map(i => `<tr><td>${esc(i.nama)}</td><td class="text-end">${fmtNum(i.qty)} ${esc(i.satuan || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-secondary">Tidak ada barang masuk.</p>'));
}
function showDetailStok() {
  const rows = [];
  AppState.masterBarang.forEach(b => {
    const vs = variansOf(b.id);
    if (vs.length) vs.forEach(v => { if (num(v.stok) > 0) rows.push({ nama: labelItem(b.nama, v.nama), stok: v.stok, satuan: b.satuan }); });
    else if (num(b.stok) > 0) rows.push({ nama: b.nama, stok: b.stok, satuan: b.satuan });
  });
  showDetail('Barang Berstok', `<div class="table-responsive"><table class="table"><thead><tr><th>Barang</th><th class="text-end">Stok</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.nama)}</td><td class="text-end">${fmtNum(r.stok)} ${esc(r.satuan || '')}</td></tr>`).join('') || '<tr><td colspan="2" class="text-center text-secondary py-3">Belum ada stok.</td></tr>'}</tbody></table></div>`);
}

/* ───────────────────────── BUILDER ITEM (kasir & barang masuk) ───────────────────────── */
function barangOptions(selectedId) {
  const list = AppState.masterBarang.filter(b => b.status === 'Aktif' || b.id === selectedId);
  return '<option value="">-- Pilih Barang --</option>' + list.map(b =>
    `<option value="${b.id}" ${b.id === selectedId ? 'selected' : ''}>${b.kode ? esc(b.kode) + ' · ' : ''}${esc(b.nama)}${b.merk ? ' · ' + esc(b.merk) : ''} (Stok: ${fmtNum(b.stok)})</option>`).join('');
}
function varianOptions(barangId, selectedId) {
  const list = variansOf(barangId).filter(v => v.status === 'Aktif' || v.id === selectedId);
  return '<option value="">-- Pilih Varian --</option>' + list.map(v =>
    `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${esc(v.nama)} (Stok: ${fmtNum(v.stok)})</option>`).join('');
}
function itemRowHtml(it) {
  const hasV = !!(it && it.barang_id && variansOf(it.barang_id).length);
  return `<div class="item-row">
    <div class="flex-2"><select class="form-select form-select-sm r-barang" onchange="onRowChange(this)">${barangOptions(it && it.barang_id)}</select></div>
    <div class="flex-1 r-varian-wrap" style="${hasV ? '' : 'display:none'}"><select class="form-select form-select-sm r-varian" onchange="onRowChange(this)">${hasV ? varianOptions(it.barang_id, it.varian_id) : ''}</select></div>
    <div class="flex-1 r-qty-wrap"><input type="number" min="0.01" step="any" class="form-control form-control-sm r-qty" placeholder="Qty" value="${it ? esc(it.jumlah) : ''}" oninput="onRowChange(this)"></div>
    <button type="button" class="action-btn delete" onclick="removeRow(this)"><i class="bi bi-trash"></i></button>
    <div class="stok-hint"></div>
  </div>`;
}
function onRowChange(el) {
  const row = el.closest('.item-row'), sel = row.querySelector('.r-barang');
  if (el === sel) {
    const vsel = row.querySelector('.r-varian'), wrap = row.querySelector('.r-varian-wrap');
    if (sel.value && variansOf(sel.value).length) { wrap.style.display = ''; vsel.innerHTML = varianOptions(sel.value); }
    else { wrap.style.display = 'none'; vsel.innerHTML = ''; }
  }
  updateStokHint(row);
}
function updateStokHint(row) {
  const hint = row.querySelector('.stok-hint'); hint.textContent = '';
  if (!isKeluar) return;
  const bid = row.querySelector('.r-barang').value; if (!bid) return;
  const qty = num(row.querySelector('.r-qty').value), b = AppState.masterBarang.find(x => x.id === bid);
  let stok = b ? num(b.stok) : 0;
  if (variansOf(bid).length) {
    const vid = row.querySelector('.r-varian').value; if (!vid) return;
    const v = AppState.masterVarian.find(x => x.id === vid); stok = v ? num(v.stok) : 0;
  }
  if (qty > stok) hint.textContent = `Qty melebihi stok tersedia (${fmtNum(stok)}).`;
}
function removeRow(btn) { btn.closest('.item-row').remove(); }
function addRow() { $('.item-list').insertAdjacentHTML('beforeend', itemRowHtml(null)); }
function collectItems() {
  const items = [];
  for (const r of document.querySelectorAll('.item-list .item-row')) {
    const id = r.querySelector('.r-barang').value, q = num(r.querySelector('.r-qty').value), vid = r.querySelector('.r-varian').value;
    if (!id && !q) continue;
    if (!id || q <= 0) { showToast('Validasi', 'Setiap baris harus punya barang dan qty > 0.', 'warning'); return null; }
    if (variansOf(id).length && !vid) { const b = AppState.masterBarang.find(x => x.id === id); showToast('Validasi', `Pilih varian untuk "${b ? b.nama : 'barang'}".`, 'warning'); return null; }
    items.push({ barang_id: id, varian_id: vid || null, jumlah: q });
  }
  if (!items.length) { showToast('Validasi', 'Tambahkan minimal satu barang.', 'warning'); return null; }
  return items;
}

/* ── Pencarian cepat: kode (BRG001 / "BRG 001" / "brg"), nama, atau nama varian ── */
const normKode = s => String(s || '').toLowerCase().replace(/[\s\-_.\/]/g, '');
function kasirMatches(q) {
  const nq = normKode(q); if (!nq) return [];
  const tokens = String(q).toLowerCase().split(/\s+/).filter(Boolean), out = [];
  AppState.masterBarang.forEach(b => {
    if (b.status !== 'Aktif') return;
    const k = normKode(b.kode), n = (String(b.nama) + ' ' + String(b.merk || '')).toLowerCase(); let score = 0;
    if (k && k === nq) score = 100; else if (k && k.startsWith(nq)) score = 80; else if (k && k.includes(nq)) score = 60;
    else if (tokens.every(t => n.includes(t))) score = 40; else if (normKode(b.nama + ' ' + (b.merk || '')).includes(nq)) score = 30;
    else if (variansOf(b.id).some(v => normKode(v.nama).includes(nq))) score = 20;
    if (score) out.push({ b, score });
  });
  return out.sort((a, b) => b.score - a.score || a.b.nama.localeCompare(b.b.nama, 'id')).slice(0, 8).map(x => x.b);
}
const fotoThumb = b => b.foto_url ? `<img src="${esc(b.foto_url)}" class="thumb" loading="lazy" alt="">` : '<div class="thumb thumb-empty"><i class="bi bi-image"></i></div>';
function kasirSearchHtml() {
  return `<div class="mb-3"><label class="form-label">Cari Barang (kode atau nama)</label>
      <div class="input-group"><span class="input-group-text"><i class="bi bi-search"></i></span><input id="kSearch" class="form-control" placeholder="Ketik kode, mis. BRG001 atau BRG 001 — Enter untuk menambah" autocomplete="off" oninput="kasirSearch()" onkeydown="kasirSearchKey(event)"></div>
      <div id="kResults" class="k-results" style="display:none"></div></div>`;
}
function kasirSearch() {
  const box = $('#kResults'), q = $('#kSearch').value;
  if (!q.trim()) { box.style.display = 'none'; return; }
  const list = kasirMatches(q); box.style.display = 'block';
  box.innerHTML = list.length ? list.map((b, i) => { const nv = variansOf(b.id).length; return `<div class="k-result ${i === 0 ? 'first' : ''}" onclick="kasirPick('${b.id}')">${fotoThumb(b)}<div class="flex-grow-1"><div class="fw-bold small">${b.kode ? `<span class="k-kode">${esc(b.kode)}</span> ` : ''}${esc(b.nama)}</div><div class="small ${num(b.stok) <= 0 ? 'text-danger' : 'text-secondary'}">${b.merk ? esc(b.merk) + ' · ' : ''}Stok ${fmtNum(b.stok)} ${esc(b.satuan)}${nv ? ` · ${nv} varian` : ''}</div></div><i class="bi bi-plus-circle-fill text-success fs-5"></i></div>`; }).join('') : '<div class="small text-secondary p-2">Tidak ditemukan.</div>';
}
function kasirSearchKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); const l = kasirMatches($('#kSearch').value); if (l[0]) kasirPick(l[0].id); }
  else if (e.key === 'Escape') { $('#kSearch').value = ''; kasirSearch(); }
}
function kasirPick(id) { kasirAddBarang(id); $('#kSearch').value = ''; kasirSearch(); }
function kasirAddBarang(id, vid) {
  const list = $('.item-list'), rows = [...list.querySelectorAll('.item-row')], hasV = variansOf(id).length > 0;
  let row = rows.find(r => r.querySelector('.r-barang').value === id && (r.querySelector('.r-varian').value || '') === (vid || ''));
  if (row) {
    if (hasV && !vid) { flashRow(row); row.querySelector('.r-varian').focus(); return; }
    const q = row.querySelector('.r-qty'); q.value = num(q.value) + 1; onRowChange(q); flashRow(row); return;
  }
  row = rows.find(r => !r.querySelector('.r-barang').value && !r.querySelector('.r-qty').value);
  if (!row) { list.insertAdjacentHTML('beforeend', itemRowHtml(null)); row = list.lastElementChild; }
  const sel = row.querySelector('.r-barang'); sel.value = id; onRowChange(sel);
  if (vid) row.querySelector('.r-varian').value = vid;
  row.querySelector('.r-qty').value = 1; updateStokHint(row); flashRow(row);
  if (hasV && !vid) row.querySelector('.r-varian').focus(); else { const s = $('#kSearch'); if (s) s.focus(); }
}
function flashRow(row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 800); }

/* ───────────────────────── KASIR (BARANG KELUAR) ───────────────────────── */
PAGES.kasir = function (rec) {
  isKeluar = true;
  const edit = rec && rec.id ? rec : null; kasirEditId = edit ? edit.id : null;
  const pel = AppState.masterPelanggan.filter(p => p.status === 'Aktif' || (edit && p.id === edit.pihak_id));
  $('#app-container').innerHTML = `<div class="section-card">
    ${edit ? '<div class="alert alert-warning py-2 small"><i class="bi bi-pencil-square"></i> Mode edit transaksi. Stok akan dikoreksi otomatis saat disimpan.</div>' : ''}
    <div class="row g-3 mb-3">
      <div class="col-md-4"><label class="form-label">Tanggal</label><input type="date" id="kTanggal" class="form-control" value="${edit ? edit.tanggal : todayStr()}"></div>
      <div class="col-md-8"><label class="form-label">Pelanggan</label><select id="kPelanggan" class="form-select" onchange="loadLangganan(this.value)"><option value="">-- Pilih Pelanggan --</option>${pel.map(p => `<option value="${p.id}" ${edit && edit.pihak_id === p.id ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}</select></div>
    </div>
    <div id="kLangganan" class="mb-3"></div>
    ${kasirSearchHtml()}
    <label class="form-label">Item Barang</label>
    <div class="item-list">${edit ? edit.items.map(itemRowHtml).join('') : itemRowHtml(null)}</div>
    <button class="btn btn-outline-accent btn-sm mb-3" onclick="addRow()"><i class="bi bi-plus-lg"></i> Tambah Barang</button>
    <div class="mb-3"><label class="form-label">Catatan</label><input type="text" id="kCatatan" class="form-control" value="${edit ? esc(edit.catatan || '') : ''}"></div>
    <div class="text-end">${edit ? '<button class="btn btn-secondary me-2" onclick="navigateTo(\'riwayat\')">Batal</button>' : ''}<button class="btn btn-accent px-4" id="kSimpan" onclick="submitKasir()"><i class="bi bi-check2-circle"></i> ${edit ? 'Simpan Perubahan' : 'Simpan Transaksi'}</button></div>
  </div>`;
  if (edit && edit.pihak_id) loadLangganan(edit.pihak_id);
};
/* ── Barang langganan per pelanggan (paling sering dikirim, termasuk varian) ── */
const langgananCache = {};
async function loadLangganan(pelId) {
  const box = $('#kLangganan'); if (!box) return;
  if (!pelId) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="small text-secondary">Memuat barang langganan...</div>';
  if (!langgananCache[pelId]) {
    const r = await callSb(sb.from('barang_keluar').select('barang_keluar_item(barang_id,varian_id,jumlah)').eq('pelanggan_id', pelId).order('tanggal', { ascending: false }).order('created_at', { ascending: false }).limit(150), null, { silent: true });
    if (!r.success) { box.innerHTML = ''; return; }
    const agg = {};
    r.data.forEach(t => {
      const seen = new Set();
      (t.barang_keluar_item || []).forEach(i => {
        if (!i.barang_id) return;
        const key = i.barang_id + '|' + (i.varian_id || '');
        const a = agg[key] = agg[key] || { bid: i.barang_id, vid: i.varian_id || '', kali: 0, qty: 0 };
        a.qty += num(i.jumlah); if (!seen.has(key)) { a.kali++; seen.add(key); }
      });
    });
    langgananCache[pelId] = Object.values(agg).sort((a, b) => b.kali - a.kali || b.qty - a.qty);
  }
  if (!$('#kLangganan') || $('#kPelanggan').value !== pelId) return;   // pelanggan sudah diganti saat memuat
  const bMap = new Map(AppState.masterBarang.map(b => [b.id, b])), vMap = new Map(AppState.masterVarian.map(v => [v.id, v]));
  const top = langgananCache[pelId].map(a => ({ a, b: bMap.get(a.bid), v: a.vid ? vMap.get(a.vid) : null }))
    .filter(x => x.b && x.b.status === 'Aktif' && (!x.a.vid || (x.v && x.v.status === 'Aktif'))).slice(0, 6);
  const pel = AppState.masterPelanggan.find(p => p.id === pelId);
  box.innerHTML = top.length ? `<div class="langganan"><div class="small fw-bold mb-2"><i class="bi bi-star-fill text-warning"></i> Langganan ${esc(pel ? pel.nama : '')} <span class="text-secondary fw-normal">— ketuk untuk menambah</span></div><div class="lg-grid">${top.map(({ a, b, v }) => { const stok = v ? v.stok : b.stok; return `<div class="lg-item" onclick="kasirAddBarang('${b.id}','${a.vid}')">${fotoThumb(b)}<div><div class="lg-nama">${b.kode ? `<span class="k-kode">${esc(b.kode)}</span> ` : ''}${esc(labelItem(b.nama, v && v.nama))}</div><div class="small ${num(stok) <= 0 ? 'text-danger' : 'text-secondary'}">${a.kali}× dikirim · stok ${fmtNum(stok)}</div></div></div>`; }).join('')}</div></div>`
    : '<div class="small text-secondary">Belum ada riwayat pengiriman untuk pelanggan ini.</div>';
}
async function submitKasir() {
  const pel = $('#kPelanggan').value, tgl = $('#kTanggal').value;
  if (!tgl || !pel) return showToast('Validasi', 'Tanggal dan pelanggan wajib diisi.', 'warning');
  const items = collectItems(); if (!items) return;
  const wasEdit = !!kasirEditId;
  const btn = $('#kSimpan'); setBtnBusy(btn, true, 'Menyimpan...');
  const r = await callSb(sb.rpc('simpan_barang_keluar', { p_id: kasirEditId, p_tanggal: tgl, p_pelanggan_id: pel, p_catatan: $('#kCatatan').value.trim() || null, p_items: items }), wasEdit ? 'Transaksi diperbarui.' : 'Transaksi tersimpan.');
  setBtnBusy(btn, false);
  if (r.success) { await loadMasterCaches(); kasirEditId = null; navigateTo(wasEdit ? 'riwayat' : 'kasir'); const al = stokAlerts().filter(a => items.some(i => i.barang_id === a.barang.id)); if (al.length) showToast('Stok menipis', al.slice(0, 3).map(a => labelItem(a.nama, a.varianNama) + ' (sisa ' + fmtNum(a.stok) + ')').join(', '), 'warning'); }
}

/* ───────────────────────── BARANG MASUK ───────────────────────── */
PAGES.barangMasuk = function (rec) {
  isKeluar = false;
  const edit = rec && rec.id ? rec : null; masukEditId = edit ? edit.id : null;
  const sum = AppState.masterSumber.filter(s => s.status === 'Aktif' || (edit && s.id === edit.pihak_id));
  $('#app-container').innerHTML = `<div class="section-card">
    ${edit ? '<div class="alert alert-warning py-2 small"><i class="bi bi-pencil-square"></i> Mode edit barang masuk. Stok akan dikoreksi otomatis saat disimpan.</div>' : ''}
    <div class="row g-3 mb-3">
      <div class="col-md-4"><label class="form-label">Tanggal</label><input type="date" id="mTanggal" class="form-control" value="${edit ? edit.tanggal : todayStr()}"></div>
      <div class="col-md-8"><label class="form-label">Sumber</label><select id="mSumber" class="form-select"><option value="">-- Pilih Sumber --</option>${sum.map(s => `<option value="${s.id}" ${edit && edit.pihak_id === s.id ? 'selected' : ''}>${esc(s.nama)}</option>`).join('')}</select></div>
    </div>
    ${kasirSearchHtml()}
    <label class="form-label">Item Barang</label>
    <div class="item-list">${edit ? edit.items.map(itemRowHtml).join('') : itemRowHtml(null)}</div>
    <button class="btn btn-outline-accent btn-sm mb-3" onclick="addRow()"><i class="bi bi-plus-lg"></i> Tambah Barang</button>
    <div class="mb-3"><label class="form-label">Catatan</label><input type="text" id="mCatatan" class="form-control" value="${edit ? esc(edit.catatan || '') : ''}"></div>
    <div class="text-end">${edit ? '<button class="btn btn-secondary me-2" onclick="navigateTo(\'riwayat\')">Batal</button>' : ''}<button class="btn btn-accent px-4" id="mSimpan" onclick="submitMasuk()"><i class="bi bi-check2-circle"></i> ${edit ? 'Simpan Perubahan' : 'Simpan Barang Masuk'}</button></div>
  </div>`;
};
async function submitMasuk() {
  const sum = $('#mSumber').value, tgl = $('#mTanggal').value;
  if (!tgl || !sum) return showToast('Validasi', 'Tanggal dan sumber wajib diisi.', 'warning');
  const items = collectItems(); if (!items) return;
  const wasEdit = !!masukEditId;
  const btn = $('#mSimpan'); setBtnBusy(btn, true, 'Menyimpan...');
  const r = await callSb(sb.rpc('simpan_barang_masuk', { p_id: masukEditId, p_tanggal: tgl, p_sumber_id: sum, p_catatan: $('#mCatatan').value.trim() || null, p_items: items }), wasEdit ? 'Barang masuk diperbarui.' : 'Barang masuk tersimpan.');
  setBtnBusy(btn, false);
  if (r.success) { await loadMasterCaches(); masukEditId = null; navigateTo(wasEdit ? 'riwayat' : 'barangMasuk'); }
}

/* ───────────────────────── STOK & MASTER BARANG ───────────────────────── */
const merkKey = b => (String((b && b.merk) || '').trim().toUpperCase()) || '(TANPA MERK)';
/* Nilai unik (merk / kategori) beserta jumlah barang; urut abjad, "tanpa ..." di paling akhir */
function facetList(keyFn, field, emptyKey, emptyLabel) {
  const m = new Map();
  AppState.masterBarang.forEach(b => {
    const k = keyFn(b), e = m.get(k) || { key: k, label: k === emptyKey ? emptyLabel : String(b[field]).trim(), n: 0 };
    e.n++; m.set(k, e);
  });
  return [...m.values()].sort((x, y) => (x.key === emptyKey) - (y.key === emptyKey) || x.label.localeCompare(y.label, 'id'));
}
const merkList = () => facetList(merkKey, 'merk', '(TANPA MERK)', '(Tanpa merk)');
const kategoriFacet = () => facetList(katKey, 'kategori', '(TANPA KATEGORI)', '(Tanpa kategori)');

PAGES.stok = function (arg) {
  if (arg === 'low') stokOnlyLow = true;
  $('#app-container').innerHTML = `<div class="section-card">
    <div class="row g-2 align-items-end mb-3">
      <div class="col-12 col-lg-3"><label class="form-label small mb-1">Cari</label><input type="search" id="stokSearch" class="form-control" placeholder="Kode, nama, merk, kategori..." oninput="renderStokTable()"></div>
      <div class="col-6 col-lg-2"><label class="form-label small mb-1">Merk</label><select id="stokMerk" class="form-select" onchange="stokMerk = this.value; renderStokTable()"></select></div>
      <div class="col-6 col-lg-2"><label class="form-label small mb-1">Kategori</label><select id="stokKat" class="form-select" onchange="stokKat = this.value; renderStokTable()"></select></div>
      <div class="col-6 col-lg-2"><label class="form-label small mb-1">Stok</label><select id="stokFilter" class="form-select" onchange="stokOnlyLow = this.value === 'low'; renderStokTable()"><option value="all" ${stokOnlyLow ? '' : 'selected'}>Semua stok</option><option value="low" ${stokOnlyLow ? 'selected' : ''}>Stok menipis saja</option></select></div>
      <div class="col-6 col-lg-auto"><button class="btn btn-outline-accent w-100" onclick="resetStokFilter()"><i class="bi bi-x-circle"></i> Reset</button></div>
      <div class="col-12 col-lg-auto ms-lg-auto"><button class="btn btn-accent w-100" onclick="openBarangForm()"><i class="bi bi-plus-lg"></i> Tambah Barang</button></div>
    </div><div id="stokTable"></div></div>`;
  renderStokTable();
};
/* Isi ulang pilihan Merk & Kategori dari data terbaru (dengan jumlah barang), pilihan aktif dipertahankan */
function refreshStokFilterOptions() {
  const fill = (id, list, cur, allLabel) => {
    const el = $('#' + id); if (!el) return cur;
    if (cur && !list.some(x => x.key === cur)) cur = '';          // nilai sudah tidak ada (mis. barang diedit)
    const html = `<option value="">${allLabel}</option>` + list.map(x => `<option value="${esc(x.key)}">${esc(x.label)} (${x.n})</option>`).join('');
    if (el.dataset.sig !== html) { el.innerHTML = html; el.dataset.sig = html; }
    el.value = cur; return cur;
  };
  stokMerk = fill('stokMerk', merkList(), stokMerk, 'Semua merk');
  stokKat = fill('stokKat', kategoriFacet(), stokKat, 'Semua kategori');
}
function resetStokFilter() {
  stokMerk = ''; stokKat = ''; stokOnlyLow = false;
  if ($('#stokSearch')) $('#stokSearch').value = '';
  if ($('#stokFilter')) $('#stokFilter').value = 'all';
  renderStokTable();
}
function renderStokTable() {
  refreshStokFilterOptions();
  const q = ($('#stokSearch') ? $('#stokSearch').value : '').trim().toLowerCase();
  const list = AppState.masterBarang.filter(b => {
    if (q && ![b.nama, b.kode, b.merk, b.kategori].some(x => String(x || '').toLowerCase().includes(q))) return false;
    if (stokMerk && merkKey(b) !== stokMerk) return false;
    if (stokKat && katKey(b) !== stokKat) return false;
    if (stokOnlyLow && !barangLow(b)) return false;
    return true;
  });
  const filtered = !!(q || stokMerk || stokKat || stokOnlyLow);
  const varChips = b => variansOf(b.id).map(v => `<span class="vchip ${v.status !== 'Aktif' ? 'off' : isLow(v.stok, v.min_stok) ? 'low' : ''}" title="${v.min_stok > 0 ? 'Minimum ' + fmtNum(v.min_stok) : 'Tanpa batas minimum'}">${esc(v.nama)}: ${fmtNum(v.stok)}</span>`).join('');
  $('#stokTable').innerHTML = `<div class="small text-secondary mb-2">${filtered ? `Menampilkan <b>${fmtNum(list.length)}</b> dari ${fmtNum(AppState.masterBarang.length)} barang` : `${fmtNum(list.length)} barang`}</div>
  <div class="table-responsive"><table class="table"><thead><tr><th>Foto</th><th>Kode</th><th>Nama</th><th>Merk</th><th>Kategori</th><th>Satuan</th><th class="text-end">Stok</th><th class="text-end">Stok Min.</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
    ${list.map(b => { const vs = variansOf(b.id), low = barangLow(b); return `<tr><td>${b.foto_url ? `<img src="${esc(b.foto_url)}" class="thumb" loading="lazy" onclick="showFoto('${b.id}')" alt="">` : '<div class="thumb thumb-empty"><i class="bi bi-image"></i></div>'}</td><td>${esc(b.kode || '-')}</td><td><div class="fw-bold">${esc(b.nama)}</div>${vs.length ? `<div class="vchips">${varChips(b)}</div>` : ''}</td><td>${esc(b.merk || '-')}</td><td>${esc(b.kategori || '-')}</td><td>${esc(b.satuan)}</td><td class="text-end"><span class="badge-status ${low || num(b.stok) <= 0 ? 'badge-low' : 'badge-ok'}">${fmtNum(b.stok)}</span></td><td class="text-end">${vs.length ? '<span class="text-secondary small">per varian</span>' : (num(b.min_stok) > 0 ? fmtNum(b.min_stok) : '-')}</td><td>${badgeStatus(b.status)}</td><td><button class="action-btn edit" onclick="openBarangForm('${b.id}')"><i class="bi bi-pencil"></i></button><button class="action-btn delete" onclick="deleteBarang('${b.id}')"><i class="bi bi-trash"></i></button></td></tr>`; }).join('') || `<tr><td colspan="10" class="text-center text-secondary py-4">${filtered ? 'Tidak ada barang yang cocok dengan filter.' : 'Belum ada barang.'}</td></tr>`}
  </tbody></table></div>`;
}

/* ── Form barang + editor varian ── */
function varianRowHtml(v) {
  const ex = !!(v && v.id);
  return `<div class="varian-row" data-id="${ex ? v.id : ''}">
    <input class="form-control form-control-sm v-nama" placeholder="Nama varian (mis. Merah / XL)" value="${esc(v ? v.nama : '')}">
    <input type="number" step="any" class="form-control form-control-sm v-stok" placeholder="Stok awal" title="${ex ? 'Stok diubah lewat transaksi' : 'Stok awal'}" value="${v && v.stok != null ? num(v.stok) : ''}" ${ex ? 'disabled' : ''}>
    <input type="number" min="0" step="any" class="form-control form-control-sm v-min" placeholder="Stok min." title="Stok minimum (pengingat)" value="${v && num(v.min_stok) > 0 ? num(v.min_stok) : ''}">
    ${ex ? `<select class="form-select form-select-sm v-status"><option ${v.status === 'Nonaktif' ? '' : 'selected'}>Aktif</option><option ${v.status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option></select>` : ''}
    <button type="button" class="action-btn delete" onclick="this.closest('.varian-row').remove()" title="Hapus varian"><i class="bi bi-trash"></i></button>
  </div>`;
}
function addVarianRow(v) { $('#fbVarianList').insertAdjacentHTML('beforeend', varianRowHtml(v)); }
function toggleVarianEditor(editId) {
  const on = $('#fbVarianOn').checked;
  $('#fbVarianBox').style.display = on ? '' : 'none';
  $('#fbStokWrap').style.display = on ? 'none' : '';
  $('#fbMinWrap').style.display = on ? 'none' : '';
  if (on && !$('#fbVarianList').children.length) {
    const b = editId ? AppState.masterBarang.find(x => x.id === editId) : null;
    // barang lama yang sudah punya stok: stoknya dipindah ke varian pertama agar tidak hilang
    addVarianRow(b && num(b.stok) !== 0 ? { nama: 'Standar', stok: num(b.stok), min_stok: num(b.min_stok) } : null);
    if (!b || num(b.stok) === 0) addVarianRow(null);
  }
}
function openBarangForm(id) {
  fbFotoBlob = null;
  const b = id ? AppState.masterBarang.find(x => x.id === id) : null;
  const vs = b ? variansOf(b.id) : [], hasV = vs.length > 0;
  showForm(b ? 'Edit Barang' : 'Tambah Barang', `<div class="row g-3">
    <div class="col-md-4"><label class="form-label">Kode Item</label><input id="fbKode" class="form-control" placeholder="mis. BRG001" value="${esc(b ? b.kode || '' : '')}"></div>
    <div class="col-md-8"><label class="form-label">Nama Barang *</label><input id="fbNama" class="form-control" value="${esc(b ? b.nama : '')}"></div>
    <div class="col-md-4"><label class="form-label">Merk</label><input id="fbMerk" class="form-control" list="dlMerk" placeholder="mis. Honda" autocomplete="off" value="${esc(b ? b.merk || '' : '')}"></div>
    <div class="col-md-4"><label class="form-label">Kategori</label><input id="fbKategori" class="form-control" list="dlKat" autocomplete="off" value="${esc(b ? b.kategori || '' : '')}"></div>
    <div class="col-md-4"><label class="form-label">Satuan</label><input id="fbSatuan" class="form-control" value="${esc(b ? b.satuan : 'PCS')}"></div>
    <datalist id="dlMerk">${merkList().filter(x => x.key !== '(TANPA MERK)').map(x => `<option value="${esc(x.label)}">`).join('')}</datalist>
    <datalist id="dlKat">${kategoriFacet().filter(x => x.key !== '(TANPA KATEGORI)').map(x => `<option value="${esc(x.label)}">`).join('')}</datalist>
    <div class="col-md-4" id="fbStokWrap" style="${hasV ? 'display:none' : ''}"><label class="form-label">${b ? 'Stok (ubah lewat transaksi)' : 'Stok Awal'}</label><input id="fbStok" type="number" step="any" class="form-control" value="${b ? num(b.stok) : 0}" ${b ? 'disabled' : ''}></div>
    <div class="col-md-4" id="fbMinWrap" style="${hasV ? 'display:none' : ''}"><label class="form-label">Stok Minimum (pengingat)</label><input id="fbMin" type="number" min="0" step="any" class="form-control" placeholder="0 = tanpa pengingat" value="${b && num(b.min_stok) > 0 ? num(b.min_stok) : ''}"></div>
    <div class="col-md-4"><label class="form-label">Status</label><select id="fbStatus" class="form-select"><option ${b && b.status === 'Nonaktif' ? '' : 'selected'}>Aktif</option><option ${b && b.status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option></select></div>
    <div class="col-12"><div class="langganan">
      <div class="form-check form-switch mb-1"><input class="form-check-input" type="checkbox" role="switch" id="fbVarianOn" ${hasV ? 'checked disabled' : ''} onchange="toggleVarianEditor('${id || ''}')"><label class="form-check-label fw-bold" for="fbVarianOn">Barang ini punya varian (warna, ukuran, dll.)</label></div>
      <div class="small text-secondary mb-2">Stok dan stok minimum dicatat <b>per varian</b>; stok barang = jumlah semua varian. ${hasV ? 'Varian tidak bisa dimatikan; nonaktifkan varian yang tidak dipakai.' : 'Barang yang sudah punya stok: stoknya dipindahkan ke varian pertama.'}</div>
      <div id="fbVarianBox" style="${hasV ? '' : 'display:none'}">
        <div class="varian-head"><span>Nama varian</span><span>Stok awal</span><span>Stok min.</span><span></span></div>
        <div id="fbVarianList">${vs.map(varianRowHtml).join('')}</div>
        <button type="button" class="btn btn-outline-accent btn-sm mt-1" onclick="addVarianRow()"><i class="bi bi-plus-lg"></i> Tambah Varian</button>
      </div></div></div>
    <div class="col-12"><label class="form-label">Foto Barang</label><div class="d-flex gap-3 align-items-center flex-wrap">
      <img id="fbFotoPrev" class="thumb-lg" alt="" src="${b && b.foto_url ? esc(b.foto_url) : ''}" style="${b && b.foto_url ? '' : 'display:none'}">
      <div><input type="file" id="fbFotoFile" accept="image/*" class="form-control form-control-sm" onchange="onFotoPicked(this)">
        <div class="small text-secondary mt-1" id="fbFotoInfo">Foto otomatis dikompres (maks. 1 MB) agar tetap jelas dan ringan.</div>
        ${b && b.foto_url ? '<div class="form-check mt-1"><input class="form-check-input" type="checkbox" id="fbFotoHapus"><label class="form-check-label small" for="fbFotoHapus">Hapus foto saat ini</label></div>' : ''}</div></div></div>
    <div class="col-12 text-end"><button class="btn btn-secondary me-2" data-bs-dismiss="modal">Batal</button><button class="btn btn-accent" id="fbSimpan" onclick="saveBarang('${id || ''}')">Simpan</button></div>
  </div>`);
}
/* ── Foto barang: kompres otomatis (maks. ~1 MB) lalu unggah ke Storage ── */
let fbFotoBlob = null;
const ukuranFile = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
async function kompresFoto(file, maxBytes = 950 * 1024) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  let scale = Math.min(1, 1280 / Math.max(w0, h0)), q = 0.86, blob = null;
  for (let i = 0; i < 14; i++) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= maxBytes) return blob;
    if (q > 0.62) q -= 0.08; else scale *= 0.85;
  }
  if (blob && blob.size <= 1048576) return blob;
  throw new Error('Gambar terlalu besar');
}
async function onFotoPicked(inp) {
  const f = inp.files[0], info = $('#fbFotoInfo'); fbFotoBlob = null; if (!f) return;
  if (!/^image\//.test(f.type)) { info.textContent = 'File harus berupa gambar.'; inp.value = ''; return; }
  info.textContent = 'Mengompres foto...';
  try {
    fbFotoBlob = await kompresFoto(f);
    const prev = $('#fbFotoPrev'); prev.src = URL.createObjectURL(fbFotoBlob); prev.style.display = '';
    info.innerHTML = `Dikompres: <b>${ukuranFile(f.size)}</b> → <b>${ukuranFile(fbFotoBlob.size)}</b>. Klik Simpan untuk mengunggah.`;
  } catch (e) { info.textContent = 'Gagal memproses gambar. Coba file JPG/PNG lain.'; inp.value = ''; }
}
function showFoto(id) { const b = AppState.masterBarang.find(x => x.id === id); if (b && b.foto_url) showDetail(b.nama, `<img src="${esc(b.foto_url)}" class="img-fluid rounded w-100" alt="${esc(b.nama)}">`); }

function readVarianRows() {
  const out = [];
  for (const r of document.querySelectorAll('#fbVarianList .varian-row')) {
    const id = r.dataset.id || null, nama = r.querySelector('.v-nama').value.trim();
    if (!nama && !id) continue;                       // baris baru yang kosong diabaikan
    const st = r.querySelector('.v-status');
    out.push({ id, nama, stok: num(r.querySelector('.v-stok').value), min: Math.max(0, num(r.querySelector('.v-min').value)), status: st ? st.value : 'Aktif' });
  }
  return out;
}

async function saveBarang(id) {
  const g = i => $('#' + i).value.trim();
  if (!g('fbNama')) return showToast('Validasi', 'Nama barang wajib diisi.', 'warning');
  const varOn = $('#fbVarianOn').checked, vrows = varOn ? readVarianRows() : [];
  if (varOn) {
    if (!vrows.length) return showToast('Validasi', 'Tambahkan minimal satu varian, atau matikan opsi varian.', 'warning');
    if (vrows.some(v => !v.nama)) return showToast('Validasi', 'Nama varian tidak boleh kosong.', 'warning');
    const names = vrows.map(v => v.nama.toLowerCase());
    if (new Set(names).size !== names.length) return showToast('Validasi', 'Nama varian tidak boleh kembar.', 'warning');
  }
  const payload = { kode: g('fbKode').toUpperCase() || null, nama: g('fbNama'), kategori: g('fbKategori') || null, merk: g('fbMerk') || null, satuan: g('fbSatuan') || 'PCS', status: g('fbStatus'), min_stok: varOn ? 0 : Math.max(0, num(g('fbMin'))), punya_varian: varOn };
  const old = id ? AppState.masterBarang.find(x => x.id === id) : null, btn = $('#fbSimpan'); let oldPath = null;
  setBtnBusy(btn, true, 'Menyimpan...');
  if (fbFotoBlob) {
    const path = `barang/${id || crypto.randomUUID()}-${Date.now()}.jpg`;
    const up = await callSb(sb.storage.from('app-assets').upload(path, fbFotoBlob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
    if (!up.success) { setBtnBusy(btn, false); return; }
    payload.foto_url = sb.storage.from('app-assets').getPublicUrl(path).data.publicUrl; payload.foto_path = path; oldPath = old && old.foto_path;
  } else if (id && $('#fbFotoHapus') && $('#fbFotoHapus').checked) { payload.foto_url = null; payload.foto_path = null; oldPath = old && old.foto_path; }
  let q;
  if (id) q = sb.from('master_barang').update(payload).eq('id', id).select('id').single();
  else { payload.stok = varOn ? 0 : num(g('fbStok')); q = sb.from('master_barang').insert(payload).select('id').single(); }
  const r = await callSb(q);
  if (!r.success) {
    setBtnBusy(btn, false);
    if (payload.foto_path && (!old || payload.foto_path !== old.foto_path)) sb.storage.from('app-assets').remove([payload.foto_path]);
    return;
  }
  const barangId = r.data.id; let gagal = 0;
  if (varOn) {
    const keep = new Set(vrows.filter(v => v.id).map(v => v.id));
    for (const ev of variansOf(barangId)) if (!keep.has(ev.id)) { const d = await callSb(sb.from('master_varian').delete().eq('id', ev.id)); if (!d.success) gagal++; }
    for (const v of vrows) {
      const res = v.id ? await callSb(sb.from('master_varian').update({ nama: v.nama, min_stok: v.min, status: v.status }).eq('id', v.id))
                       : await callSb(sb.from('master_varian').insert({ barang_id: barangId, nama: v.nama, stok: v.stok, min_stok: v.min }));
      if (!res.success) gagal++;
    }
    await callSb(sb.rpc('hitung_stok_barang', { p_id: barangId }), null, { silent: true });
  }
  setBtnBusy(btn, false);
  if (oldPath) sb.storage.from('app-assets').remove([oldPath]);
  showToast(gagal ? 'Tersimpan sebagian' : 'Berhasil', gagal ? `Barang disimpan, tetapi ${gagal} varian gagal diproses. Buka kembali form untuk memeriksa.` : 'Barang disimpan.', gagal ? 'warning' : 'success');
  hideForm(); await loadMasterCaches(); renderStokTable();
}
function deleteBarang(id) {
  const b = AppState.masterBarang.find(x => x.id === id);
  confirmDelete(async () => { const r = await callSb(sb.from('master_barang').delete().eq('id', id), 'Barang dihapus.'); if (r.success) { await loadMasterCaches(); renderStokTable(); } }, `Hapus barang "${b ? b.nama : ''}"? Barang yang sudah dipakai transaksi tidak bisa dihapus (nonaktifkan saja).`);
}

/* ───────────────────────── RIWAYAT ───────────────────────── */
PAGES.riwayat = function () {
  $('#app-container').innerHTML = `<div class="section-card">
    <div class="row g-2 align-items-end mb-3">
      <div class="col-6 col-md-3"><label class="form-label">Dari</label><input type="date" id="rwFrom" class="form-control" value="${firstOfMonthStr()}"></div>
      <div class="col-6 col-md-3"><label class="form-label">Sampai</label><input type="date" id="rwTo" class="form-control" value="${todayStr()}"></div>
      <div class="col-6 col-md-3"><label class="form-label">Jenis</label><select id="rwJenis" class="form-select"><option value="all">Semua</option><option value="Keluar">Barang Keluar</option><option value="Masuk">Barang Masuk</option></select></div>
      <div class="col-6 col-md-auto"><button class="btn btn-accent w-100" onclick="loadRiwayat()"><i class="bi bi-search"></i> Tampilkan</button></div>
    </div><div id="riwayatTable"></div><p class="small text-secondary mt-2 mb-0">Menampilkan maksimal 300 transaksi terbaru per jenis.</p></div>`;
  loadRiwayat();
};
const sortUrutan = arr => (arr || []).slice().sort((a, b) => (a.urutan || 0) - (b.urutan || 0));
async function loadRiwayat() {
  const from = $('#rwFrom').value, to = $('#rwTo').value, jenis = $('#rwJenis').value;
  const box = $('#riwayatTable'); box.innerHTML = spinnerBlock();
  const mk = (table, itemTable) => { let q = sb.from(table).select(`*, ${itemTable}(*)`).order('tanggal', { ascending: false }).order('created_at', { ascending: false }).limit(300); if (from) q = q.gte('tanggal', from); if (to) q = q.lte('tanggal', to); return callSb(q, null, { silent: true }); };
  const [k, m] = await Promise.all([jenis !== 'Masuk' ? mk('barang_keluar', 'barang_keluar_item') : Promise.resolve({ success: true, data: [] }), jenis !== 'Keluar' ? mk('barang_masuk', 'barang_masuk_item') : Promise.resolve({ success: true, data: [] })]);
  if (!k.success || !m.success) { box.innerHTML = errBox('Gagal memuat riwayat.', 'loadRiwayat()'); return; }
  riwayatMap = {};
  const rows = [
    ...k.data.map(r => ({ id: r.id, jenis: 'Keluar', tanggal: r.tanggal, pihak: r.pelanggan_nama, pihak_id: r.pelanggan_id, catatan: r.catatan, created_at: r.created_at, items: sortUrutan(r.barang_keluar_item) })),
    ...m.data.map(r => ({ id: r.id, jenis: 'Masuk', tanggal: r.tanggal, pihak: r.sumber_nama, pihak_id: r.sumber_id, catatan: r.catatan, created_at: r.created_at, items: sortUrutan(r.barang_masuk_item) }))
  ].sort((a, b) => a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : (a.created_at < b.created_at ? 1 : -1));
  rows.forEach(r => riwayatMap[r.id] = r);
  box.innerHTML = `<div class="table-responsive"><table class="table"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Pelanggan / Sumber</th><th class="text-end">Item</th><th class="text-end">Total Qty</th><th>Aksi</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${tglSingkat(r.tanggal)}</td><td><span class="badge-status ${r.jenis === 'Keluar' ? 'badge-low' : 'badge-ok'}">${r.jenis}</span></td><td class="fw-bold">${esc(r.pihak || '-')}</td><td class="text-end">${r.items.length}</td><td class="text-end">${fmtNum(sumQty(r.items))}</td><td><button class="action-btn view" onclick="viewRiwayat('${r.id}')"><i class="bi bi-eye"></i></button><button class="action-btn edit" onclick="editRiwayat('${r.id}')"><i class="bi bi-pencil"></i></button><button class="action-btn delete" onclick="deleteRiwayat('${r.id}')"><i class="bi bi-trash"></i></button></td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-secondary py-4">Tidak ada transaksi.</td></tr>'}
  </tbody></table></div>`;
}
function viewRiwayat(id) {
  const r = riwayatMap[id]; if (!r) return;
  const keluar = r.jenis === 'Keluar';
  showDetail(`${keluar ? 'Barang Keluar' : 'Barang Masuk'} — ${tglPanjang(r.tanggal)}`, `<p class="mb-2"><b>${keluar ? 'Pelanggan' : 'Sumber'}:</b> ${esc(r.pihak || '-')}</p>
    <div class="table-responsive"><table class="table"><thead><tr><th>Barang</th><th>Varian</th><th class="text-end">Qty</th></tr></thead><tbody>
    ${r.items.map(i => `<tr><td>${esc(i.nama_barang)}</td><td>${esc(i.varian_nama || '-')}</td><td class="text-end">${fmtNum(i.jumlah)} ${esc(i.satuan || '')}</td></tr>`).join('')}
    </tbody></table></div><p class="fw-bold text-end mt-2 mb-0">Total Qty: ${fmtNum(sumQty(r.items))}</p>${r.catatan ? `<p class="small text-secondary mt-2 mb-0">Catatan: ${esc(r.catatan)}</p>` : ''}`);
}
function editRiwayat(id) { const r = riwayatMap[id]; if (!r) return; navigateTo(r.jenis === 'Keluar' ? 'kasir' : 'barangMasuk', r); }
function deleteRiwayat(id) {
  const r = riwayatMap[id]; if (!r) return;
  confirmDelete(async () => {
    const res = await callSb(sb.rpc(r.jenis === 'Keluar' ? 'hapus_barang_keluar' : 'hapus_barang_masuk', { p_id: id }), 'Transaksi dihapus dan stok dikoreksi.');
    if (res.success) { await loadMasterCaches(); loadRiwayat(); }
  }, 'Hapus transaksi ini? Stok barang akan dikembalikan seperti sebelum transaksi.');
}

/* ───────────────────────── PELANGGAN ───────────────────────── */
PAGES.pelanggan = function () {
  $('#app-container').innerHTML = `<div class="section-card"><div class="d-flex justify-content-end mb-3"><button class="btn btn-accent" onclick="openPelangganForm()"><i class="bi bi-plus-lg"></i> Tambah Pelanggan</button></div><div id="pelTable"></div></div>`;
  renderPelanggan();
};
function renderPelanggan() {
  $('#pelTable').innerHTML = `<div class="table-responsive"><table class="table"><thead><tr><th>Nama</th><th>Kontak</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
    ${AppState.masterPelanggan.map(p => `<tr><td class="fw-bold">${esc(p.nama)}</td><td>${esc(p.kontak || '-')}</td><td>${badgeStatus(p.status)}</td><td><button class="action-btn edit" onclick="openPelangganForm('${p.id}')"><i class="bi bi-pencil"></i></button><button class="action-btn delete" onclick="deletePelanggan('${p.id}')"><i class="bi bi-trash"></i></button></td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-secondary py-4">Belum ada pelanggan.</td></tr>'}
  </tbody></table></div>`;
}
function openPelangganForm(id) {
  const p = id ? AppState.masterPelanggan.find(x => x.id === id) : null;
  showForm(p ? 'Edit Pelanggan' : 'Tambah Pelanggan', `<div class="row g-3">
    <div class="col-12"><label class="form-label">Nama *</label><input id="fpNama" class="form-control" value="${esc(p ? p.nama : '')}"></div>
    <div class="col-md-8"><label class="form-label">Kontak</label><input id="fpKontak" class="form-control" value="${esc(p ? p.kontak || '' : '')}"></div>
    <div class="col-md-4"><label class="form-label">Status</label><select id="fpStatus" class="form-select"><option ${p && p.status === 'Nonaktif' ? '' : 'selected'}>Aktif</option><option ${p && p.status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option></select></div>
    <div class="col-12 text-end"><button class="btn btn-secondary me-2" data-bs-dismiss="modal">Batal</button><button class="btn btn-accent" id="fpSimpan" onclick="savePelanggan('${id || ''}')">Simpan</button></div></div>`);
}
async function savePelanggan(id) {
  const nama = $('#fpNama').value.trim(); if (!nama) return showToast('Validasi', 'Nama wajib diisi.', 'warning');
  const payload = { nama, kontak: $('#fpKontak').value.trim() || null, status: $('#fpStatus').value };
  const btn = $('#fpSimpan'); setBtnBusy(btn, true, 'Menyimpan...');
  const r = await callSb(id ? sb.from('master_pelanggan').update(payload).eq('id', id) : sb.from('master_pelanggan').insert(payload), 'Pelanggan disimpan.'); setBtnBusy(btn, false);
  if (r.success) { hideForm(); await loadMasterCaches(); renderPelanggan(); }
}
function deletePelanggan(id) {
  confirmDelete(async () => { const r = await callSb(sb.from('master_pelanggan').delete().eq('id', id), 'Pelanggan dihapus.'); if (r.success) { await loadMasterCaches(); renderPelanggan(); } }, 'Hapus pelanggan ini? Riwayat transaksinya tetap tersimpan.');
}

/* ───────────────────────── PENGATURAN ───────────────────────── */
PAGES.pengaturan = function () {
  const c = AppState.config;
  $('#app-container').innerHTML = `
    <div class="section-card mb-3"><h6><span><i class="bi bi-palette"></i> Identitas & Tampilan</span><button class="btn btn-outline-accent btn-sm" onclick="resetBrand()">Kembalikan ke Bawaan</button></h6>
      <p class="small text-secondary">Perubahan langsung tampil sebagai pratinjau. Klik <b>Simpan Identitas</b> untuk menyimpannya. Kolom kosong memakai nilai bawaan salinan ini.</p>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">Nama Aplikasi</label><input id="cfgApp" class="form-control" oninput="previewBrand()" value="${esc(c.appName || '')}" placeholder="${esc(Brand.get('appName'))}"></div>
        <div class="col-md-6"><label class="form-label">Tagline (teks kecil di bawah nama)</label><input id="cfgTagline" class="form-control" oninput="previewBrand()" value="${esc(c.tagline || '')}" placeholder="${esc(Brand.get('tagline'))}"></div>
        <div class="col-md-6"><label class="form-label">Nama Bisnis / Perusahaan (header invoice)</label><input id="cfgPerusahaan" class="form-control" oninput="previewBrand()" value="${esc(c.perusahaan || '')}" placeholder="${esc(Brand.get('perusahaan') || Brand.get('appName'))}"></div>
        <div class="col-md-6"><label class="form-label">Telepon</label><input id="cfgTelepon" class="form-control" oninput="previewBrand()" value="${esc(c.telepon || '')}"></div>
        <div class="col-12"><label class="form-label">Alamat</label><input id="cfgAlamat" class="form-control" oninput="previewBrand()" value="${esc(c.alamat || '')}"></div>
        <div class="col-md-4"><label class="form-label">Warna Utama</label><input type="color" id="cfgPrimary" class="form-control form-control-color w-100" value="${Brand.hex(Brand.rgb('primaryColor'))}" oninput="previewBrand()"></div>
        <div class="col-md-4"><label class="form-label">Warna Sekunder</label><input type="color" id="cfgSecondary" class="form-control form-control-color w-100" value="${Brand.hex(Brand.rgb('secondaryColor'))}" oninput="previewBrand()"></div>
        <div class="col-md-4"><label class="form-label">Warna Sidebar & Header Tabel</label><input type="color" id="cfgSidebar" class="form-control form-control-color w-100" value="${Brand.hex(Brand.rgb('sidebarColor'))}" oninput="previewBrand()"></div>
        <div class="col-md-6"><label class="form-label">Logo (URL, dipakai juga di invoice)</label><input id="cfgLogo" class="form-control" placeholder="https://..." oninput="previewBrand()" value="${esc(c.logoUrl || '')}">
          <div class="d-flex gap-2 mt-2 flex-wrap"><input type="file" id="cfgLogoFile" accept="image/png,image/jpeg,image/webp" class="form-control form-control-sm" style="max-width:230px"><button class="btn btn-outline-accent btn-sm" id="cfgUploadLogo" onclick="uploadBrandImage('logo')"><i class="bi bi-upload"></i> Upload Logo</button><button class="btn btn-secondary btn-sm" onclick="testLogo()">Tes Logo</button></div></div>
        <div class="col-md-6"><label class="form-label">Favicon (ikon tab browser, URL)</label><input id="cfgFavicon" class="form-control" placeholder="https://... (kosong = pakai logo)" oninput="previewBrand()" value="${esc(c.faviconUrl || '')}">
          <div class="d-flex gap-2 mt-2 flex-wrap"><input type="file" id="cfgFaviconFile" accept="image/png,image/jpeg,image/webp" class="form-control form-control-sm" style="max-width:230px"><button class="btn btn-outline-accent btn-sm" id="cfgUploadFavicon" onclick="uploadBrandImage('favicon')"><i class="bi bi-upload"></i> Upload Favicon</button></div>
          <div class="small text-secondary mt-1">PNG/JPG/WebP maks. 2 MB. Favicon dikecilkan otomatis ke 192 px.</div></div>
        <div class="col-12"><div id="logoTest" class="small"></div></div>
        <div class="col-12 text-end"><button class="btn btn-accent" id="cfgSimpan" onclick="saveConfig()">Simpan Identitas</button></div>
      </div></div>
    <div class="section-card mb-3"><h6>Pengguna & Role</h6>
      <p class="small text-secondary">Admin = akses penuh. Owner = hanya Dashboard. Akun baru dibuat lewat Supabase → Authentication → Users → Add user (otomatis berperan Owner).</p>
      <div id="userList">${spinnerBlock()}</div></div>
    <div class="section-card"><h6>Sumber Barang Masuk <button class="btn btn-accent btn-sm" onclick="openSumberForm()"><i class="bi bi-plus-lg"></i> Tambah</button></h6><div id="sumberList"></div></div>`;
  renderSumberList(); loadUsers();
};
function brandFormValues() {
  const g = id => $('#' + id).value.trim();
  return { appName: g('cfgApp'), tagline: g('cfgTagline'), perusahaan: g('cfgPerusahaan'), alamat: g('cfgAlamat'), telepon: g('cfgTelepon'), logoUrl: g('cfgLogo'), faviconUrl: g('cfgFavicon'), primaryColor: g('cfgPrimary'), secondaryColor: g('cfgSecondary'), sidebarColor: g('cfgSidebar') };
}
function previewBrand() { Brand.preview(brandFormValues()); }
async function saveConfig() {
  const v = brandFormValues();
  for (const k of ['primaryColor', 'secondaryColor', 'sidebarColor']) { const err = Brand.check(k, v[k]); if (err) return showToast('Validasi', err, 'warning'); }
  // nilai yang sama dengan bawaan salinan disimpan kosong, agar perubahan bawaan di config.js tetap berlaku
  const rows = Object.entries(v).map(([key, value]) => ({ key, value: value.toLowerCase() === String(Brand.defaultOf(key)).toLowerCase() ? '' : value }));
  const btn = $('#cfgSimpan'); setBtnBusy(btn, true, 'Menyimpan...');
  const r = await callSb(sb.from('app_config').upsert(rows, { onConflict: 'key' }), 'Identitas disimpan.'); setBtnBusy(btn, false);
  if (r.success) { rows.forEach(x => AppState.config[x.key] = x.value); Brand.clearPreview(); applyConfig(); testLogo(); }
}
async function resetBrand() {
  if (!confirm('Kembalikan identitas ke nilai bawaan salinan ini? Nama, logo, favicon, dan warna yang pernah Anda simpan akan dikosongkan.')) return;
  const rows = Brand.KEYS.filter(k => k !== 'poweredBy').map(key => ({ key, value: '' }));
  const r = await callSb(sb.from('app_config').upsert(rows, { onConflict: 'key' }), 'Identitas dikembalikan ke bawaan.');
  if (r.success) { rows.forEach(x => AppState.config[x.key] = ''); Brand.clearPreview(); applyConfig(); PAGES.pengaturan(); }
}
/* Tes URL logo: apakah tampil di aplikasi, dan apakah bisa dipakai di PDF (butuh izin CORS dari server gambar) */
async function testLogo() {
  const url = $('#cfgLogo').value.trim(), box = $('#logoTest');
  if (!url) { box.innerHTML = '<span class="text-secondary">Belum ada URL logo. Isi URL atau upload file.</span>'; return; }
  box.innerHTML = '<span class="text-secondary">Menguji logo...</span>';
  const display = await new Promise(res => { const i = new Image(); const t = setTimeout(() => res(false), 8000); i.onload = () => { clearTimeout(t); res(true); }; i.onerror = () => { clearTimeout(t); res(false); }; i.src = url; });
  const pdf = display ? !!(await loadImageDataUrl(url)) : false;
  const ok = t => `<div class="text-success"><i class="bi bi-check-circle-fill"></i> ${t}</div>`, bad = t => `<div class="text-danger"><i class="bi bi-x-circle-fill"></i> ${t}</div>`;
  box.innerHTML = (display ? `<img src="${esc(url)}" alt="Pratinjau" style="height:56px;max-width:160px;object-fit:contain;background:#fff;border-radius:8px;padding:4px;border:1px solid var(--border-color)" class="mb-2 d-block">` : '') +
    (display ? ok('Tampil di aplikasi (navbar & login).') : bad('Tidak tampil: URL ini bukan link gambar langsung (biasanya link halaman / share dari Google Drive, Google Photos, Canva, ibb.co, dll). Gunakan Upload Logo.')) +
    (display ? (pdf ? ok('Bisa dipakai di invoice PDF.') : bad('Tidak bisa dipakai di invoice PDF: server gambar memblokir akses lintas-situs. Gunakan Upload Logo.')) : '');
}

/* Upload logo / favicon ke Supabase Storage (bucket publik "app-assets"); favicon dikecilkan ke PNG 192 px */
function resizeToPng(file, size) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; const r = Math.min(size / img.width, size / img.height), w = img.width * r, h = img.height * r; c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h); c.toBlob(b => b ? res(b) : rej(new Error('gagal')), 'image/png'); };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
async function uploadBrandImage(kind) {
  const fav = kind === 'favicon', f = $(fav ? '#cfgFaviconFile' : '#cfgLogoFile').files[0];
  if (!f) return showToast('Validasi', 'Pilih file gambar terlebih dahulu.', 'warning');
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return showToast('Validasi', 'Format harus PNG, JPG, atau WebP.', 'warning');
  if (f.size > 2 * 1024 * 1024) return showToast('Validasi', 'Ukuran file maksimal 2 MB.', 'warning');
  let body = f, type = f.type, ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
  if (fav) { try { body = await resizeToPng(f, 192); type = 'image/png'; ext = 'png'; } catch (e) { return showToast('Validasi', 'Gambar favicon tidak bisa diproses.', 'warning'); } }
  const path = `${kind}/${kind}-${Date.now()}.${ext}`, btn = $(fav ? '#cfgUploadFavicon' : '#cfgUploadLogo'); setBtnBusy(btn, true, 'Mengunggah...');
  const up = await callSb(sb.storage.from('app-assets').upload(path, body, { contentType: type, cacheControl: '3600', upsert: false }));
  if (!up.success) { setBtnBusy(btn, false); return; }
  const url = sb.storage.from('app-assets').getPublicUrl(path).data.publicUrl, key = fav ? 'faviconUrl' : 'logoUrl';
  const sv = await callSb(sb.from('app_config').upsert({ key, value: url }, { onConflict: 'key' }), (fav ? 'Favicon' : 'Logo') + ' diunggah dan disimpan.');
  setBtnBusy(btn, false);
  if (sv.success) { AppState.config[key] = url; $(fav ? '#cfgFavicon' : '#cfgLogo').value = url; $(fav ? '#cfgFaviconFile' : '#cfgLogoFile').value = ''; applyConfig(); if (!fav) testLogo(); }
}

async function loadUsers() {
  const r = await callSb(sb.from('profiles').select('*').order('created_at'), null, { silent: true });
  const box = $('#userList'); if (!box) return;
  if (!r.success) { box.innerHTML = errBox('Gagal memuat pengguna.', 'loadUsers()'); return; }
  box.innerHTML = `<div class="table-responsive"><table class="table"><thead><tr><th>Email</th><th>Nama</th><th>Role</th></tr></thead><tbody>
    ${r.data.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.nama || '-')}</td><td><select class="form-select form-select-sm" style="max-width:140px" ${u.id === AppState.user.id ? 'disabled title="Tidak bisa mengubah role sendiri"' : ''} onchange="changeRole('${u.id}', this.value)"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option><option value="owner" ${u.role === 'owner' ? 'selected' : ''}>owner</option></select></td></tr>`).join('')}</tbody></table></div>`;
}
async function changeRole(id, role) { const r = await callSb(sb.from('profiles').update({ role }).eq('id', id), 'Role diperbarui.'); if (!r.success) loadUsers(); }
function renderSumberList() {
  $('#sumberList').innerHTML = AppState.masterSumber.map(s => `<div class="mini-card"><span class="mc-name">${esc(s.nama)}</span><span>${badgeStatus(s.status)} <button class="mc-btn ms-2" onclick="toggleSumber('${s.id}')">${s.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}</button></span></div>`).join('') || '<p class="text-secondary small mb-0">Belum ada sumber.</p>';
}
function openSumberForm() {
  showForm('Tambah Sumber', `<div class="mb-3"><label class="form-label">Nama Sumber *</label><input id="fsNama" class="form-control"></div><div class="text-end"><button class="btn btn-secondary me-2" data-bs-dismiss="modal">Batal</button><button class="btn btn-accent" id="fsSimpan" onclick="saveSumber()">Simpan</button></div>`);
}
async function saveSumber() {
  const nama = $('#fsNama').value.trim(); if (!nama) return showToast('Validasi', 'Nama wajib diisi.', 'warning');
  const btn = $('#fsSimpan'); setBtnBusy(btn, true, 'Menyimpan...');
  const r = await callSb(sb.from('master_sumber').insert({ nama }), 'Sumber ditambahkan.'); setBtnBusy(btn, false);
  if (r.success) { hideForm(); await loadMasterCaches(); renderSumberList(); }
}
async function toggleSumber(id) {
  const s = AppState.masterSumber.find(x => x.id === id);
  const r = await callSb(sb.from('master_sumber').update({ status: s.status === 'Aktif' ? 'Nonaktif' : 'Aktif' }).eq('id', id), 'Status sumber diubah.');
  if (r.success) { await loadMasterCaches(); renderSumberList(); }
}

/* ───────────────────────── INVOICE (pengiriman barang, tanpa harga) ───────────────────────── */
PAGES.invoice = function () {
  const n = new Date();
  const from = dateToStr(new Date(n.getFullYear(), n.getMonth(), 1)), to = dateToStr(new Date(n.getFullYear(), n.getMonth() + 1, 0));
  $('#app-container').innerHTML = `
    <div class="section-card mb-3"><h6>Invoice Pengiriman Barang (per Pelanggan)</h6><div class="row g-3 align-items-end">
      <div class="col-md-4"><label class="form-label">Pelanggan</label><select id="invPel" class="form-select"><option value="">-- Pilih Pelanggan --</option>${AppState.masterPelanggan.map(p => `<option value="${p.id}">${esc(p.nama)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label">Dari</label><input type="date" id="invFrom" class="form-control" value="${from}"></div>
      <div class="col-6 col-md-3"><label class="form-label">Sampai</label><input type="date" id="invTo" class="form-control" value="${to}"></div>
      <div class="col-12 col-md-2"><button class="btn btn-accent w-100" onclick="generateInvoicePelanggan(this)"><i class="bi bi-file-earmark-pdf"></i> Buat Invoice</button></div>
    </div></div>`;
};

function groupByDate(rows, itemKey, mapItem) {
  const map = new Map();
  rows.forEach(r => { const arr = map.get(r.tanggal) || []; sortUrutan(r[itemKey]).forEach(it => { const m = mapItem(it); if (m) arr.push(m); }); map.set(r.tanggal, arr); });
  return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).filter(([, items]) => items.length).map(([tanggal, items]) => ({ tanggal, items }));
}
function kodeBarang(it) { const b = AppState.masterBarang.find(x => x.id === it.barang_id); return (b && b.kode) || it.kode_barang || '-'; }

async function generateInvoicePelanggan(btn) {
  const pelId = $('#invPel').value, from = $('#invFrom').value, to = $('#invTo').value;
  if (!pelId || !from || !to || from > to) return showToast('Validasi', 'Pilih pelanggan dan rentang tanggal yang valid.', 'warning');
  const pel = AppState.masterPelanggan.find(p => p.id === pelId);
  setBtnBusy(btn, true, 'Membuat...');
  try {
    const r = await callSb(sb.from('barang_keluar').select('tanggal,created_at,barang_keluar_item(barang_id,kode_barang,nama_barang,varian_nama,satuan,jumlah,urutan)').eq('pelanggan_id', pelId).gte('tanggal', from).lte('tanggal', to).order('tanggal').order('created_at'));
    if (!r.success) return;
    const groups = groupByDate(r.data, 'barang_keluar_item', i => ({ kode: kodeBarang(i), nama: labelItem(i.nama_barang, i.varian_nama), qty: num(i.jumlah), satuan: i.satuan || '-' }));
    if (!groups.length) return showToast('Info', 'Tidak ada transaksi pada periode tersebut.', 'warning');
    await finishInvoice({ prefix: 'PJL', tipe: 'Per Pelanggan', judul: 'INVOICE PENGIRIMAN BARANG', target: pel.nama, kontak: pel.kontak, from, to, groups });
  } finally { setBtnBusy(btn, false); }
}

/* Ambil semua halaman data (Supabase membatasi 1000 baris per permintaan) */
async function fetchAllPages(makeQuery) {
  const size = 1000; let all = [];
  for (let from = 0; ; from += size) {
    const r = await callSb(makeQuery().range(from, from + size - 1));
    if (!r.success) return null;
    all = all.concat(r.data);
    if (r.data.length < size) break;
  }
  return all;
}

async function finishInvoice(o) {
  o.totalQty = o.groups.reduce((s, g) => s + g.items.reduce((a, i) => a + i.qty, 0), 0);
  o.totalItem = o.groups.reduce((s, g) => s + g.items.length, 0);
  const nm = await callSb(sb.rpc('buat_nomor_invoice', { p_prefix: o.prefix, p_tipe: o.tipe, p_mulai: o.from, p_selesai: o.to, p_target: o.target, p_total: o.totalQty }));
  if (!nm.success) return;
  o.nomor = nm.data; o.cfg = AppState.config;
  const doc = await buildInvoiceDoc(o);
  showPdfPreview(doc.output('blob'), `Invoice_${o.target.replace(/\s+/g, '_')}_${o.from}_${o.to}.pdf`, o.nomor);
}

let pdfUrl = null;
function showPdfPreview(blob, filename, nomor) {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(blob);
  $('#pdfModalTitle').textContent = 'Pratinjau ' + nomor;
  $('#pdfFrame').src = pdfUrl;
  const a = $('#pdfDownloadBtn'); a.href = pdfUrl; a.download = filename;
  getModal('pdfModal').show();
}
document.addEventListener('hidden.bs.modal', e => { if (e.target.id === 'pdfModal') $('#pdfFrame').src = 'about:blank'; });

function loadImageDataUrl(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image(); img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => { clearTimeout(timer); try { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height }); } catch (e) { resolve(null); } };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

function labelBulan(from, to) {
  const a = parseDate(from), b = parseDate(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return BULAN_ID[a.getMonth()].toUpperCase();
  return `${BULAN_ID[a.getMonth()].slice(0, 3).toUpperCase()} – ${BULAN_ID[b.getMonth()].slice(0, 3).toUpperCase()} ${b.getFullYear()}`;
}

/* Layout: header logo+judul kiri, bulan/periode kanan, pita "Tanggal | Kepada", blok per tanggal,
   total qty di akhir, nomor halaman x/y. Kolom: No, Kd. Item, Nama Item (+varian), Qty, Satuan. */
async function buildInvoiceDoc(o) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, ML = 14, MR = 14, MB = 18, CW = W - ML - MR;
  const pc = Brand.rgb('primaryColor'), dflt = Brand.get('primaryColor').toLowerCase() === Brand.BUILTIN.primaryColor;
  const C = { ink: [17, 24, 39], muted: [107, 114, 128], line: [226, 232, 240], accent: pc, soft: dflt ? [236, 253, 245] : Brand.shade(pc, 0.9).map(Math.round), band: [243, 245, 249], navy: Brand.rgb('sidebarColor'), zebra: [248, 250, 252], mint: dflt ? [110, 231, 183] : Brand.shade(pc, 0.55).map(Math.round) };
  const cfg = { logoUrl: Brand.get('logoUrl'), perusahaan: Brand.get('perusahaan') || Brand.get('appName'), alamat: Brand.get('alamat'), telepon: Brand.get('telepon') };

  // ── Header kiri: logo + identitas ──
  const logo = await loadImageDataUrl(cfg.logoUrl);
  if (cfg.logoUrl && !logo) showToast('Logo invoice', 'Logo tidak bisa dimuat ke PDF (server gambar memblokir akses). Pakai Upload Logo di Pengaturan.', 'warning');
  let drawn = false;
  if (logo) { try { const s = 22, r = Math.min(s / logo.w, s / logo.h); const w = logo.w * r, h = logo.h * r; doc.addImage(logo.data, 'PNG', ML + (s - w) / 2, 12 + (s - h) / 2, w, h); drawn = true; } catch (e) { } }
  if (!drawn) { doc.setFillColor(...C.accent); doc.roundedRect(ML, 12, 22, 22, 4, 4, 'F'); doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255, 255, 255).text(Brand.initials(), ML + 11, 25.5, { align: 'center' }); }
  const tx = ML + 27;
  doc.setFont('helvetica', 'bold').setFontSize(13.5).setTextColor(...C.ink).text(o.judul, tx, 18);
  doc.setFontSize(9.5).text(cfg.perusahaan, tx, 24);
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...C.muted);
  doc.text(cfg.alamat || '-', tx, 29); doc.text(cfg.telepon || '-', tx, 33.5);

  // ── Header kanan: bulan + periode ──
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...C.accent).text(labelBulan(o.from, o.to), W - MR, 18, { align: 'right' });
  doc.setFontSize(9).setTextColor(...C.ink).text(`PERIODE : ${tglKode(o.from)} - ${tglKode(o.to)}`, W - MR, 24, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...C.muted).text('No. ' + o.nomor, W - MR, 29, { align: 'right' });

  // ── Pita: Tanggal | Kepada ──
  doc.setFillColor(...C.band); doc.roundedRect(ML, 40, CW, 14, 2, 2, 'F');
  doc.setFillColor(...C.accent); doc.roundedRect(ML, 40, 1.4, 14, 0.7, 0.7, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...C.ink).text('Tanggal', ML + 5, o.kontak ? 45.2 : 47.2);
  const mid = ML + CW / 2;
  const lblKpd = o.kepadaLabel || 'Kepada :';
  doc.setTextColor(...C.muted).text(lblKpd, mid, o.kontak ? 45.2 : 47.2);
  const nx = mid + doc.getTextWidth(lblKpd) + 3;
  doc.setFontSize(11).setTextColor(...C.ink).text(String(o.target).toUpperCase(), nx, o.kontak ? 45.2 : 47.2);
  if (o.kontak) doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...C.muted).text(String(o.kontak), nx, 50.4);

  // ── Blok per tanggal ──
  let y = 62; const bottom = H - MB;
  const ensure = need => { if (y + need > bottom) { doc.addPage(); y = 16; } };
  for (const g of o.groups) {
    ensure(34);
    const sub = g.items.reduce((s, i) => s + i.qty, 0);
    doc.setFillColor(...C.soft); doc.roundedRect(ML, y, CW, 8, 1.5, 1.5, 'F');
    doc.setFillColor(...C.accent); doc.roundedRect(ML, y, 1.6, 8, 0.8, 0.8, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...C.ink).text(tglPanjang(g.tanggal), ML + 5, y + 5.4);
    doc.setFontSize(8.3).setTextColor(...C.accent).text('Total Qty  ' + fmtNum(sub), W - MR - 3, y + 5.4, { align: 'right' });
    y += 10;
    doc.autoTable({
      startY: y, margin: { left: ML, right: MR, top: 16, bottom: MB }, theme: 'plain',
      head: [['No.', 'Kd. Item', 'Nama Item', 'Qty', 'Satuan']],
      body: g.items.map((it, i) => [i + 1, it.kode, it.nama, fmtNum(it.qty), it.satuan]),
      styles: { font: 'helvetica', fontSize: 8.8, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 }, textColor: C.ink, lineWidth: 0, overflow: 'linebreak' },
      headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8, cellPadding: { top: 2.2, bottom: 2.2, left: 2.2, right: 2.2 } },
      alternateRowStyles: { fillColor: C.zebra },
      columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 28 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 24, halign: 'center', fontStyle: 'bold' }, 4: { cellWidth: 26, halign: 'center' } },
      didParseCell: d => { if (d.column.index >= 3) d.cell.styles.halign = 'center'; },
      didDrawCell: d => { if (d.section === 'body') { doc.setDrawColor(...C.line); doc.setLineWidth(0.15); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); } }
    });
    y = doc.lastAutoTable.finalY + 4;
    doc.setDrawColor(...C.muted); doc.setLineWidth(0.25); doc.setLineDashPattern([0.6, 1.2], 0); doc.line(ML, y, W - MR, y); doc.setLineDashPattern([], 0);
    y += 9;
  }

  // ── Ringkasan akhir ──
  ensure(30);
  doc.setFillColor(...C.navy); doc.roundedRect(ML, y, CW, 26, 3, 3, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(255, 255, 255).text('TOTAL KESELURUHAN', ML + 8, y + 11);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(180, 186, 210).text(`${o.groups.length} hari pengiriman`, ML + 8, y + 17);
  const lx = ML + CW * 0.5, rx = W - MR - 8;
  doc.setFontSize(9).setTextColor(200, 205, 225).text('Jumlah Baris Item :', lx, y + 9);
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').text(fmtNum(o.totalItem), rx, y + 9, { align: 'right' });
  doc.setDrawColor(70, 78, 120); doc.setLineWidth(0.2); doc.line(lx, y + 12.5, rx, y + 12.5);
  doc.setFontSize(10.5).setTextColor(...C.mint).text('TOTAL QTY :', lx, y + 21); doc.setFontSize(13).text(fmtNum(o.totalQty), rx, y + 21, { align: 'right' });

  // ── Nomor halaman x/y ──
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...C.muted).text(`${i}/${n}`, W - MR, H - 8, { align: 'right' }); }
  return doc;
}

/* ───────────────────────── INIT ───────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  if (!CONFIG_OK) {
    $('#loadingOverlay').innerHTML = '<div class="text-center p-4" style="max-width:420px"><i class="bi bi-exclamation-triangle fs-1 text-warning"></i><h5 class="mt-3">Konfigurasi Supabase belum benar</h5><p class="small" style="opacity:.8">Buka file <b>config.js</b>, lalu isi <b>SUPABASE_URL</b> dan <b>SUPABASE_ANON_KEY</b> (satu baris, di antara tanda kutip lurus). Setelah itu muat ulang halaman.</p></div>';
    return;
  }
  $('#loginBtn').addEventListener('click', doLogin);
  ['loginEmail', 'loginPassword'].forEach(id => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
  // Penting: jangan await panggilan Supabase di dalam callback ini (hindari deadlock) → pakai setTimeout
  sb.auth.onAuthStateChange((event, session) => { setTimeout(() => handleSession(session), 0); });
  const { data } = await sb.auth.getSession();
  if (!data.session) { await loadConfig(); showLogin(); }
});
