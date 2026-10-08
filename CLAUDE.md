# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Visão Geral

- **Objetivo**: aplicação web que lê o XML de uma NF-e e a planilha **GDD
  (Gestão de Desembaraço de Documentos)** e calcula o **custo unitário final** de
  cada produto, considerando ICMS, rateio de frete (valor + ICMS do frete) e
  ajuste automático de Suframa / Outras Despesas.
- **Problema que resolve**: automatiza um cálculo antes feito manualmente pelo
  setor de faturamento/controladoria.
- **Público-alvo**: uso interno, single-user. Não há autenticação, back-end nem
  persistência (só o tema é salvo em `localStorage`).
- **Histórico**: o projeto era um app **Streamlit (Python)**. Foi convertido para
  um site estático (HTML/CSS/JS puro) para rodar no **GitHub Pages** sem espera de
  cold start. O código Python antigo (`app.py`, `pdf.py`) está no histórico do
  git. A pasta `entrada-gouveia/` era um projeto-referência usado na conversão e
  foi removida.

## Stack Tecnológica

- **HTML + CSS + JavaScript puro (ES2020)** — sem framework, sem build, sem
  bundler, sem npm em runtime.
- **Bibliotecas** (versionadas em `vendor/`, carregadas por `<script>` local, sem
  CDN):
  - `vendor/xlsx.full.min.js` — SheetJS, leitura da planilha GDD e exportação
    da tabela de produtos em .xlsx
  - `vendor/jspdf.umd.min.js` — jsPDF 2.5.2, geração de PDF
  - `vendor/jspdf.plugin.autotable.min.js` — tabelas no PDF
- **Fonte**: Google Fonts (`Source Sans 3`) via `<link>`, com fallback de sistema.
- Parsing de XML: `DOMParser` nativo do navegador.

## Estrutura do Projeto

```
calculo-custo-unitario/
├── index.html   # marcação: header, painéis de upload, frete, resumo, tabela
├── style.css    # tokens de tema (:root / [data-theme="dark"]), layout, animações
├── app.js       # TODO o comportamento: estado, XML, GDD, cálculo, PDF
├── vendor/      # bibliotecas de terceiros (não editar)
├── .nojekyll    # impede o Jekyll de processar o site no GitHub Pages
├── README.md    # documentação do usuário final + fórmulas de negócio
└── CLAUDE.md
```

Não há `src/`, `tests/`, `package.json`, nem CI.

## Arquitetura

- **Single-page, sem estado persistente.** `app.js` roda de cima para baixo:
  define utilidades, registra listeners, e no fim cria uma linha em branco e
  chama `renderTable()`.
- **Estado em memória**, em variáveis de módulo dentro de `app.js`:
  - `products` — array de objetos linha `{ id, checked, descricao, quantidade,
    valorUnitario, qtdCaixa, icmsPct, cProd, cEAN, vProd, gddTributos }`.
    `cProd`/`cEAN` são chaves só para o match com a GDD (não aparecem na
    tabela). `vProd` é o valor da linha no XML (sem IPI), base do ICMS % da GDD.
    `gddTributos` = `{ [Tributo Tipo]: { valor, mult } }` acumulado das GDDs.
  - `nota` — `{ loaded, valorTotalProdutos, valorTotalNota }`, preenchido pelo XML.
  - `ultimoCalculo` — snapshot do último `recomputeAll()`, consumido pela geração
    de PDF.
- **Fluxo de renderização**: `renderTable()` reconstrói o `<tbody>` inteiro a
  partir de `products` e chama `recomputeAll()`. Edições nos inputs atualizam o
  objeto em `products` e chamam `recomputeAll()` (que só reescreve as células
  calculadas via `setText`, sem re-render das linhas).
- **Uma única tabela** (decisão da conversão): não existe mais a separação
  "DataFrame de edição" × "DataFrame de cálculo" do Streamlit. As colunas
  editáveis e as calculadas convivem na mesma `<table class="products">`; o
  cálculo lê os valores do array `products`, nunca do DOM.
- **CSS**: tema por tokens em `:root` (claro) e `:root[data-theme="dark"]`.
  Paleta inspirada no Streamlit (vermelho-coral `#ff4b4b`), com as animações e
  microinterações herdadas do projeto-referência (`fadeSlideUp`, `value-pulse`,
  `row-matched`, shimmer nos botões primários, dropzones reativas).

## Fluxo da Aplicação

1. **Upload do XML** (`#xmlInput` ou drag & drop em `#xmlDropzone`) →
   `processXmlFile`. Para cada `<det>`: `xProd`, `qCom`, `vUnCom`, `vProd`
   (somado em `valorTotalProdutos`), `cProd`, `cEAN`. `vNF` → `valorTotalNota`
   (fallback: soma dos produtos). **Substitui** `products` inteiro e marca
   `nota.loaded = true`.
2. **Suframa / Outras Despesas** (automático, `computeAjuste`):
   `diferenca = valorTotalNota - valorTotalProdutos`. Negativo → Suframa
   (desconto, percentual negativo); positivo → Outras Despesas (acréscimo);
   zero → 0%. `% = |diferenca| / valorTotalProdutos * 100`.
3. **Frete** (`#freteValorInput`, `#freteIcmsInput`): `custoFreteTotal = valor +
   icms`; `% Frete = custoFreteTotal / base * 100`, onde `base` é
   `nota.valorTotalProdutos` quando há XML, senão a soma ao vivo da tabela.
   O mesmo % é rateado igualmente para todas as linhas.
4. **Upload da GDD** (`#gddInput` com `multiple` / `#gddDropzone`, aceita
   **várias planilhas de uma vez**) → `processGddFiles` → `extrairGDD` por arquivo:
   - Acha a **linha de cabeçalho** procurando a célula que contém
     `"Multiplicador"` nas 10 primeiras linhas (a planilha tem título e dados do
     fornecedor antes do cabeçalho real).
   - **Frete FOB**: soma `B. Cálculo` → valor e a coluna `ICMS` → icms de toda
     linha cujo `Tributo Tipo` normalizado começa com `1339` ou `1415`, ou cuja
     descrição contém `frete fob antecipado` / `servico de transporte
     contratado`. Preenche `#freteValorInput` / `#freteIcmsInput`.
   - **Cesta Básica**: acha a linha-resumo (`Tributo Tipo` contém `CESTA BÁSICA`
     e `Multiplicador > 0`) e, para as linhas de produto com `Multiplicador == 0`
     e `Tributo Tipo` contendo `CESTA BÁSICA`, usa a alíquota da linha-resumo no
     lugar do zero (e, se o ICMS em R$ da linha for 0, `B. Cálculo × alíquota`).
   - Monta os dicionários `byCprod` / `byGtin` / `byDesc` (chave normalizada →
     **lista** de `{ tributo, valor (ICMS R$), mult }` — um produto aparece em
     várias linhas, uma por tributo, ex.: `1342 ANTECIPADO` + `3863 FUNDO DE
     PROMOCAO SOCIAL`).
   - Para cada produto e **cada planilha**: tenta `byCprod[cProd]` →
     `byGtin[cEAN]` → `byDesc[descrição normalizada]`; os tributos casados entram
     em `row.gddTributos` (mesmo tributo substitui, não duplica; acumula entre
     importações até um novo XML). Se casou, **sobrescreve** `icmsPct` com
     `icmsPctDaGdd` = Σ ICMS R$ ÷ `vProd` × 100 (cai no `mult` quando não há
     valor em R$) e dá flash verde. Produto sem nenhum tributo casado entra no
     aviso `#gddWarning`.
   - **Por que valor em R$ e não o Multiplicador**: a GDD calcula esses tributos
     sobre valor + IPI, mas o custo aplica o % sobre o valor sem IPI. Somar os R$
     e dividir pelo `vProd` dá exatamente o ICMS pago (decisão do usuário).
   - Frete: somado entre as planilhas importadas juntas.
   - A GDD **nunca cria linhas novas** — só atualiza produtos já vindos do XML.
5. **Edição manual**: qualquer célula editável; ICMS em lote via
   `#icmsLoteInput` + `#marcarTodos` + botão `#aplicarLoteBtn` (aplica a
   `icmsPct` das linhas marcadas).
6. **Cálculo por linha** (`recomputeAll`):
   - `custo = valorUnitario / qtdCaixa` (`qtdCaixa <= 0` vira 1)
   - `% Custos Adicionais = icmsPct + % Frete + % Suframa/Outras` (este último
     negativo quando é Suframa)
   - `custoFinal = custo * (1 + % Custos Adicionais / 100)`
   - Card "Custo final total (estimado)" = Σ `valorUnitario * quantidade * (1 + % Custos Adicionais / 100)` — **não** divide pelo Multiplicador (é o custo total da nota; não pode variar com essa coluna). Idem "ICMS dos produtos" do PDF.
7. **PDF** (`gerarPDF`, botão `#pdfBtn`): jsPDF paisagem A4 — título, timestamp,
   tabela-resumo, tabela de frete, tabela de produtos (Descrição, Qtd, Vlr unit.,
   Multiplicador, Custo, ICMS %, % Frete, % Suframa/Outras, % Custos adic., Custo
   final), rodapé com paginação. Salva `resultado_custo_unitario_AAAA-MM-DD.pdf`.
8. **Excel** (`exportarExcel`, botão `#excelBtn`): exporta só a tabela de
   produtos (`ultimoCalculo.linhas`) via `XLSX.writeFile`, uma aba `Produtos`,
   com os valores como **número** (arredondados a 4 casas), não texto formatado.
   Salva `custo_unitario_produtos_AAAA-MM-DD.xlsx`.

## Regras de Negócio

- **Frete rateado**: proporcional ao **valor** dos produtos, não a peso/quantidade.
  Inclui o ICMS do frete somado ao valor do frete.
- **Suframa vs. Outras Despesas**: mutuamente exclusivos, calculados
  automaticamente pela diferença nota × produtos, nunca digitados. Suframa é
  desconto (percentual negativo).
- **ICMS %** é por linha; pode ser digitado, aplicado em lote ou importado da
  GDD. Quando a GDD casa um produto, o ICMS % é **sempre sobrescrito** (a GDD é a
  fonte de verdade do ICMS-ST — decisão explícita do usuário). Vindo da GDD, é a
  soma do ICMS em R$ de todos os tributos do produto ÷ valor sem IPI.
- **Ordem de match da GDD é fixa**: `cProd` → `cEAN` → descrição normalizada. A
  primeira que casar decide; as demais não são consultadas para aquele produto.
- **ICMS de Cesta Básica não é 0%**: a alíquota real vem da linha-resumo
  `... CESTA BÁSICA - FUNDO DE PROMOÇÃO SOCIAL` e é propagada para as linhas de
  produto zeradas do grupo antes do match.
- **Multiplicador** (coluna da tabela, campo interno `qtdCaixa`; antes rotulada "Qtd caixa") divide o valor unitário antes de aplicar os percentuais. Só afeta o custo por linha, nunca os totais da nota.
- Sem XML carregado, Suframa/Outras não é calculado e o frete usa a soma ao vivo
  da tabela como base.

## Normalização de texto (crítico para o match da GDD)

- `normalizarDescricao` (match de produto): **caixa alta**, remove o sufixo
  `LOTE\s*-\s*\d+`, colapsa espaços. **Não** remove acentos — espelha o
  `normalizar_descricao` do Streamlit; as duas pontas vêm do mesmo ERP.
- `normalizeLoose` (só na detecção de linhas de frete): remove acentos + baixa
  caixa, para casar `serviço`/`servico`.
- `limparGtin`: primeiro token da string (`"789... 12"` → `"789..."`).
- `multiplicadorParaFloat`: troca `,` por `.` sem mexer em separador de milhar
  (o Multiplicador é sempre um percentual curto).
- `parseNumberBR`: parser BR completo (trata `1.234,56`) — usado para valores
  monetários (frete, `B. Cálculo`, ICMS).

## Convenções do projeto

- **Idioma**: identificadores, comentários e UI em português.
- **Estilo JS**: `'use strict'`, procedural, sem classes, sem módulos ES
  (`<script>` clássico). Funções nomeadas, `const`/`let`.
- **Seções** em `app.js` marcadas com blocos `/* ===== NOME ===== */`. Manter o
  padrão ao adicionar etapas.
- **Formatação de valores**: sempre `toLocaleString('pt-BR', ...)` via os helpers
  `formatBRL` / `formatPct`. Não recriar formatação inline.
- **CSS**: cores só como tokens em `:root` / `[data-theme="dark"]`; nunca hardcode
  cor fora dos tokens. Respeitar `prefers-reduced-motion`.
- **Acoplamento tabela × PDF/Excel**: `gerarPDF` e `exportarExcel` leem de
  `ultimoCalculo.linhas` (não do DOM). Ao mudar as colunas calculadas, atualizar
  `recomputeAll` (montagem de `linhas`), o `head`/`body` de `gerarPDF` e o
  `cabecalho`/`aoa` de `exportarExcel` juntos.

## O que deve ser evitado

- **Não** adicionar framework, bundler ou dependência de CDN — o projeto é
  deliberadamente estático e offline-friendly (tudo em `vendor/`).
- **Não** reintroduzir back-end, autenticação ou persistência sem alinhamento.
- **Não** ler valores de cálculo do DOM — a fonte de verdade é o array
  `products` e o snapshot `ultimoCalculo`.
- **Não** mudar a ordem de prioridade do match da GDD (`cProd` → `cEAN` →
  descrição) nem o comportamento de sobrescrever o ICMS % — decisão do usuário.
- **Não** remover acentos em `normalizarDescricao` (quebra o match por descrição).
- **Não** editar os arquivos em `vendor/`.
- **Não** assumir nomes de coluna diferentes na GDD: `CODG. Produto`, `GTIN`,
  `Descrição`, `Tributo Tipo`, `B. Cálculo`, `Multiplicador` e uma coluna com
  `ICMS` no nome (valor). O cabeçalho é achado pela presença de `Multiplicador`.

## Diretrizes para futuras implementações

- Ao adicionar uma nova regra de custo (novo percentual), incluí-la em
  `recomputeAll` (no `% Custos Adicionais` e no objeto `linhas`) **e** nas
  colunas de `gerarPDF`, e atualizar o `README.md` e este arquivo.
- Ao ler novos campos do XML, seguir o padrão `tagText(det, 'TAG')` +
  conversão explícita (`parseFloat`).
- Ao alterar a lógica da GDD, rodar um teste manual com uma planilha real e
  conferir o aviso de "produtos não encontrados".
- Se criar testes automatizados (hoje inexistentes), documentar aqui como rodar.
- Atualizar o `README.md` sempre que uma fórmula de negócio mudar (ele documenta
  as fórmulas para o usuário final).

## Como testar

Não há testes automatizados. Validação manual:

```bash
python -m http.server 8000   # ou: npx serve .
```

Abrir `http://localhost:8000`, importar um XML de NF-e real e uma planilha GDD
real, conferir: soma dos produtos, valor da nota, tipo de ajuste (Suframa/Outras),
% de frete, ICMS % importado por produto (incluindo cesta básica), custo final e
o PDF gerado.

## Deploy

GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / `/root`*. O
`.nojekyll` garante que `vendor/` e os demais arquivos sejam servidos como estão.
Não há passo de build.
