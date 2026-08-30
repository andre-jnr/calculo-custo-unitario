# 📦 Cálculo de Custo Unitário — NF-e

Aplicação **100% front-end** (HTML + CSS + JavaScript puro) que lê o XML de uma
NF-e e a planilha **GDD (Gestão de Desembaraço de Documentos)** e calcula o
**custo unitário final** de cada produto, considerando ICMS, rateio de frete
(valor + ICMS do frete) e ajuste automático de Suframa / Outras Despesas.

Roda direto no navegador, sem servidor e sem back-end — pode ser publicada no
**GitHub Pages**. Nenhum arquivo sai do computador: todo o processamento acontece
localmente.

## ✨ Funcionalidades

- ✅ Importação do **XML da NF-e** (Descrição, Quantidade, Valor Unitário, Valor
  Total da Nota)
- ✅ Importação da **planilha GDD** para preencher automaticamente:
  - **ICMS %** de cada produto (coluna `Multiplicador`), com tratamento
    automático da alíquota de **Cesta Básica**
  - **Valor do frete** e **ICMS do frete** (tributos `1339` / `1415` — Frete FOB
    antecipado / serviço de transporte contratado)
- ✅ Ajuste automático de **Suframa (desconto)** ou **Outras Despesas (acréscimo)**
  pela diferença entre o valor da nota e a soma dos produtos
- ✅ Rateio automático de frete sobre o valor dos produtos
- ✅ **Quantidade por caixa** (custo por unidade)
- ✅ Edição manual da tabela + aplicação de **ICMS em lote**
- ✅ **Tabela única** com todos os cálculos por linha
- ✅ Exportação em **PDF** (paisagem, com resumo, frete e tabela de produtos)
- ✅ Tema claro/escuro, animações e microinterações

## 🚀 Como usar

### Online (GitHub Pages)

Publique o repositório em *Settings → Pages → Deploy from a branch → `main` / root*
e acesse a URL gerada.

### Local

Basta abrir o `index.html` no navegador. Para evitar restrições de `file://` em
alguns navegadores, sirva a pasta com um servidor estático simples:

```bash
# Python
python -m http.server 8000
# ou Node
npx serve .
```

E acesse `http://localhost:8000`.

## 🧠 Lógica de cálculo

### 1. Leitura do XML

Para cada `<det>` são lidos `xProd` → Descrição, `qCom` → Quantidade,
`vUnCom` → Valor Unitário, `vProd` (somado) e `cProd` / `cEAN` (chaves para o
match com a GDD). `vNF` → Valor Total da Nota.

### 2. Suframa / Outras Despesas (automático)

```
Diferença = Valor Total da Nota − Soma dos Produtos
```

- Diferença **negativa** → **Suframa**, aplicada como **desconto** (percentual
  negativo no custo final)
- Diferença **positiva** → **Outras Despesas**, aplicada como **acréscimo**
- Zero → 0%

```
% Suframa/Outras = |Diferença| ÷ Soma dos Produtos × 100
```

### 3. Frete rateado (valor único, não por produto)

```
Custo de frete total = Valor do frete + ICMS do frete
% Frete = Custo de frete total ÷ Soma dos Produtos × 100
```

O mesmo percentual é aplicado a todos os itens.

### 4. Importação de ICMS da GDD

O ICMS % de cada produto é **sempre sobrescrito** com o valor da coluna
`Multiplicador` da GDD para os produtos casados. Ordem de prioridade do match
(a primeira que casar decide):

1. `cProd` (XML) × `CODG. Produto` (GDD)
2. `cEAN` (XML) × `GTIN` (GDD)
3. Descrição normalizada (`xProd` × `Descrição`, ignorando o sufixo `LOTE - N`)

Produtos sem correspondência nas três tentativas mantêm o ICMS % atual e são
listados em um aviso na tela.

**Cesta Básica:** produtos da cesta básica vêm com `Multiplicador` zerado na
própria linha; a alíquota real (ex.: 12,35%) está apenas na linha-resumo do
tributo `... CESTA BÁSICA - FUNDO DE PROMOÇÃO SOCIAL`. A aplicação detecta o
padrão `CESTA BÁSICA` em `Tributo Tipo` e propaga a alíquota da linha-resumo para
as linhas zeradas do grupo antes do match.

### 5. Custo final por linha

```
Custo             = Valor Unitário ÷ Qtd Caixa
% Custos Adicionais = ICMS % + % Frete + % Suframa/Outras
Custo Final        = Custo × (1 + % Custos Adicionais ÷ 100)
```

## 🗂 Estrutura do projeto

```
calculo-custo-unitario/
├── index.html   # marcação da página
├── style.css    # tema (claro/escuro), layout e animações
├── app.js       # parsing de XML/GDD, cálculo e geração de PDF
├── vendor/      # bibliotecas (SheetJS, jsPDF, jspdf-autotable)
└── .nojekyll    # publica os arquivos como estão no GitHub Pages
```

## 🛠 Bibliotecas (em `vendor/`, sem CDN)

- [SheetJS (xlsx)](https://sheetjs.com/) — leitura da planilha GDD
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable)
  — geração do PDF
