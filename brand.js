/* ============================================================
   brand.js — MESIN IDENTITAS TERPUSAT (kode produk; sama untuk semua salinan klien)
   Semua nama, logo, favicon, dan warna aplikasi dibaca dari sini. Tidak ada identitas bisnis
   yang tertanam di tempat lain.

   Prioritas nilai (tertinggi → terendah):
     1. Pratinjau di Pengaturan (sementara, belum disimpan)
     2. Database klien (tabel app_config) — diubah admin klien lewat menu Pengaturan
     3. config.js → APP_CONFIG.BRAND — nilai awal per salinan (diisi penjual saat instalasi)
     4. Nilai bawaan produk (di bawah)
   Nilai kosong = pakai tingkat berikutnya. Dimuat di <head> agar judul, favicon, dan warna
   benar sejak render pertama (tanpa berkedip).
   ============================================================ */
(function () {
  'use strict';
  const BUILTIN = {
    appName: 'Manajemen Keuangan Produksi', tagline: 'Stok, transaksi & biaya produksi',
    perusahaan: '', alamat: '', telepon: '', logoUrl: '', faviconUrl: '',
    primaryColor: '#16a34a', secondaryColor: '#f97316', sidebarColor: '#151a35', poweredBy: ''
  };
  const KEYS = Object.keys(BUILTIN);
  const CFG = window.APP_CONFIG || {};
  const deploy = CFG.BRAND || {};
  const CACHE_KEY = 'brand-cache:' + (CFG.SUPABASE_URL || '');
  let db = {}, prev = null;
  try { db = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { db = {}; }

  const filled = v => v !== undefined && v !== null && String(v).trim() !== '';
  const defaultOf = k => filled(deploy[k]) ? String(deploy[k]).trim() : BUILTIN[k];
  function get(k) {
    if (prev && filled(prev[k])) return String(prev[k]).trim();
    if (k !== 'poweredBy' && filled(db[k])) return String(db[k]).trim();
    return defaultOf(k);
  }

  /* ── warna ── */
  const hex2rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb2hex = c => '#' + c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const shade = (c, t) => mix(c, [255, 255, 255], t);   // terangkan
  const dark = (c, t) => mix(c, [0, 0, 0], t);          // gelapkan
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrastWhite = c => 1.05 / (lum(c) + 0.05);
  const rgb = k => hex2rgb(get(k)) || hex2rgb(BUILTIN[k]);

  /* Validasi: teks putih harus terbaca di atas warna (mencegah tombol/sidebar "hilang") */
  function check(k, v) {
    const c = hex2rgb(v); if (!c) return 'Format warna harus #RRGGBB.';
    const need = k === 'sidebarColor' ? 4.5 : 3;
    return contrastWhite(c) < need ? `Warna ${k === 'sidebarColor' ? 'sidebar' : ''} terlalu terang: teks putih di atasnya sulit dibaca. Pilih warna yang lebih gelap.`.replace('  ', ' ') : '';
  }

  function css() {
    if (['primaryColor', 'secondaryColor', 'sidebarColor'].every(k => get(k).toLowerCase() === BUILTIN[k])) return '';   // warna bawaan → pakai style.css apa adanya
    const p = rgb('primaryColor'), s = rgb('secondaryColor'), sb = rgb('sidebarColor'), r3 = c => c.map(Math.round).join(',');
    const block = (sel, o, a) => `${sel}{--accent:${rgb2hex(o.acc)};--accent-hover:${rgb2hex(o.hov)};--accent-light:rgba(${r3(o.acc)},${a});--accent-shadow:rgba(${r3(p)},.35);--accent-2:${rgb2hex(o.acc2)};--sidebar-bg:${rgb2hex(o.sb1)};--sidebar-bg-2:${rgb2hex(o.sb2)};}`;
    return block(':root,[data-theme="light"]', { acc: p, hov: dark(p, 0.12), acc2: s, sb1: sb, sb2: shade(sb, 0.07) }, 0.10) +
           block('[data-theme="dark"]', { acc: shade(p, 0.15), hov: p, acc2: shade(s, 0.12), sb1: dark(sb, 0.45), sb2: dark(sb, 0.30) }, 0.15);
  }

  /* ── logo cadangan: inisial nama aplikasi di atas warna utama (tanpa file/URL luar) ── */
  function initials() {
    const w = get('appName').split(/[\s\-_]+/).filter(Boolean);
    return (w.length > 1 ? w.slice(0, 2).map(x => x[0]).join('') : (w[0] || '?').slice(0, 2)).toUpperCase().replace(/[<>&"']/g, '');
  }
  function fallbackLogo() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="${rgb2hex(rgb('primaryColor'))}"/><text x="40" y="52" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#fff">${initials()}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ── terapkan ke halaman ── */
  function ensure(tag, id, attrs) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement(tag); el.id = id; Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v)); document.head.appendChild(el); }
    return el;
  }
  function apply() {
    document.title = get('appName');
    ensure('style', 'brand-style').textContent = css();
    const icon = get('faviconUrl') || get('logoUrl') || fallbackLogo();
    ensure('link', 'brandFavicon', { rel: 'icon' }).setAttribute('href', icon);
    ensure('meta', 'brandThemeColor', { name: 'theme-color' }).setAttribute('content', rgb2hex(rgb('sidebarColor')));
    if (!document.body) return;
    document.querySelectorAll('[data-brand]').forEach(el => { el.textContent = get(el.dataset.brand); });
    document.querySelectorAll('[data-brand-logo]').forEach(img => {
      img.onerror = () => { img.onerror = null; img.src = fallbackLogo(); };   // URL rusak → logo cadangan
      img.src = get('logoUrl') || fallbackLogo();
    });
    document.querySelectorAll('[data-brand-powered]').forEach(el => { el.style.display = get('poweredBy') ? '' : 'none'; });
  }

  /* database klien → override (disimpan di cache agar kunjungan berikutnya langsung benar) */
  function set(map) {
    const o = {}; KEYS.forEach(k => { if (k !== 'poweredBy' && map && filled(map[k])) o[k] = String(map[k]).trim(); });
    db = o; try { localStorage.setItem(CACHE_KEY, JSON.stringify(o)); } catch (e) { }
    apply();
  }
  function preview(o) { prev = o; apply(); }
  function clearPreview() { if (prev) { prev = null; apply(); } }
  const accent = () => (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || rgb2hex(rgb('primaryColor'));

  window.Brand = { KEYS, BUILTIN, get, defaultOf, set, preview, clearPreview, apply, check, rgb, hex: rgb2hex, shade, dark, initials, fallbackLogo, accent };
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
})();
