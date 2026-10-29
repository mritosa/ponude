(function () {
  'use strict';
  const { num, fmt, fmtDate, lineValue, total, buildDoc } = window.PonudaPDF;

  const KEY = { settings: 'bp_settings', draft: 'bp_draft', history: 'bp_history', customers: 'bp_customers', counter: 'bp_counter' };
  const JEDINICE = ['M2', 'M3', 'M1', 'KOM', 'SAT', 'PAU', 'KG', 'L'];

  const DEFAULT_SETTINGS = {
    firma: 'Barać završni radovi d.o.o.',
    adresa: 'Čipri 43A, HR-52000 Grad Pazin, Beram',
    oib: '76969933299',
    dodatno: 'Registrirano na Trgovačkom sudu u Pazinu\nOsnivači/članovi društva: Božo Barać\nIBAN: HR1724020061101309107\nERSTE&STEIERMÄRKISCHE BANK d.d.        SWIFT:ESBCHR22',
    odgovornaOsoba: 'Hani Benazić',
    srednjiDio: '010',
    valjanostDana: 5,
    porezNapomena: 'Roba - PDV se ne obračunava i ne plaća',
    napomenaDno: 'Ova ponuda važeća je bez pečata i potpisa.',
    pdvNapomena: 'Obveznik nije u sustavu PDV-a, PDV nije obračunat temeljem čl.90., st.1 i st.2 Zakona o PDV-u (NN 73/13)',
    logo: null,
  };

  // --- spremanje u preglednik ---
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { toast('Spremanje nije uspjelo (memorija preglednika)'); return false; }
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS, load(KEY.settings, {}));
  let draft = load(KEY.draft, null) || newDraft();
  let lastPdf = null; // { blob, name }

  const $ = (id) => document.getElementById(id);

  // --- datumi i brojevi ---
  function today() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + Number(n || 0));
    return d.toISOString().slice(0, 10);
  }
  function yy(iso) { return (iso || today()).slice(2, 4); }

  function counterFor(year) {
    const c = load(KEY.counter, null);
    return c && c.year === year ? c.next : 1;
  }
  function formatBroj(year, n) { return `${year}-${settings.srednjiDio}-${String(n).padStart(6, '0')}`; }
  function takeNextBroj(iso) {
    const year = yy(iso);
    const n = counterFor(year);
    save(KEY.counter, { year, next: n + 1 });
    return formatBroj(year, n);
  }

  function emptyItem() { return { naziv: '', opis: '', kolicina: '', jedinica: 'M2', cijena: '' }; }
  function newDraft() {
    const datum = today();
    return {
      broj: null,
      kupac: { naziv: '', adresa: '', posta: '', mjesto: '', oib: '' },
      datum,
      valjanost: addDays(datum, settings.valjanostDana),
      rokIsporuke: '',
      odgovornaOsoba: settings.odgovornaOsoba,
      stavke: [emptyItem()],
      napomena: '',
    };
  }

  function persistDraft() { save(KEY.draft, draft); }

  // --- forma ---
  const simpleFields = {
    k_naziv: ['kupac', 'naziv'], k_adresa: ['kupac', 'adresa'], k_posta: ['kupac', 'posta'],
    k_mjesto: ['kupac', 'mjesto'], k_oib: ['kupac', 'oib'],
    datum: [null, 'datum'], valjanost: [null, 'valjanost'], rokIsporuke: [null, 'rokIsporuke'],
    odgovornaOsoba: [null, 'odgovornaOsoba'], napomena: [null, 'napomena'],
  };

  function fillForm() {
    for (const [id, [group, key]] of Object.entries(simpleFields)) {
      $(id).value = (group ? draft[group][key] : draft[key]) || '';
    }
    renderItems();
    renderHeader();
    renderCustomers();
  }

  function renderHeader() {
    $('formTitle').textContent = draft.broj ? 'Uređivanje ponude' : 'Nova ponuda';
    $('brojLabel').textContent = draft.broj ? `br. ${draft.broj}` : `br. ${formatBroj(yy(draft.datum), counterFor(yy(draft.datum)))}`;
  }

  function renderTotal() { $('total').textContent = fmt(total(draft.stavke)) + ' €'; }

  function renderItems() {
    const box = $('items');
    box.innerHTML = '';
    draft.stavke.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="item-head"><span class="num">Stavka ${i + 1}</span><button class="del" aria-label="Obriši stavku">✕</button></div>
        <input class="i-naziv" placeholder="Naziv, npr. Farbanje zidova u bijelo">
        <textarea class="i-opis" rows="1" placeholder="Dodatni opis (neobavezno, svaki red posebno)"></textarea>
        <div class="row3">
          <label>Količina<input class="i-kol" inputmode="decimal" placeholder="0"></label>
          <label>Jed. mjera<select class="i-jed">${JEDINICE.map((j) => `<option>${j}</option>`).join('')}</select></label>
          <label>Cijena €<input class="i-cij" inputmode="decimal" placeholder="0,00"></label>
        </div>
        <div class="item-val"></div>`;
      const q = (sel) => el.querySelector(sel);
      const showVal = () => { q('.item-val').textContent = '= ' + fmt(lineValue(it)) + ' €'; };
      if (it.jedinica && !JEDINICE.includes(it.jedinica)) q('.i-jed').append(new Option(it.jedinica));
      q('.i-naziv').value = it.naziv || '';
      q('.i-opis').value = it.opis || '';
      q('.i-kol').value = it.kolicina || '';
      q('.i-jed').value = it.jedinica || 'M2';
      q('.i-cij').value = it.cijena || '';
      showVal();
      const bind = (sel, key) => q(sel).addEventListener('input', (e) => {
        it[key] = e.target.value;
        showVal(); renderTotal(); persistDraft();
      });
      bind('.i-naziv', 'naziv'); bind('.i-opis', 'opis'); bind('.i-kol', 'kolicina'); bind('.i-jed', 'jedinica'); bind('.i-cij', 'cijena');
      q('.del').addEventListener('click', () => {
        if ((it.naziv || it.cijena) && !confirm('Obrisati stavku ' + (i + 1) + '?')) return;
        draft.stavke.splice(i, 1);
        if (!draft.stavke.length) draft.stavke.push(emptyItem());
        renderItems(); persistDraft();
      });
      box.append(el);
    });
    renderTotal();
  }

  function renderCustomers() {
    const list = load(KEY.customers, []);
    const sel = $('savedCustomers');
    sel.hidden = !list.length;
    sel.innerHTML = '<option value="">📇 Odaberi spremljenog kupca…</option>' +
      list.map((c, i) => `<option value="${i}"></option>`).join('');
    list.forEach((c, i) => { sel.options[i + 1].textContent = c.naziv.split('\n')[0]; });
    sel.style.marginBottom = '10px';
  }

  function bindForm() {
    for (const [id, [group, key]] of Object.entries(simpleFields)) {
      $(id).addEventListener('input', (e) => {
        if (group) draft[group][key] = e.target.value; else draft[key] = e.target.value;
        if (id === 'datum' && e.target.value) {
          draft.valjanost = addDays(e.target.value, settings.valjanostDana);
          $('valjanost').value = draft.valjanost;
          renderHeader();
        }
        persistDraft();
      });
    }
    $('savedCustomers').addEventListener('change', (e) => {
      const c = load(KEY.customers, [])[e.target.value];
      if (c) { draft.kupac = Object.assign({}, c); fillForm(); persistDraft(); }
      e.target.value = '';
    });
    $('btnAdd').addEventListener('click', () => {
      draft.stavke.push(emptyItem());
      renderItems(); persistDraft();
      const all = document.querySelectorAll('.i-naziv');
      all[all.length - 1].focus();
    });
    $('btnNew').addEventListener('click', () => {
      if (!confirm('Započeti novu, praznu ponudu? (Trenutna je spremljena ako je već generirana.)')) return;
      draft = newDraft(); persistDraft(); fillForm(); window.scrollTo(0, 0);
    });
    $('btnGenerate').addEventListener('click', generate);
  }

  // --- generiranje ---
  function rememberCustomer(k) {
    if (!String(k.naziv || '').trim()) return;
    const list = load(KEY.customers, []).filter((c) => c.naziv.trim() !== k.naziv.trim());
    list.unshift(Object.assign({}, k));
    save(KEY.customers, list.slice(0, 100));
  }

  function rememberQuote(d) {
    const list = load(KEY.history, []).filter((h) => h.broj !== d.broj);
    list.unshift({ broj: d.broj, datum: d.datum, kupac: (d.kupac.naziv || '').split('\n')[0], iznos: total(d.stavke), data: JSON.parse(JSON.stringify(d)) });
    save(KEY.history, list.slice(0, 300));
  }

  function makePdf(d) {
    return new Promise((resolve, reject) => {
      try {
        pdfMake.createPdf(buildDoc(d, settings, settings.logo || window.DEFAULT_LOGO)).getBlob(resolve);
      } catch (e) { reject(e); }
    });
  }

  async function generate() {
    const filled = draft.stavke.filter((it) => String(it.naziv || '').trim());
    if (!filled.length) { toast('Upiši barem jednu stavku'); return; }
    const missingPrice = filled.find((it) => !num(it.kolicina) || !num(it.cijena));
    if (missingPrice && !confirm(`Stavka "${missingPrice.naziv}" nema količinu ili cijenu. Svejedno generirati?`)) return;

    const btn = $('btnGenerate');
    btn.disabled = true; btn.textContent = 'Generiram…';
    try {
      if (!draft.broj) draft.broj = takeNextBroj(draft.datum);
      persistDraft();
      const blob = await makePdf(draft);
      lastPdf = { blob, name: `PONUDA_${draft.broj}.pdf` };
      rememberQuote(draft);
      rememberCustomer(draft.kupac);
      renderHeader(); renderCustomers();
      downloadPdf();
      $('doneTitle').textContent = `Ponuda ${draft.broj} je spremna`;
      $('btnShare').hidden = !canShare();
      $('dlgDone').showModal();
    } catch (e) {
      console.error(e);
      alert('Greška pri izradi PDF-a: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Generiraj ponudu';
    }
  }

  function pdfFile() { return new File([lastPdf.blob], lastPdf.name, { type: 'application/pdf' }); }
  function canShare() {
    try { return !!(navigator.canShare && navigator.canShare({ files: [pdfFile()] })); } catch (e) { return false; }
  }
  function downloadPdf() {
    const url = URL.createObjectURL(lastPdf.blob);
    const a = document.createElement('a');
    a.href = url; a.download = lastPdf.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function sharePdf() {
    try { await navigator.share({ files: [pdfFile()], title: lastPdf.name }); }
    catch (e) { if (e.name !== 'AbortError') toast('Dijeljenje nije uspjelo'); }
  }
  function openPdf() { window.open(URL.createObjectURL(lastPdf.blob), '_blank'); }

  // --- spremljene ponude ---
  function renderHistory() {
    const list = load(KEY.history, []);
    const box = $('historyList');
    box.innerHTML = list.length ? '' : '<p class="muted">Još nema generiranih ponuda.</p>';
    list.forEach((h) => {
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `<div><strong></strong></div><div class="meta"></div>
        <div class="acts"><button data-a="open">Otvori</button><button data-a="pdf">PDF</button><button data-a="copy">Kopiraj u novu</button></div>`;
      row.querySelector('strong').textContent = h.broj + ' · ' + fmt(h.iznos) + ' €';
      row.querySelector('.meta').textContent = fmtDate(h.datum) + ' · ' + (h.kupac || 'bez kupca');
      row.querySelector('.acts').addEventListener('click', async (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        if (a === 'open') {
          draft = JSON.parse(JSON.stringify(h.data));
        } else if (a === 'copy') {
          const fresh = newDraft();
          draft = Object.assign(JSON.parse(JSON.stringify(h.data)), { broj: null, datum: fresh.datum, valjanost: fresh.valjanost });
        } else if (a === 'pdf') {
          lastPdf = { blob: await makePdf(h.data), name: `PONUDA_${h.broj}.pdf` };
          downloadPdf();
          return;
        }
        persistDraft(); fillForm(); $('dlgHistory').close(); window.scrollTo(0, 0);
      });
      box.append(row);
    });
  }

  // --- postavke ---
  const settingFields = {
    s_firma: 'firma', s_adresa: 'adresa', s_oib: 'oib', s_dodatno: 'dodatno', s_odgovorna: 'odgovornaOsoba',
    s_srednji: 'srednjiDio', s_valjanost: 'valjanostDana', s_porez: 'porezNapomena', s_napDno: 'napomenaDno', s_pdv: 'pdvNapomena',
  };
  let pendingLogo;

  function openSettings() {
    for (const [id, key] of Object.entries(settingFields)) $(id).value = settings[key] ?? '';
    $('s_next').value = counterFor(yy(today()));
    pendingLogo = settings.logo;
    $('s_logoPrev').src = pendingLogo || window.DEFAULT_LOGO;
    $('s_logo').value = '';
    $('dlgSettings').showModal();
  }

  function saveSettings() {
    for (const [id, key] of Object.entries(settingFields)) settings[key] = $(id).value;
    settings.valjanostDana = Math.max(0, parseInt(settings.valjanostDana, 10) || 0);
    settings.logo = pendingLogo || null;
    const next = parseInt($('s_next').value, 10);
    if (next > 0) save(KEY.counter, { year: yy(today()), next });
    if (save(KEY.settings, settings)) {
      $('dlgSettings').close(); renderHeader(); toast('Postavke spremljene');
    }
  }

  function readLogo(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // smanji na razumnu veličinu da stane u memoriju preglednika
        const scale = Math.min(1, 1200 / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        pendingLogo = c.toDataURL('image/jpeg', 0.9);
        $('s_logoPrev').src = pendingLogo;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // --- ostalo ---
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2500);
  }

  function init() {
    bindForm();
    fillForm();
    $('btnShare').addEventListener('click', sharePdf);
    $('btnDownload').addEventListener('click', downloadPdf);
    $('btnOpen').addEventListener('click', openPdf);
    $('btnDoneClose').addEventListener('click', () => $('dlgDone').close());
    $('btnHistory').addEventListener('click', () => { renderHistory(); $('dlgHistory').showModal(); });
    $('btnHistoryClose').addEventListener('click', () => $('dlgHistory').close());
    $('btnSettings').addEventListener('click', openSettings);
    $('btnSettingsSave').addEventListener('click', saveSettings);
    $('btnSettingsClose').addEventListener('click', () => $('dlgSettings').close());
    $('s_logo').addEventListener('change', (e) => { if (e.target.files[0]) readLogo(e.target.files[0]); });
    $('btnLogoReset').addEventListener('click', () => { pendingLogo = null; $('s_logoPrev').src = window.DEFAULT_LOGO; });

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
