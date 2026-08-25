# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão Geral

- **Objetivo do sistema**: aplicação web que lê o XML de uma NF-e (Nota Fiscal Eletrônica brasileira) e calcula o **custo unitário final** de cada produto, considerando ICMS, rateio de frete e ajuste de Suframa/Outras Despesas.
- **Problema que resolve**: automatiza um cálculo hoje feito manualmente (provavelmente em planilha) pelo setor de faturamento/controladoria, reduzindo erro humano e agilizando a formação de custo de produtos importados/recebidos via nota fiscal.
- **Público-alvo**: setor de faturamento/controladoria de uma empresa (ver commits e README — projeto do autor André Junior). Uso interno, não multiempresa/multiusuário (não há autenticação nem persistência entre sessões).

## Stack Tecnológica

- **Linguagem**: Python 3.10+
- **Framework de UI**: [Streamlit](https://streamlit.io/) 1.54.0 — app single-page, sem backend/frontend separados
- **Manipulação de dados**: pandas 2.3.3, numpy
- **Parsing de XML**: lxml (namespace da NF-e: `http://www.portalfiscal.inf.br/nfe`)
- **Geração de PDF**: ReportLab 4.4.10 (`reportlab.platypus`)
- Dependências completas em `requirements.txt` (gerado via `pip freeze` para deploy no Streamlit Community Cloud)

## Estrutura do Projeto

```
calculo-custo-unitario/
├── app.py             # Aplicação Streamlit (única tela, todo o fluxo de UI + regras de negócio)
├── pdf.py             # Geração do PDF do resultado final (função gerar_pdf)
├── requirements.txt   # Dependências (UTF-8 desde a introdução do import GDD; versões anteriores estavam em UTF-16)
├── README.md          # Documentação do usuário final / marketing do projeto
├── GDD  Gestão de Desembaraço de Documentos.xlsx  # Planilha de exemplo usada para o import de ICMS (ver Integrações)
└── .gitignore
```

Não há pastas `src/`, `tests/`, `utils/` etc. **Nota**: o `.gitignore` ignora uma pasta `utils/`, mas ela não existe no repositório atual — histórico incerto (Necessita confirmação se deveria existir).

## Arquitetura

- **Monólito de script único** rodando sobre o modelo de execução do Streamlit: o arquivo `app.py` é reexecutado do topo a cada interação do usuário (rerun model do Streamlit).
- Não há camadas (controller/service/repository) nem classes — tudo é procedural, com pandas DataFrames como estrutura de dados central.
- Estado da aplicação mantido em `st.session_state` (chaves: `df`, `valor_total_produtos`, `valor_total_nota`, `percentual_ajuste`, `tipo_ajuste`). Não há banco de dados nem persistência em disco — cada sessão do navegador é independente e efêmera.
- `pdf.py` é o único módulo separado, isolando a formatação/exportação em PDF (recebe um DataFrame já calculado e não conhece o restante da aplicação — baixo acoplamento).

## Fluxo da Aplicação

1. Usuário faz upload do XML da NF-e (`st.file_uploader`).
2. **Carga única** (`if arquivo_xml and "df" not in st.session_state`): o XML é parseado uma única vez com `lxml`; para cada `<det>` são extraídos `xProd`, `qCom`, `vUnCom`, `vProd` (para a tabela) e `cProd`, `cEAN` (chaves de identificação, guardadas à parte em `st.session_state.df_chaves`, alinhadas por índice com `st.session_state.df` — não aparecem na tabela editável); o total de produtos é somado e `vNF` (valor total da nota) é lido separadamente. O resultado vira `st.session_state.df`.
3. Usuário informa o **valor do frete**.
4. A aplicação calcula automaticamente:
   - diferença entre `vNF` e a soma dos produtos → determina se o ajuste é **Suframa (desconto)** ou **Outras Despesas (acréscimo)**;
   - percentual de frete rateado sobre o total de produtos.
5. **(Opcional) Importação de ICMS via planilha GDD**: usuário pode subir a planilha "GDD :: Gestão de Desembaraço de Documentos" (.xlsx). O sistema localiza a linha de cabeçalho (procura pela coluna `Multiplicador` nas primeiras linhas, pois o arquivo traz título e dados do fornecedor/nota antes do cabeçalho real) e tenta casar cada produto do XML com uma linha da planilha, nessa ordem de prioridade: **`cProd` × `CODG. Produto`** → **`cEAN` × `GTIN`** → **descrição normalizada** (`xProd` × `Descrição`, ignorando o sufixo `LOTE - ...` e diferenças de espaçamento). Quando encontra, **sobrescreve** o `ICMS %` da linha com o valor da coluna `Multiplicador`; produtos sem correspondência mantêm o ICMS % atual e são listados em um aviso na tela. Reprocessa apenas quando o conteúdo do arquivo muda (hash MD5 em `st.session_state.gdd_hash`).
   - **Caso especial — Cesta Básica**: na planilha GDD, produtos sujeitos ao tributo de cesta básica (`Tributo Tipo` contendo "CESTA BÁSICA", ex.: `116 - CESTA BÁSICA - FEIJÃO, ARROZ, FÉCULA DE MANDIOCA, SAL, COMP. LACT E SABÃO EM BARRA`) vêm com `Multiplicador` **zerado (0,00)** na própria linha do produto — a alíquota real só aparece na linha-resumo do tributo `... CESTA BÁSICA - FUNDO DE PROMOÇÃO SOCIAL` (cuja `B. Cálculo` é a soma da `B. Cálculo` de todas as linhas de produto zeradas do grupo). Antes de montar os dicionários de match, o sistema procura essa linha-resumo (`Tributo Tipo` contém "CESTA BÁSICA" e `Multiplicador` > 0) e, para toda linha de produto com `Multiplicador == 0,00` cujo `Tributo Tipo` também contenha "CESTA BÁSICA", substitui o multiplicador usado no match pelo valor encontrado na linha-resumo (ex.: 12,35%). Isso evita que produtos da cesta básica sejam importados com ICMS 0% quando na verdade têm alíquota própria.
6. Usuário edita a tabela via `st.data_editor` (`df_editado`): pode marcar produtos individualmente (coluna `✔️`), definir `Qtd Caixa` e `ICMS %` por linha (inclusive sobrepondo o que veio do GDD), ou aplicar um ICMS em lote (checkbox "Marcar todos" + botão "Aplicar ICMS às linhas selecionadas").
7. **Cálculo final**, feito em um DataFrame **separado** (`df_calculo`, cópia de `df_editado`) para não misturar dados de edição com dados de cálculo:
   - `Custo = Valor Unitário / Qtd Caixa`
   - `% Custos Adicionais = ICMS % + % Frete + % Suframa/Outras`
   - `Custo Final = Custo * (1 + % Custos Adicionais / 100)`
8. Tabela final é exibida formatada (moeda/percentual) e pode ser exportada em PDF (`pdf.gerar_pdf`), baixável via `st.download_button`.

## Regras de Negócio

- **Frete rateado**: distribuído proporcionalmente sobre o valor total dos produtos, não por peso/quantidade: `% Frete = (Valor Frete / Total Produtos) * 100`, aplicado igualmente a todos os itens.
- **Suframa vs. Outras Despesas são mutuamente exclusivos e calculados automaticamente**, nunca digitados:
  - `Total Nota < Total Produtos` → excedente é **Suframa**, tratado como **desconto** (percentual aplicado negativo no custo final).
  - `Total Nota > Total Produtos` → excedente é **Outras Despesas**, tratado como **acréscimo**.
  - `Total Nota == Total Produtos` → percentual é 0.
- **ICMS** é sempre manual (por linha ou em lote), nunca extraído do XML.
- **Qtd Caixa** divide o valor unitário do produto antes de aplicar os percentuais (ex.: produto vendido em caixa com N unidades → custo é por unidade).
- A tabela de edição (`df_editado`) é conceitualmente separada da tabela de cálculo (`df_calculo`) — decisão arquitetural explícita (commit `d113c8e`) para que o dataframe de cálculo não seja corrompido por estados intermediários de edição.
- Se `valor_total_produtos == 0`, os percentuais de frete e ajuste são forçados a 0 (evita divisão por zero).
- **Importação de ICMS via GDD**: quando o usuário importa a planilha GDD, o `ICMS %` é **sempre sobrescrito** com o valor da coluna `Multiplicador` para os produtos casados (decisão explícita do usuário — a planilha GDD é a fonte de verdade do ICMS-ST, mesmo que o usuário já tenha digitado algo manualmente antes). A ordem de prioridade de match é fixa: **código do produto (`cProd`/`CODG. Produto`) → GTIN (`cEAN`/`GTIN`) → descrição normalizada**; a primeira que encontrar correspondência decide o valor, as demais não são consultadas para aquele produto. Produtos sem correspondência em nenhuma das três tentativas mantêm o `ICMS %` atual e entram na lista de avisos exibida na tela.
- **ICMS de Cesta Básica não é 0%**: produtos da cesta básica trazem `Multiplicador` zerado em sua própria linha na planilha GDD; a alíquota verdadeira (ex.: 12,35%) está apenas na linha-resumo do tributo `... CESTA BÁSICA - FUNDO DE PROMOÇÃO SOCIAL`. O sistema detecta esse padrão pelo texto "CESTA BÁSICA" em `Tributo Tipo` e propaga a alíquota da linha-resumo para as linhas de produto zeradas do mesmo grupo, antes de fazer o match por `cProd`/`cEAN`/descrição. Validação cruzada: a soma da `B. Cálculo` das linhas de produto zeradas do grupo deve bater com a `B. Cálculo` da linha-resumo (ex.: `385,85 + 213,23 + 374,00 + 260,61 + 191,23 + 245,38 = 1670,30`, igual à `B. Cálculo` da linha `3961 31 - CESTA BÁSICA - FUNDO DE PROMOÇÃO SOCIAL`).

## Estrutura do Banco de Dados

Não há banco de dados. Todo o estado vive em memória, em `st.session_state`, durante a sessão do navegador. Nenhuma informação é persistida entre sessões ou usuários.

## Integrações

- Nenhuma API externa é chamada pelo código.
- Duas "integrações" por upload de arquivo local, sem chamada a webservices:
  - XML da NF-e (padrão SEFAZ/Portal Fiscal brasileiro, namespace `http://www.portalfiscal.inf.br/nfe`);
  - Planilha "GDD :: Gestão de Desembaraço de Documentos" (.xlsx), usada como fonte do ICMS-ST por produto (coluna `Multiplicador`). Formato de origem externa ao projeto (sistema de desembaraço, provavelmente ligado à Suframa/ZFM) — **Necessita confirmação** sobre qual sistema gera esse arquivo e se o layout (3 linhas de cabeçalho antes da tabela, colunas `CODG. Produto`/`GTIN`/`Multiplicador`) é estável entre notas/fornecedores.
- Deploy público em Streamlit Community Cloud: https://calculo-custo-unitario.streamlit.app/

## Variáveis de Ambiente

Nenhuma variável de ambiente, arquivo `.env` ou `secrets.toml` é usada ou referenciada no código atual. (Necessita confirmação: caso o deploy no Streamlit Cloud utilize secrets, eles não estão documentados neste repositório.)

## Como executar o projeto

```bash
git clone https://github.com/andre-jnr/calculo-custo-unitario.git
cd calculo-custo-unitario

python -m venv venv
# Windows PowerShell:
venv\Scripts\Activate.ps1
# Linux/Mac:
source venv/bin/activate

pip install -r requirements.txt
streamlit run app.py
```

## Como executar testes

**Não existem testes automatizados no projeto** (nenhum diretório `tests/`, nenhuma dependência de teste como `pytest` em `requirements.txt`, nenhum workflow de CI em `.github/`). Validação hoje é manual, via uso da interface Streamlit.

## Convenções do projeto

- **Nomenclatura**: variáveis e nomes de colunas de DataFrame em **português**, em `snake_case` para variáveis Python (`valor_total_produtos`, `percentual_ajuste`) e em texto livre/capitalizado para colunas visíveis ao usuário (`"Valor Unitário"`, `"Custo Final"`, `"ICMS %"`).
- **Organização de código**: um único arquivo por responsabilidade macro — `app.py` (UI + regras de negócio) e `pdf.py` (exportação). Não há módulos de utilidades ou helpers compartilhados.
- **Padrão de separação de dados**: manter DataFrame de edição (`df`/`df_editado`) separado do DataFrame de cálculo (`df_calculo`) — ver seção Regras de Negócio.
- **Comentários**: `app.py` usa blocos de seção no estilo `# ========= NOME DA SEÇÃO =========` para dividir etapas do fluxo (carga do XML, cálculo automático, ICMS em lote, cálculo final, tabela final). Manter esse padrão ao adicionar novas etapas.
- **Estilo de código**: procedural, sem classes, sem funções auxiliares em `app.py` (toda a lógica é inline, de cima para baixo, seguindo a ordem de execução do Streamlit). `pdf.py` é o único módulo com funções nomeadas (`gerar_pdf`, `formatar_moeda`, `formatar_percentual`).
- **Formatação de valores**: moeda e percentual sempre formatados manualmente no padrão brasileiro (vírgula decimal) nas funções `formatar_moeda`/`formatar_percentual` de `pdf.py`, e via `.style.format()` do pandas na tela.

## Decisões arquiteturais importantes

- **Streamlit como framework único** (UI + estado + execução) — não há separação entre frontend/backend; qualquer refatoração deve respeitar o modelo de rerun do Streamlit (o script inteiro reexecuta a cada interação).
- **`st.session_state["df"]` como única fonte de verdade** para os dados carregados do XML, para evitar reparsing do arquivo a cada rerun.
- **Separação entre DataFrame de edição e DataFrame de cálculo** (commit `d113c8e`) — decisão deliberada para isolar a lógica de cálculo de efeitos colaterais da tabela editável.
- **Cálculo de Suframa/Outras Despesas por diferença**, não por campo do XML — decisão de negócio para inferir automaticamente o tipo de ajuste a partir da diferença entre `vNF` e a soma dos produtos, em vez de exigir digitação manual (commit `c87a750`).

## Componentes principais

- `app.py` — ponto de entrada único da aplicação Streamlit; concentra parsing do XML, estado de sessão, UI de edição e cálculo final.
- `pdf.py::gerar_pdf(df)` — recebe a tabela final já calculada e devolve um `io.BytesIO` com um PDF em paisagem (A4), pronto para `st.download_button`.
- `pdf.py::formatar_moeda` / `formatar_percentual` — helpers de formatação usados apenas na geração do PDF.

## Dependências relevantes

- `streamlit` — framework de UI/estado/execução.
- `pandas` — estrutura de dados central (DataFrame) para produtos, edição e cálculo.
- `lxml` — parsing do XML da NF-e com XPath e namespaces.
- `openpyxl` — engine usada pelo `pd.read_excel` para ler a planilha GDD (.xlsx); dependência obrigatória, sem ela `pd.read_excel` falha em runtime.
- `reportlab` — geração de PDF (`SimpleDocTemplate`, `Table`, `TableStyle`).
- Demais entradas em `requirements.txt` são transitivas do Streamlit (altair, pydeck, pyarrow, etc.) — não usadas diretamente pelo código.

## Arquivos importantes

- `app.py` — toda a lógica de negócio e UI.
- `pdf.py` — exportação do resultado em PDF.
- `README.md` — documentação funcional voltada ao usuário final, com fórmulas de negócio já descritas (útil como referência cruzada às Regras de Negócio acima).
- `requirements.txt` — em UTF-8. Ao editar manualmente, manter nesse encoding (o arquivo já esteve em UTF-16 no passado, o que causava exibição ilegível em ferramentas de texto simples).
- `GDD  Gestão de Desembaraço de Documentos.xlsx` — planilha de exemplo do fluxo de import de ICMS; útil como referência do layout esperado (3 linhas de cabeçalho antes da tabela, colunas `CODG. Produto`, `GTIN`, `Descrição`, `Multiplicador`) ao alterar `app.py`.

## Fluxos críticos

- **Parsing do XML → `st.session_state.df`**: se o XML não seguir o layout padrão da NF-e (namespace `http://www.portalfiscal.inf.br/nfe`, tags `det`, `xProd`, `qCom`, `vUnCom`, `vProd`, `vNF`), o parsing falha ou produz dados incorretos. Não há tratamento de exceção nesse trecho.
- **Determinação automática de Suframa vs. Outras Despesas**: depende inteiramente da presença e correção do campo `vNF` no XML; se ausente, o fallback é usar `valor_total_produtos` como `valor_total_nota` (diferença = 0, sem ajuste).
- **Importação de ICMS via GDD**: depende de `cProd`/`cEAN` terem sido lidos corretamente do XML (`st.session_state.df_chaves`) e da planilha GDD manter as colunas `Tributo Tipo`, `CODG. Produto`, `GTIN`, `Descrição`, `B. Cálculo` e `Multiplicador` com esses nomes exatos (após `strip()`). Se a planilha vier sem a coluna `Multiplicador` nas 10 primeiras linhas, a importação é abortada com `st.error` e nada é alterado. O parsing força `dtype=str` para não perder zeros à esquerda em `CODG. Produto` — remover esse `dtype=str` reintroduz silenciosamente esse bug (código vira número, ex: `"00591"` → `591`, e o match por código para de funcionar). O tratamento da cesta básica (`eh_tributo_cesta_basica`) depende da coluna `Tributo Tipo` conter literalmente o texto "CESTA BÁSICA" (case-insensitive) tanto nas linhas de produto quanto na linha-resumo do fundo; se o fornecedor da GDD mudar essa nomenclatura, a propagação da alíquota deixa de funcionar silenciosamente (os produtos voltam a ficar com ICMS 0%, sem erro visível).
- **Aplicação de ICMS em lote**: só é persistida em `st.session_state.df` quando o botão "Aplicar ICMS às linhas selecionadas" é clicado; edições diretas na tabela (`df_editado`) que não passam por esse botão só valem para o cálculo da execução atual (rerun), não persistem automaticamente no `session_state.df`.
- **Geração do PDF**: espera que `tabela_final` já contenha exatamente as colunas usadas em `pdf.py` (`Descrição`, `Custo`, `ICMS %`, `% Frete`, `% Suframa/Outras`, `% Custos Adicionais`, `Custo Final`) — renomear/remover colunas em `app.py` quebra `gerar_pdf` silenciosamente ou com `KeyError`.

## O que deve ser evitado

- **Não** alterar a ordem/nome das colunas de `tabela_final` sem atualizar `pdf.py` na mesma alteração (acoplamento implícito entre os dois arquivos).
- **Não** duplicar a lógica de formatação de moeda/percentual — ela já existe em `pdf.py` (`formatar_moeda`, `formatar_percentual`); reutilizar em vez de reescrever inline.
- **Não** misturar novamente o DataFrame de edição com o DataFrame de cálculo — essa separação foi uma decisão deliberada (commit `d113c8e`) para evitar bugs de estado.
- **Não** introduzir uma nova forma de guardar estado (ex.: variáveis globais, arquivos temporários) quando `st.session_state` já cobre a necessidade.
- **Não** trocar o parsing manual por XPath por uma biblioteca de NF-e completa sem necessidade clara — o parsing atual é intencionalmente mínimo e focado apenas nos campos usados.
- **Não** quebrar a compatibilidade do fluxo "upload → session_state.df" carregando o XML mais de uma vez por sessão (o `if "df" not in st.session_state` existe propositalmente para isso).
- **Não** assumir que existe autenticação, multiusuário ou persistência — nenhuma dessas camadas existe hoje; não adicionar dependências para isso sem alinhamento prévio.

## Diretrizes para futuras implementações

- Reutilizar os helpers já existentes em `pdf.py` para qualquer nova formatação de moeda/percentual, em vez de recriar lógica equivalente em `app.py`.
- Respeitar o modelo de execução do Streamlit (rerun completo do script a cada interação) — evitar efeitos colaterais fora de `st.session_state`.
- Manter os comentários de seção (`# ========= ... =========`) ao adicionar novas etapas ao fluxo de `app.py`, seguindo o padrão já estabelecido.
- Ao adicionar novos campos extraídos do XML da NF-e, seguir o mesmo padrão de `det.find(".//nfe:TAG", namespaces=ns)` já usado, seguido de conversão explícita de tipo (`float(...)`).
- Ao adicionar uma nova regra de custo (novo percentual, por exemplo), incluí-la tanto no cálculo de `% Custos Adicionais` em `app.py` quanto nas colunas exportadas em `pdf.py`, mantendo os dois arquivos sincronizados.
- Ao criar qualquer teste automatizado (hoje inexistente), documentar aqui como executá-lo, para manter a seção "Como executar testes" atualizada.
- Atualizar o `README.md` sempre que uma fórmula de negócio (frete, Suframa, ICMS, custo final) for alterada, já que ele documenta essas fórmulas explicitamente para o usuário final.
- Se o arquivo `requirements.txt` precisar ser editado manualmente, manter o encoding UTF-8 (não regerar via `pip freeze > requirements.txt` no PowerShell sem checar o encoding resultante — foi assim que o arquivo virou UTF-16 no passado).
- Ao alterar a lógica de import da planilha GDD, manter a ordem de prioridade de match (`cProd` → `cEAN` → descrição) e o comportamento de sempre sobrescrever o `ICMS %` dos produtos casados — isso foi uma decisão explícita do usuário, não um detalhe de implementação livre para mudar.

## Checklist antes de modificar código

- [ ] Li `app.py` e `pdf.py` por inteiro (são pequenos — poucas centenas de linhas no total) antes de propor qualquer alteração.
- [ ] Confirmei se a mudança afeta colunas de `tabela_final`; se sim, atualizei `pdf.py` junto.
- [ ] Confirmei se a mudança afeta chaves de `st.session_state`; se sim, verifiquei todos os pontos onde essas chaves são lidas/escritas em `app.py`.
- [ ] Não introduzi uma nova dependência sem necessidade real (o projeto é deliberadamente enxuto).
- [ ] Verifiquei se a mudança preserva a separação entre DataFrame de edição e DataFrame de cálculo.
- [ ] Verifiquei se alguma fórmula de negócio (frete, Suframa/Outras Despesas, ICMS, custo final) foi alterada; se sim, atualizei o README.md e este CLAUDE.md.
- [ ] Testei manualmente o fluxo completo rodando `streamlit run app.py` com um XML de NF-e real, já que não há testes automatizados.
- [ ] Verifiquei se a mudança quebra compatibilidade com o deploy existente no Streamlit Community Cloud.
