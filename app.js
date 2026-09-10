'use strict';

/* ============================================================
   TEMA
   ============================================================ */

(function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch (e) {
    /* ignore */
  }
  const prefersDark =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const current =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch (e) {
    /* ignore */
  }
});

/* ============================================================
   ESTADO
   ============================================================ */

let products = [];
let nextId = 1;
let lastMatchedIds = [];

// Dados gerais lidos do XML da NF-e. Enquanto não houver XML carregado,
// Suframa/Outras Despesas não é calculado e o rateio de frete usa a soma
// ao vivo da tabela como base.
const nota = {
  loaded: false,
  valorTotalProdutos: 0,
  valorTotalNota: 0
};

function newId() {
  return 'r' + nextId++;
}

function createBlankRow() {
  return {
    id: newId(),
    checked: false,
    descricao: '',
    quantidade: '',
    valorUnitario: '',
    qtdCaixa: '1',
    icmsPct: '0',
    cProd: '',
    cEAN: ''
  };
}

/* ============================================================
   UTILIDADES NUMÉRICAS / TEXTO
   ============================================================ */

function parseNumberBR(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  let s = String(v).trim();
  if (s === '') return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Equivalente ao para_float do app.py: troca vírgula por ponto, sem mexer
// em separador de milhar (o Multiplicador da GDD é sempre um percentual curto).
function multiplicadorParaFloat(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function formatBRL(n) {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPct(p) {
  return (
    (p || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + '%'
  );
}

// Normalização usada apenas na detecção de linhas de frete da GDD
// (remove acentos e baixa a caixa para casar "serviço" / "servico" etc.).
function normalizeLoose(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Normalização de descrição para o match de produto — espelha
// normalizar_descricao do app.py: caixa alta, remove o sufixo "LOTE - N"
// e colapsa espaços. NÃO remove acentos (as duas pontas vêm do mesmo ERP).
function normalizarDescricao(v) {
  let t = String(v == null ? '' : v).toUpperCase();
  t = t.replace(/LOTE\s*-\s*\d+/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function limparGtin(v) {
  const t = String(v == null ? '' : v).trim();
  return t ? t.split(/\s+/)[0] : '';
}

function ehTributoCestaBasica(t) {
  const u = String(t == null ? '' : t).toUpperCase();
  return u.includes('CESTA BÁSICA') || u.includes('CESTA BASICA');
}

function setStatus(elId, msg, kind) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

/* ============================================================
   MATCH DE LINHAS POR DESCRIÇÃO
   ============================================================ */

function findRowByDesc(desc) {
  const nd = normalizarDescricao(desc);
  if (!nd) return null;
  return products.find((r) => normalizarDescricao(r.descricao) === nd) || null;
}

function flashMatchedRows() {
  if (!lastMatchedIds.length) return;
  const ids = lastMatchedIds.slice();
  lastMatchedIds = [];
  requestAnimationFrame(() => {
    ids.forEach((id) => {
      const tr = tbody.querySelector(`tr[data-id="${id}"]`);
      if (tr) tr.classList.add('row-matched');
    });
    setTimeout(() => {
      ids.forEach((id) => {
        const tr = tbody.querySelector(`tr[data-id="${id}"]`);
        if (tr) tr.classList.remove('row-matched');
      });
    }, 2200);
  });
}

/* ============================================================
   IMPORTAÇÃO XML (NF-e)
   ============================================================ */

document.getElementById('xmlInput').addEventListener('change', (e) => {
  processXmlFile(e.target.files[0]);
  e.target.value = '';
});

setupDropzone('xmlDropzone', processXmlFile);

function tagText(parent, tag) {
  const el = parent.getElementsByTagName(tag)[0];
  return el ? el.textContent.trim() : '';
}

function processXmlFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(reader.result, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) {
        throw new Error('arquivo XML inválido.');
      }
      const dets = doc.getElementsByTagName('det');
      if (!dets.length) {
        throw new Error('nenhum item <det> encontrado no XML.');
      }

      const novos = [];
      let somaProdutos = 0;

      for (const det of dets) {
        const xProd = tagText(det, 'xProd');
        if (!xProd) continue;
        const qCom = parseFloat(tagText(det, 'qCom')) || 0;
        const vUnCom = parseFloat(tagText(det, 'vUnCom')) || 0;
        const vProd = parseFloat(tagText(det, 'vProd')) || 0;
        somaProdutos += vProd;

        const row = createBlankRow();
        row.descricao = xProd;
        row.quantidade = String(qCom);
        row.valorUnitario = String(vUnCom);
        row.cProd = tagText(det, 'cProd');
        row.cEAN = tagText(det, 'cEAN');
        novos.push(row);
      }

      if (!novos.length) throw new Error('nenhum produto válido no XML.');

      // vNF (valor total da nota). Sem ele, usa a soma dos produtos.
      const vNFEl = doc.getElementsByTagName('vNF')[0];
      const valorNota = vNFEl ? parseFloat(vNFEl.textContent) || somaProdutos : somaProdutos;

      products = novos;
      nota.loaded = true;
      nota.valorTotalProdutos = somaProdutos;
      nota.valorTotalNota = valorNota;

      hideGddWarning();
      renderTable();
      setStatus(
        'xmlStatus',
        `${novos.length} produto(s) importado(s) de "${file.name}". ` +
          `Total produtos ${formatBRL(somaProdutos)} · Nota ${formatBRL(valorNota)}.`,
        'ok'
      );
    } catch (err) {
      setStatus('xmlStatus', 'Erro ao ler XML: ' + err.message, 'err');
    }
  };
  reader.onerror = () => setStatus('xmlStatus', 'Erro ao ler o arquivo.', 'err');
  reader.readAsText(file);
}

/* ============================================================
   IMPORTAÇÃO PLANILHA GDD
   ============================================================ */

document.getElementById('gddInput').addEventListener('change', (e) => {
  processGddFile(e.target.files[0]);
  e.target.value = '';
});

setupDropzone('gddDropzone', processGddFile);

function processGddFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
      const parsed = extrairGDD(wb);

      if (!parsed) {
        throw new Error(
          "não foi possível localizar a coluna 'Multiplicador' na planilha GDD."
        );
      }

      // ---- frete ----
      let freteMsg = '';
      if (parsed.frete) {
        document.getElementById('freteValorInput').value =
          parsed.frete.valor.toFixed(2);
        document.getElementById('freteIcmsInput').value =
          parsed.frete.icms.toFixed(2);
        freteMsg =
          ` Frete: ${formatBRL(parsed.frete.valor)} · ICMS frete: ` +
          `${formatBRL(parsed.frete.icms)}.`;
      }

      // ---- ICMS % dos produtos ----
      const naoEncontrados = [];
      let casados = 0;

      if (!products.length) {
        setStatus(
          'gddStatus',
          `Frete importado de "${file.name}".${freteMsg} ` +
            'Carregue o XML da NF-e para casar o ICMS dos produtos.',
          'warn'
        );
        recomputeAll();
        return;
      }

      products.forEach((row) => {
        let valor = parsed.byCprod.get(String(row.cProd || '').trim());
        if (valor === undefined) valor = parsed.byGtin.get(limparGtin(row.cEAN));
        if (valor === undefined)
          valor = parsed.byDesc.get(normalizarDescricao(row.descricao));

        if (valor === undefined) {
          naoEncontrados.push(row.descricao);
        } else {
          row.icmsPct = String(valor);
          lastMatchedIds.push(row.id);
          casados++;
        }
      });

      renderTable();
      flashMatchedRows();

      if (naoEncontrados.length) {
        showGddWarning(naoEncontrados);
        setStatus(
          'gddStatus',
          `${casados} produto(s) casado(s), ${naoEncontrados.length} sem ` +
            `correspondência em "${file.name}".${freteMsg}`,
          'warn'
        );
      } else {
        hideGddWarning();
        setStatus(
          'gddStatus',
          `${casados} produto(s) casado(s) de "${file.name}". ` +
            `Todos encontrados.${freteMsg}`,
          'ok'
        );
      }
    } catch (err) {
      setStatus('gddStatus', 'Erro ao ler planilha: ' + err.message, 'err');
    }
  };
  reader.onerror = () => setStatus('gddStatus', 'Erro ao ler o arquivo.', 'err');
  reader.readAsArrayBuffer(file);
}

// Replica a lógica de app.py: acha a linha de cabeçalho pela presença de
// "Multiplicador", trata Cesta Básica (multiplicador zerado na linha do
// produto, alíquota real na linha-resumo do fundo) e monta os dicionários
// de match por cProd -> GTIN -> descrição. Também extrai o frete FOB.
function extrairGDD(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null
    });

    let headerIdx = -1;
    const limite = Math.min(10, rows.length);
    for (let i = 0; i < limite; i++) {
      const r = rows[i];
      if (r && r.some((c) => String(c == null ? '' : c).includes('Multiplicador'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const headers = (rows[headerIdx] || []).map((c) =>
      String(c == null ? '' : c).trim()
    );
    const col = (pred) => headers.findIndex(pred);
    const iMult = col((h) => h === 'Multiplicador');
    const iCprod = col((h) => h === 'CODG. Produto');
    const iGtin = col((h) => h === 'GTIN');
    const iDesc = col((h) => h === 'Descrição' || h === 'Descricao');
    const iTributo = col((h) => h === 'Tributo Tipo');
    const iBCalc = col((h) => /^b\.?\s*c[aá]lculo$/i.test(h));
    const iIcms = col((h) => /icms/i.test(h) && !/multiplic/i.test(h));

    const data = [];
    for (let d = headerIdx + 1; d < rows.length; d++) {
      const r = rows[d];
      if (!r) continue;
      data.push({
        mult: iMult >= 0 ? r[iMult] : null,
        cprod: iCprod >= 0 ? r[iCprod] : '',
        gtin: iGtin >= 0 ? r[iGtin] : '',
        desc: iDesc >= 0 ? r[iDesc] : '',
        tributo: iTributo >= 0 ? r[iTributo] : '',
        bcalc: iBCalc >= 0 ? r[iBCalc] : null,
        icms: iIcms >= 0 ? r[iIcms] : null
      });
    }

    // ---- frete FOB antecipado (tributos 1339 / 1415) ----
    let freteValor = 0;
    let freteIcms = 0;
    let temFrete = false;
    data.forEach((linha) => {
      const nt = normalizeLoose(linha.tributo);
      const nd = normalizeLoose(linha.desc);
      const isFrete =
        nt.startsWith('1339') ||
        nt.startsWith('1415') ||
        nd.includes('frete fob antecipado') ||
        nd.includes('servico de transporte contratado');
      if (isFrete) {
        temFrete = true;
        freteValor += parseNumberBR(linha.bcalc);
        freteIcms += parseNumberBR(linha.icms);
      }
    });

    // ---- alíquota da linha-resumo da cesta básica ----
    let multCestaBasica = null;
    for (const linha of data) {
      if (linha.mult == null || linha.mult === '') continue;
      if (!ehTributoCestaBasica(linha.tributo)) continue;
      const v = multiplicadorParaFloat(linha.mult);
      if (v > 0) {
        multCestaBasica = v;
        break;
      }
    }

    // ---- dicionários de match ----
    const byCprod = new Map();
    const byGtin = new Map();
    const byDesc = new Map();

    data.forEach((linha) => {
      if (linha.mult == null || linha.mult === '') return;
      let mult = multiplicadorParaFloat(linha.mult);

      if (
        mult === 0 &&
        multCestaBasica !== null &&
        ehTributoCestaBasica(linha.tributo)
      ) {
        mult = multCestaBasica;
      }

      const cp = String(linha.cprod == null ? '' : linha.cprod).trim();
      if (cp) byCprod.set(cp, mult);

      const gt = limparGtin(linha.gtin);
      if (gt) byGtin.set(gt, mult);

      const de = normalizarDescricao(linha.desc);
      if (de) byDesc.set(de, mult);
    });

    return {
      byCprod,
      byGtin,
      byDesc,
      frete: temFrete ? { valor: freteValor, icms: freteIcms } : null
    };
  }
  return null;
}

function showGddWarning(lista) {
  const el = document.getElementById('gddWarning');
  const itens = lista.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  el.innerHTML =
    `⚠️ ${lista.length} produto(s) não encontrados na planilha GDD ` +
    `(código, GTIN e descrição não bateram). O ICMS % desses produtos ` +
    `não foi alterado:<ul>${itens}</ul>`;
  el.hidden = false;
}

function hideGddWarning() {
  const el = document.getElementById('gddWarning');
  el.hidden = true;
  el.innerHTML = '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c];
  });
}

/* ============================================================
   DRAG & DROP
   ============================================================ */

function setupDropzone(boxId, onFile) {
  const box = document.getElementById(boxId);
  if (!box) return;
  let depth = 0;
  ['dragenter', 'dragover'].forEach((evt) => {
    box.addEventListener(evt, (e) => {
      e.preventDefault();
      depth++;
      box.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend'].forEach((evt) => {
    box.addEventListener(evt, (e) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) box.classList.remove('dragover');
    });
  });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    box.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

/* ============================================================
   TABELA
   ============================================================ */

const tbody = document.getElementById('productsBody');

function renderTable() {
  tbody.innerHTML = '';
  products.forEach((row) => tbody.appendChild(buildRowElement(row)));
  syncMarcarTodos();
  recomputeAll();
}

function numInput(value, step, onInput) {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = step;
  i.min = '0';
  i.value = value;
  i.addEventListener('input', onInput);
  return i;
}

function buildRowElement(row) {
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;

  const tdCheck = document.createElement('td');
  tdCheck.className = 'check';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = !!row.checked;
  chk.addEventListener('change', () => {
    row.checked = chk.checked;
    syncMarcarTodos();
  });
  tdCheck.appendChild(chk);

  const tdDesc = document.createElement('td');
  const inDesc = document.createElement('input');
  inDesc.type = 'text';
  inDesc.className = 'desc';
  inDesc.value = row.descricao;
  inDesc.addEventListener('input', () => {
    row.descricao = inDesc.value;
  });
  tdDesc.appendChild(inDesc);

  const tdQtd = document.createElement('td');
  tdQtd.appendChild(
    numInput(row.quantidade, 'any', (e) => {
      row.quantidade = e.target.value;
      recomputeAll();
    })
  );

  const tdVU = document.createElement('td');
  tdVU.appendChild(
    numInput(row.valorUnitario, '0.0001', (e) => {
      row.valorUnitario = e.target.value;
      recomputeAll();
    })
  );

  const tdCaixa = document.createElement('td');
  tdCaixa.appendChild(
    numInput(row.qtdCaixa, '1', (e) => {
      row.qtdCaixa = e.target.value;
      recomputeAll();
    })
  );

  const tdIcms = document.createElement('td');
  tdIcms.appendChild(
    numInput(row.icmsPct, '0.01', (e) => {
      row.icmsPct = e.target.value;
      recomputeAll();
    })
  );

  const tdCusto = calcCell('custo-' + row.id, 'calc');
  const tdPctFrete = calcCell('pctfrete-' + row.id, 'calc muted');
  const tdPctAjuste = calcCell('pctajuste-' + row.id, 'calc');
  const tdPctAdd = calcCell('pctadd-' + row.id, 'calc');
  const tdFinal = calcCell('final-' + row.id, 'calc final');

  const tdActions = document.createElement('td');
  tdActions.className = 'actions';
  const btnDel = document.createElement('button');
  btnDel.className = 'btn danger';
  btnDel.title = 'Remover linha';
  btnDel.textContent = '✕';
  btnDel.addEventListener('click', () => removeRow(row.id));
  tdActions.appendChild(btnDel);

  tr.append(
    tdCheck,
    tdDesc,
    tdQtd,
    tdVU,
    tdCaixa,
    tdIcms,
    tdCusto,
    tdPctFrete,
    tdPctAjuste,
    tdPctAdd,
    tdFinal,
    tdActions
  );
  return tr;
}

function calcCell(id, cls) {
  const td = document.createElement('td');
  td.className = cls;
  td.id = id;
  return td;
}

function removeRow(id) {
  products = products.filter((r) => r.id !== id);
  renderTable();
}

document.getElementById('addRowBtn').addEventListener('click', () => {
  products.push(createBlankRow());
  renderTable();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (
    !confirm(
      'Limpar todos os produtos da tabela? Os campos de frete e os dados da nota não serão apagados.'
    )
  )
    return;
  products = [createBlankRow()];
  hideGddWarning();
  renderTable();
});

/* ---------- ICMS em lote ---------- */

const marcarTodos = document.getElementById('marcarTodos');

marcarTodos.addEventListener('change', () => {
  products.forEach((r) => (r.checked = marcarTodos.checked));
  renderTable();
});

function syncMarcarTodos() {
  const total = products.length;
  const marcados = products.filter((r) => r.checked).length;
  marcarTodos.checked = total > 0 && marcados === total;
  marcarTodos.indeterminate = marcados > 0 && marcados < total;
}

document.getElementById('aplicarLoteBtn').addEventListener('click', () => {
  const valor = document.getElementById('icmsLoteInput').value;
  let n = 0;
  products.forEach((r) => {
    if (r.checked) {
      r.icmsPct = String(parseNumberBR(valor));
      n++;
    }
  });
  renderTable();
  if (n === 0) {
    setStatus('gddStatus', 'Nenhuma linha marcada para aplicar o ICMS em lote.', 'warn');
  }
});

document.getElementById('freteValorInput').addEventListener('input', recomputeAll);
document.getElementById('freteIcmsInput').addEventListener('input', recomputeAll);

/* ============================================================
   CÁLCULO
   ============================================================ */

function computeAjuste(baseProdutos) {
  if (!nota.loaded || baseProdutos <= 0) {
    return { pct: 0, tipo: 'nenhum', nome: 'Suframa / Outras Despesas', diferenca: 0 };
  }
  const dif = nota.valorTotalNota - nota.valorTotalProdutos;
  const pct = (Math.abs(dif) / baseProdutos) * 100;
  if (dif < 0)
    return { pct, tipo: 'suframa', nome: 'Suframa (desconto)', diferenca: dif };
  if (dif > 0)
    return { pct, tipo: 'outras', nome: 'Outras Despesas (acréscimo)', diferenca: dif };
  return { pct: 0, tipo: 'zero', nome: 'Suframa / Outras Despesas', diferenca: 0 };
}

// Exposto para a geração do PDF.
let ultimoCalculo = null;

function recomputeAll() {
  const freteValor = parseNumberBR(document.getElementById('freteValorInput').value);
  const freteIcms = parseNumberBR(document.getElementById('freteIcmsInput').value);
  const custoFreteTotal = freteValor + freteIcms;

  let somaLive = 0;
  products.forEach((row) => {
    somaLive += parseNumberBR(row.quantidade) * parseNumberBR(row.valorUnitario);
  });

  const baseProdutos =
    nota.loaded && nota.valorTotalProdutos > 0 ? nota.valorTotalProdutos : somaLive;

  const fretePct = baseProdutos > 0 ? (custoFreteTotal / baseProdutos) * 100 : 0;
  const ajuste = computeAjuste(baseProdutos);
  const pctAjusteSigned = ajuste.tipo === 'suframa' ? -ajuste.pct : ajuste.pct;

  let somaCustoFinal = 0;
  let somaIcms = 0;
  const linhas = [];

  products.forEach((row) => {
    const qtd = parseNumberBR(row.quantidade);
    const vu = parseNumberBR(row.valorUnitario);
    const qcRaw = parseNumberBR(row.qtdCaixa);
    const qc = qcRaw > 0 ? qcRaw : 1;
    const icms = parseNumberBR(row.icmsPct);

    const custo = vu / qc;
    const pctAdd = icms + fretePct + pctAjusteSigned;
    const custoFinal = custo * (1 + pctAdd / 100);

    somaCustoFinal += custoFinal * qtd;
    somaIcms += custo * (icms / 100) * qtd;

    setText('custo-' + row.id, formatBRL(custo));
    setText('pctfrete-' + row.id, formatPct(fretePct));
    setText('pctajuste-' + row.id, formatPct(pctAjusteSigned));
    setText('pctadd-' + row.id, formatPct(pctAdd));
    setText('final-' + row.id, formatBRL(custoFinal));

    const tdAj = document.getElementById('pctajuste-' + row.id);
    if (tdAj) tdAj.classList.toggle('neg', pctAjusteSigned < 0);

    linhas.push({
      descricao: row.descricao,
      quantidade: qtd,
      valorUnitario: vu,
      qtdCaixa: qc,
      icmsPct: icms,
      custo,
      pctFrete: fretePct,
      pctAjuste: pctAjusteSigned,
      pctAdd,
      custoFinal
    });
  });

  const totalProdutos = nota.loaded ? nota.valorTotalProdutos : somaLive;
  const totalNota = nota.loaded ? nota.valorTotalNota : somaLive;

  setText('freteTotalOut', formatBRL(custoFreteTotal));
  setText('pctFreteOut', formatPct(fretePct));
  setText('sumTotalProdutos', formatBRL(totalProdutos));
  setText('sumTotalNota', formatBRL(totalNota));
  setText('sumCustoFinal', formatBRL(somaCustoFinal));

  setText('ajusteLabel', ajuste.nome);
  setText(
    'ajusteValor',
    ajuste.tipo === 'nenhum'
      ? '—'
      : `${formatBRL(ajuste.diferenca)} · ${formatPct(pctAjusteSigned)}`
  );
  const ajusteCard = document.getElementById('ajusteCard');
  ajusteCard.classList.toggle('is-suframa', ajuste.tipo === 'suframa');

  ultimoCalculo = {
    linhas,
    freteValor,
    freteIcms,
    custoFreteTotal,
    fretePct,
    ajuste: { ...ajuste, pctSigned: pctAjusteSigned },
    totalProdutos,
    totalNota,
    somaCustoFinal,
    somaIcms
  };
}

const PULSE_IDS = new Set([
  'sumTotalProdutos',
  'sumTotalNota',
  'sumCustoFinal',
  'ajusteValor',
  'freteTotalOut',
  'pctFreteOut'
]);

function setText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const changed = el.textContent !== text;
  el.textContent = text;
  if (changed && PULSE_IDS.has(id)) {
    el.classList.remove('value-pulse');
    void el.offsetWidth;
    el.classList.add('value-pulse');
  }
}

/* ============================================================
   GERAÇÃO DE PDF
   ============================================================ */

document.getElementById('pdfBtn').addEventListener('click', gerarPDF);

function gerarPDF() {
  if (!ultimoCalculo) recomputeAll();
  const calc = ultimoCalculo;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = margin;

  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text('Cálculo de Custo Unitário — NF-e', margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), margin, y);
  doc.setTextColor(0);
  y += 8;

  const sectionTitle = (title) => {
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(title, margin, y);
    y += 5;
  };

  const kvTable = (pairs, opts = {}) => {
    const highlightIndex = opts.highlightIndex;
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 3, halign: 'center' },
      head: [pairs.map((p) => p[0])],
      body: [pairs.map((p) => p[1])],
      headStyles: {
        fillColor: [244, 246, 249],
        textColor: [90, 90, 90],
        fontStyle: 'bold'
      },
      bodyStyles: { fontStyle: 'bold', textColor: [198, 40, 40] },
      didParseCell: (data) => {
        if (highlightIndex == null || data.column.index !== highlightIndex) return;
        if (data.section === 'head') {
          data.cell.styles.fillColor = [255, 75, 75];
          data.cell.styles.textColor = 255;
        } else if (data.section === 'body') {
          data.cell.styles.fillColor = [255, 232, 232];
          data.cell.styles.textColor = [198, 40, 40];
          data.cell.styles.fontSize = 11.5;
        }
      }
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  const ajusteValorStr =
    calc.ajuste.tipo === 'nenhum'
      ? '—'
      : `${formatBRL(calc.ajuste.diferenca)} · ${formatPct(calc.ajuste.pctSigned)}`;

  sectionTitle('Resumo da nota fiscal');
  kvTable([
    ['Total dos produtos', formatBRL(calc.totalProdutos)],
    ['Valor total da nota', formatBRL(calc.totalNota)],
    [calc.ajuste.nome, ajusteValorStr]
  ]);

  sectionTitle('Frete');
  kvTable([
    ['Valor do frete', formatBRL(calc.freteValor)],
    ['ICMS do frete', formatBRL(calc.freteIcms)],
    ['Custo de frete total', formatBRL(calc.custoFreteTotal)],
    ['% de frete rateado', formatPct(calc.fretePct)]
  ]);

  sectionTitle('Resumo geral');
  kvTable(
    [
      ['Valor total da nota', formatBRL(calc.totalNota)],
      [calc.ajuste.nome, ajusteValorStr],
      ['ICMS dos produtos', formatBRL(calc.somaIcms)],
      ['Valor do frete', formatBRL(calc.freteValor)],
      ['ICMS do frete', formatBRL(calc.freteIcms)],
      ['Custo final total (estimado)', formatBRL(calc.somaCustoFinal)]
    ],
    { highlightIndex: 5 }
  );

  sectionTitle('Produtos');

  const head = [
    [
      'Descrição',
      'Qtd',
      'Vlr unit. (R$)',
      'Qtd caixa',
      'Custo (R$)',
      'ICMS %',
      '% Frete',
      '% Suframa/Outras',
      '% Custos adic.',
      'Custo final (R$)'
    ]
  ];

  const body = calc.linhas
    .filter((l) => l.descricao && l.descricao.trim())
    .map((l) => [
      l.descricao,
      l.quantidade.toLocaleString('pt-BR'),
      formatBRL(l.valorUnitario),
      l.qtdCaixa.toLocaleString('pt-BR'),
      formatBRL(l.custo),
      formatPct(l.icmsPct),
      formatPct(l.pctFrete),
      formatPct(l.pctAjuste),
      formatPct(l.pctAdd),
      formatBRL(l.custoFinal)
    ]);

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head,
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [255, 75, 75], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 66 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 9) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [198, 40, 40];
      }
    }
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      'Página ' + i + ' de ' + pageCount,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 6,
      { align: 'right' }
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save('resultado_custo_unitario_' + stamp + '.pdf');
}

/* ============================================================
   EXPORTAÇÃO PARA EXCEL (tabela de produtos)
   ============================================================ */

document.getElementById('excelBtn').addEventListener('click', exportarExcel);

function arredondar(n, casas) {
  const f = Math.pow(10, casas);
  return Math.round((Number(n) || 0) * f) / f;
}

function exportarExcel() {
  if (!ultimoCalculo) recomputeAll();

  const linhas = ultimoCalculo.linhas.filter(
    (l) => l.descricao && l.descricao.trim()
  );

  if (!linhas.length) {
    setStatus('gddStatus', 'Nenhum produto na tabela para exportar.', 'warn');
    return;
  }

  const cabecalho = [
    'Descrição',
    'Quantidade',
    'Valor Unitário',
    'Qtd Caixa',
    'ICMS %',
    'Custo',
    '% Frete',
    '% Suframa/Outras',
    '% Custos Adicionais',
    'Custo Final'
  ];

  const aoa = [cabecalho];
  linhas.forEach((l) => {
    aoa.push([
      l.descricao,
      arredondar(l.quantidade, 4),
      arredondar(l.valorUnitario, 4),
      arredondar(l.qtdCaixa, 4),
      arredondar(l.icmsPct, 4),
      arredondar(l.custo, 4),
      arredondar(l.pctFrete, 4),
      arredondar(l.pctAjuste, 4),
      arredondar(l.pctAdd, 4),
      arredondar(l.custoFinal, 4)
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 42 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'custo_unitario_produtos_' + stamp + '.xlsx');

  setStatus(
    'gddStatus',
    `${linhas.length} produto(s) exportado(s) para Excel.`,
    'ok'
  );
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

products.push(createBlankRow());
renderTable();
