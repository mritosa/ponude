// Izračuni i izgled PDF ponude (pdfmake). Bez ovisnosti o DOM-u.
(function (root) {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v || '').trim().replace(/\s/g, '');
    if (!s) return 0;
    // "1.234,56" -> 1234.56 ; "12,5" -> 12.5 ; "12.5" -> 12.5
    const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = parseFloat(norm);
    return isFinite(n) ? n : 0;
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  function fmt(n) {
    return round2(n).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function lineValue(it) { return round2(num(it.kolicina) * num(it.cijena)); }

  function activeItems(stavke) {
    return (stavke || []).filter((it) => String(it.naziv || '').trim() || num(it.kolicina) || num(it.cijena));
  }

  function total(stavke) {
    return round2(activeItems(stavke).reduce((sum, it) => sum + lineValue(it), 0));
  }

  function stopaText(n) { return String(n).replace('.', ','); }

  // PDV stopa stavke; korisnik izvan sustava PDV-a uvijek ima 0.
  function itemPdv(it, s) {
    if (!s || !s.uPdv) return 0;
    return it.pdv === undefined || it.pdv === '' ? num(s.stopaPdv) : num(it.pdv);
  }

  // Osnovica, PDV po stopama i iznos za platiti.
  function calc(stavke, s) {
    const byRate = new Map();
    for (const it of activeItems(stavke)) {
      const rate = itemPdv(it, s);
      byRate.set(rate, round2((byRate.get(rate) || 0) + lineValue(it)));
    }
    const stope = [...byRate.entries()].sort((a, b) => b[0] - a[0])
      .map(([stopa, osnova]) => ({ stopa, osnova, pdv: round2((osnova * stopa) / 100) }));
    const osnovica = round2(stope.reduce((sum, r) => sum + r.osnova, 0));
    const pdv = round2(stope.reduce((sum, r) => sum + r.pdv, 0));
    return { osnovica, pdv, zaPlatiti: round2(osnovica + pdv), stope };
  }

  // --- Iznos slovima (hrvatski) ---
  const JED_M = ['', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
  const JED_Z = ['', 'jedna', 'dvije', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
  const NAEST = ['deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'];
  const DESET = ['', '', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'];
  const STO = ['', 'sto', 'dvjesto', 'tristo', 'četiristo', 'petsto', 'šesto', 'sedamsto', 'osamsto', 'devetsto'];

  function triple(n, zenski) {
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
    const out = [];
    if (h) out.push(STO[h]);
    if (t === 1) out.push(NAEST[u]);
    else {
      if (t) out.push(DESET[t]);
      if (u) out.push((zenski ? JED_Z : JED_M)[u]);
    }
    return out.join(' ');
  }

  // 1 -> oblik1, 2-4 -> oblik2, ostalo -> oblik5 (11-14 uvijek oblik5)
  function oblik(n, o1, o2, o5) {
    const zadnje2 = n % 100, zadnja = n % 10;
    if (zadnje2 >= 11 && zadnje2 <= 14) return o5;
    if (zadnja === 1) return o1;
    if (zadnja >= 2 && zadnja <= 4) return o2;
    return o5;
  }

  function cijeliSlovima(n) {
    if (n === 0) return 'nula';
    const parts = [];
    const mil = Math.floor(n / 1e6), tis = Math.floor((n % 1e6) / 1000), ost = n % 1000;
    if (mil) parts.push((mil === 1 ? '' : triple(mil, false) + ' ') + oblik(mil, 'milijun', 'milijuna', 'milijuna'));
    if (tis) parts.push(tis === 1 ? 'tisuću' : triple(tis, true) + ' ' + oblik(tis, 'tisuća', 'tisuće', 'tisuća'));
    if (ost) parts.push(triple(ost, false));
    return parts.join(' ');
  }

  function slovima(iznos) {
    const centiUkupno = Math.round(round2(iznos) * 100);
    const eura = Math.floor(centiUkupno / 100), centi = centiUkupno % 100;
    let s = cijeliSlovima(eura) + ' EUR';
    if (centi) s += ` i ${centi} ${oblik(centi, 'cent', 'centa', 'centi')}`;
    return s;
  }

  // --- Dokument ---
  const SIVA = '#d4d4d4';
  const SIVA_SVIJETLA = '#ececec';

  function lbl(text, extra) { return Object.assign({ text, bold: true, fontSize: 6.5 }, extra || {}); }
  function right(text, extra) { return Object.assign({ text, alignment: 'right' }, extra || {}); }

  const tableLines = {
    hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0),
    vLineWidth: () => 0,
    fillColor: (row) => (row === 0 ? SIVA : null),
    paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
  };

  // Naziv firme može imati više redaka; **tekst** se ispisuje podebljano.
  function firmaLines(s) { return String(s.firma || '').split('\n').map((t) => t.trim()).filter(Boolean); }
  function plain(t) { return String(t || '').replace(/\*\*/g, ''); }
  function rich(line) {
    return String(line).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
      .map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? { text: part.slice(2, -2), bold: true } : { text: part }));
  }

  function kupacBlock(k) {
    const lines = String(k.naziv || '').split('\n').map((t) => t.trim()).filter(Boolean);
    if (k.oib) lines.push('OIB: ' + k.oib);
    if (k.adresa) lines.push(k.adresa);
    let posta = String(k.posta || '').trim();
    if (posta && !/^[A-Z]{2}-/i.test(posta)) posta = 'HR-' + posta;
    return {
      stack: [
        ...lines.map((t) => ({ text: t })),
        { text: ' ' },
        { columns: [{ text: posta, width: 55 }, { text: String(k.mjesto || '').toUpperCase() }] },
      ],
      fontSize: 8,
    };
  }

  // Klasični izgled (po uzoru na ponude iz knjigovodstvenog programa).
  function buildKlasicni(d, s, logo) {
    const items = activeItems(d.stavke);
    const c = calc(d.stavke, s);
    const k = d.kupac || {};

    const itemRows = items.map((it, i) => {
      const opis = String(it.opis || '').split('\n').map((t) => t.trim()).filter(Boolean);
      const bottom = opis.length ? 6 : 1;
      return [
        { text: String(i + 1), margin: [0, 0, 0, bottom] },
        { stack: [{ text: it.naziv || '' }, ...opis.map((t) => ({ text: t, fontSize: 6.5 }))], margin: [0, 0, 0, bottom] },
        right(fmt(num(it.kolicina))),
        { text: it.jedinica || '' },
        right(fmt(num(it.cijena))),
        right('0,00'),
        right(fmt(itemPdv(it, s))),
        right(fmt(lineValue(it))),
      ];
    });

    const header = [
      lbl('Ident'), lbl('Naziv'), lbl('Količina', { alignment: 'right' }), lbl('Jed.'),
      lbl('Cijena', { alignment: 'right' }), lbl('R. %', { alignment: 'right' }),
      lbl('PDV %', { alignment: 'right' }), lbl('Vrijednost', { alignment: 'right' }),
    ];

    const content = [
      {
        columns: [
          logo ? { image: logo, width: 150 } : { text: firmaLines(s).map(plain).join('\n'), bold: true, fontSize: 16, width: 260 },
          { text: '', width: '*' },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              ...firmaLines(s).map((l) => ({ text: rich(l), bold: true })),
              { text: s.adresa, bold: true },
              { text: 'OIB: ' + s.oib, bold: true },
              { text: (s.dodatno || '').replace(/ {2,}/g, '   '), fontSize: 6, margin: [0, 5, 0, 0], lineHeight: 1.1 },
            ],
            fontSize: 7.5,
          },
        ],
        columnGap: 10,
      },

      { columns: [lbl('Kupac:', { fontSize: 5.5 }), lbl('Kupac:', { fontSize: 5.5 })], margin: [0, 30, 0, 1], columnGap: 20 },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6 }] },
      { columns: [kupacBlock(k), kupacBlock(k)], margin: [0, 3, 0, 0], columnGap: 20 },

      {
        margin: [0, 30, 0, 0],
        fontSize: 7.5,
        layout: 'noBorders',
        table: {
          widths: [50, 85, 60, 95, 70, '*'],
          body: [
            [lbl('Datum'), fmtDate(d.datum), lbl('Rok isporuke'), d.rokIsporuke || '', lbl('Dostava'), ''],
            [lbl('Valjanost'), fmtDate(d.valjanost), '', '', lbl('Odgovorna osoba'), d.odgovornaOsoba || ''],
          ],
        },
      },

      { text: [{ text: 'Ponuda  ', bold: true }, { text: d.broj }], fontSize: 15, margin: [0, 10, 0, 3] },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 2, x2: 515, y2: 2, lineWidth: 0.6 },
          { type: 'rect', x: 0, y: 0, w: 245, h: 4, color: '#000' },
        ],
      },

      {
        margin: [0, 32, 0, 0],
        fontSize: 7.5,
        layout: tableLines,
        table: { headerRows: 1, widths: [26, '*', 42, 28, 48, 26, 28, 58], body: [header, ...itemRows] },
      },

      {
        margin: [0, 10, 0, 0],
        columnGap: 15,
        columns: [
          {
            width: '*',
            fontSize: 7.5,
            layout: 'noBorders',
            table: {
              widths: [40, '*'],
              body: [
                [lbl('Por.br.'), ''],
                [lbl('OIB'), k.oib || ''],
                [lbl('Slovima'), slovima(c.zaPlatiti)],
              ],
            },
          },
          {
            width: 210,
            fontSize: 7.5,
            table: {
              widths: [65, '*', 75],
              body: [
                [lbl('Ukupno'), '', right(fmt(c.osnovica))],
                [lbl('PDV'), '', right(fmt(c.pdv))],
                [lbl('Za platiti'), lbl('EUR'), right(fmt(c.zaPlatiti), { bold: true, fontSize: 8.5 })],
              ],
            },
            layout: {
              hLineWidth: (i) => (i === 2 || i === 3 ? 0.8 : 0),
              vLineWidth: (i) => (i === 0 ? 0.8 : 0),
              fillColor: (row, node, col) => (col === 1 ? SIVA_SVIJETLA : null),
              paddingTop: () => 3, paddingBottom: () => 3,
            },
          },
        ],
      },

      {
        margin: [0, 10, 0, 0],
        fontSize: 7.5,
        layout: tableLines,
        table: {
          widths: ['*', 80, 110, 80],
          body: [
            [lbl('POREZNE STOPE'), lbl('Osnova', { alignment: 'right' }), lbl('PDV', { alignment: 'center' }), lbl('Vrijednost', { alignment: 'right' })],
            ...(s.uPdv
              ? (c.stope.length ? c.stope : [{ stopa: num(s.stopaPdv), osnova: 0, pdv: 0 }]).map((r) => [
                `PDV ${stopaText(r.stopa)}%`, right(fmt(r.osnova)), { text: fmt(r.pdv), alignment: 'center' }, right(fmt(r.osnova + r.pdv)),
              ])
              : [[s.porezNapomena || '', right(fmt(c.osnovica)), { text: '0,00', alignment: 'center' }, right(fmt(c.osnovica))]]),
          ],
        },
      },
    ];

    if (String(d.napomena || '').trim()) {
      content.push({ text: d.napomena.trim(), fontSize: 8, margin: [3, 35, 0, 0], lineHeight: 1.15 });
    }
    content.push(
      { text: s.napomenaDno || '', bold: true, fontSize: 10, margin: [3, d.napomena ? 18 : 35, 0, 1] },
      { text: s.uPdv ? '' : s.pdvNapomena || '', bold: true, fontSize: 7, margin: [3, 0, 0, 0] },
      { text: `Pri plaćanju platnim nalogom navedite model 00 i poziv ${d.broj}.`, fontSize: 7.5, margin: [0, 40, 0, 0] },
    );

    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 50],
      defaultStyle: { font: 'Roboto', fontSize: 8 },
      info: { title: 'Ponuda ' + d.broj, author: plain(firmaLines(s).join(' ')) },
      footer: (cur, count) => ({
        text: [{ text: 'Strana   ', bold: true }, `${cur}/${count}`],
        alignment: 'center', fontSize: 7, margin: [0, 15, 0, 0],
      }),
      content,
    };
  }

  // Moderni izgled: logo, linija u boji firme, podaci firme lijevo, klijent desno, podnožje s podacima firme.
  function buildModerni(d, s, logo) {
    const boja = s.boja || '#f7941d';
    const W = 505;
    const SVIJETLA_LINIJA = '#dddddd';
    const items = activeItems(d.stavke);
    const c = calc(d.stavke, s);
    const k = d.kupac || {};
    const firma = firmaLines(s);

    const firmaStack = [
      ...firma.map((l) => ({ text: rich(l) })),
      s.adresa ? { text: s.adresa } : null,
      s.oib ? { text: [{ text: 'OIB', bold: true }, ': ' + s.oib] } : null,
      s.dodatno ? { text: s.dodatno.replace(/ {2,}/g, '   '), fontSize: 7, color: '#444444', margin: [0, 3, 0, 0] } : null,
    ].filter(Boolean);

    const posta = String(k.posta || '').trim();
    const kupacStack = [
      { text: 'KLIJENT:' },
      ...String(k.naziv || '').split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t })),
      k.adresa ? { text: k.adresa } : null,
      posta || k.mjesto ? { text: [posta, k.mjesto].filter(Boolean).join(' ') } : null,
      k.oib ? { text: [{ text: 'OIB', bold: true }, ': ' + k.oib] } : null,
    ].filter(Boolean);

    const detalji = [
      d.valjanost ? ['Vrijedi do: ', fmtDate(d.valjanost)] : null,
      d.rokIsporuke ? ['Rok isporuke: ', d.rokIsporuke] : null,
      d.odgovornaOsoba ? ['Odgovorna osoba: ', d.odgovornaOsoba] : null,
    ].filter(Boolean).map(([l, v]) => ({ text: [{ text: l, color: '#555555' }, v] }));

    const th = (text, alignment) => ({ text, bold: true, alignment: alignment || 'left' });
    const header = [th('R.br.'), th('Opis'), th('Količina', 'right'), th('Jed.'), th('Cijena', 'right'),
      ...(s.uPdv ? [th('PDV', 'right')] : []), th('Iznos', 'right')];
    const rows = items.map((it, i) => {
      const opis = String(it.opis || '').split('\n').map((t) => t.trim()).filter(Boolean);
      return [
        String(i + 1) + '.',
        { stack: [{ text: it.naziv || '' }, ...opis.map((t) => ({ text: t, fontSize: 7.5, color: '#555555' }))] },
        right(fmt(num(it.kolicina))),
        it.jedinica || '',
        right(fmt(num(it.cijena))),
        ...(s.uPdv ? [right(stopaText(itemPdv(it, s)) + '%')] : []),
        right(fmt(lineValue(it))),
      ];
    });
    const body = [header, ...rows];

    const totals = s.uPdv
      ? [
        ['Osnovica', right(fmt(c.osnovica) + ' €')],
        ...c.stope.map((r) => [`PDV ${stopaText(r.stopa)}% (na ${fmt(r.osnova)} €)`, right(fmt(r.pdv) + ' €')]),
        [{ text: 'Ukupno za platiti', bold: true }, right(fmt(c.zaPlatiti) + ' €', { bold: true, fontSize: 11 })],
      ]
      : [[{ text: 'Ukupno za platiti', bold: true }, right(fmt(c.zaPlatiti) + ' €', { bold: true, fontSize: 11 })]];

    const content = [
      logo ? { image: logo, width: 165 } : { text: firma.map(plain).join(' '), bold: true, fontSize: 18, color: boja },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: W, y2: 0, lineWidth: 2.5, lineColor: boja }], margin: [0, 8, 0, 0] },
      {
        margin: [0, 10, 0, 0],
        columnGap: 20,
        columns: [
          { width: '*', stack: firmaStack, fontSize: 8, lineHeight: 1.15 },
          { width: 175, stack: kupacStack, fontSize: 9.5, lineHeight: 1.15 },
        ],
      },
      {
        margin: [0, 32, 0, 3],
        columns: [
          {
            width: '*',
            stack: [
              { text: [{ text: 'Ponuda br. ', bold: true }, { text: d.broj, bold: true }], fontSize: 13 },
              { text: 'Datum: ' + fmtDate(d.datum), fontSize: 11.5 },
            ],
          },
          { width: 'auto', stack: detalji, fontSize: 8, alignment: 'right', margin: [0, 6, 0, 0] },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: W, y2: 0, lineWidth: 1.2 }] },
      {
        margin: [0, 18, 0, 0],
        fontSize: 8.5,
        table: {
          headerRows: 1,
          widths: s.uPdv ? [24, '*', 48, 30, 56, 34, 64] : [24, '*', 50, 32, 62, 70],
          body,
        },
        layout: {
          hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 || i === node.table.body.length ? 1.2 : 0.5),
          hLineColor: (i, node) => (i === 1 || i === node.table.body.length ? boja : SVIJETLA_LINIJA),
          vLineWidth: () => 0,
          paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 5, paddingBottom: () => 5,
        },
      },
      {
        margin: [0, 10, 0, 0],
        unbreakable: true,
        columnGap: 20,
        columns: [
          { width: '*', text: [{ text: 'Slovima: ', color: '#555555' }, slovima(c.zaPlatiti)], fontSize: 8, margin: [3, 4, 0, 0] },
          {
            width: 230,
            fontSize: 9,
            table: { widths: ['*', 'auto'], body: totals },
            layout: {
              hLineWidth: (i, node) => (i === node.table.body.length - 1 ? 1.2 : 0),
              hLineColor: () => boja,
              vLineWidth: () => 0,
              paddingTop: () => 3, paddingBottom: () => 3,
            },
          },
        ],
      },
    ];

    if (String(d.napomena || '').trim()) {
      content.push({ text: d.napomena.trim(), fontSize: 9, margin: [0, 30, 0, 0], lineHeight: 1.2 });
    }
    content.push(
      { text: s.napomenaDno || '', bold: true, fontSize: 10, margin: [0, d.napomena ? 16 : 30, 0, 1] },
      { text: s.uPdv ? '' : s.pdvNapomena || '', fontSize: 7.5, color: '#444444' },
      { text: `Pri plaćanju navedite poziv na broj ${d.broj}.`, fontSize: 8, margin: [0, 16, 0, 0] },
    );

    // Podnožje: uzastopni obični retci naziva spajaju se u jedan, podebljani idu zasebno.
    const footerLines = [];
    for (const l of firma) {
      const bold = /^\*\*[^*]+\*\*$/.test(l);
      const last = footerLines[footerLines.length - 1];
      if (!bold && last && !last.bold) last.text += ' ' + plain(l);
      else footerLines.push({ text: bold ? plain(l) : l, bold });
    }
    const adresaOib = [s.adresa || '', ...(s.oib ? [' ', { text: 'OIB', bold: true }, ': ' + s.oib] : [])];

    return {
      pageSize: 'A4',
      pageMargins: [45, 40, 45, 80],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      info: { title: 'Ponuda ' + d.broj, author: plain(firma.join(' ')) },
      footer: (cur, count) => ({
        margin: [45, 22, 45, 0],
        alignment: 'center',
        fontSize: 7.5,
        stack: [
          ...footerLines.map((l) => ({ text: l.bold ? l.text : rich(l.text), bold: l.bold })),
          { text: adresaOib },
          count > 1 ? { text: `Stranica ${cur}/${count}`, color: '#777777', margin: [0, 3, 0, 0] } : null,
        ].filter(Boolean),
      }),
      content,
    };
  }

  const PREDLOSCI = { klasicni: buildKlasicni, moderni: buildModerni };
  function buildDoc(d, s, logo) {
    return (PREDLOSCI[s.predlozak] || buildKlasicni)(d, s, logo);
  }

  const api = { num, fmt, fmtDate, lineValue, total, calc, itemPdv, slovima, buildDoc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PonudaPDF = api;
})(this);
