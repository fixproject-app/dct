/* ============================================================
   KONFIGURASI PROYEK — isi nilai Supabase Anda (sekali saja).
   Supabase → Project Settings → API:
   - SUPABASE_URL      = "Project URL"
   - SUPABASE_ANON_KEY = "anon public" / "Publishable" key  (JANGAN pakai service_role / secret)
   Aturan: satu baris per nilai, di antara tanda kutip lurus ' ' (bukan kutip melengkung).
   Blok BRAND bersifat opsional; admin tetap bisa mengubahnya di menu Pengaturan > Identitas & Tampilan
   (nilai yang disimpan di sana lebih diutamakan).
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://zncoxvmligixcukekbzq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_n1Xw6dAuY3ovaMEI3_9-pA_qgkVM1FH',

  BRAND: {
    appName: 'DCT',
    tagline: 'MANAGEMENT INVENTORY',
    perusahaan: '',          // nama bisnis di header invoice (kosong = pakai nama aplikasi)
    alamat: '',
    telepon: '',
    logoUrl: '',             // kosong = logo inisial otomatis
    faviconUrl: '',          // kosong = pakai logo
    primaryColor: '#7CF40B',
    secondaryColor: '#F4600B',
    sidebarColor: '#1B0352',
    poweredBy: 'Copyright ©2026 DODOY|FIX PROJECT'            // mis. 'Fix Projects' untuk menampilkan "Didukung oleh ..." di halaman login
  }
};
