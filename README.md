# 📦 Cálculo de Custo Unitário - NF-e
<img width="1724" height="1091" alt="image" src="https://github.com/user-attachments/assets/e81f4de0-2eb7-4258-88a3-2a82177514d7" />


Aplicação web desenvolvida com Streamlit para realizar o cálculo de custo unitário de produtos a partir do XML da NF-e, considerando:

- ✅ ICMS individual ou em lote
- ✅ Importação automática de ICMS a partir da planilha GDD (com tratamento automático da alíquota de Cesta Básica)
- ✅ Rateio automático de frete
- ✅ Suframa (desconto) ou Outras Despesas (acréscimo)
- ✅ Quantidade por caixa
- ✅ Cálculo automático do custo final
- ✅ Exportação do resultado em PDF

# 🚀Acesse a aplicação online

🔗 Link oficial:
👉 https://calculo-custo-unitario.streamlit.app/

### 📥 Upload do XML e edição dos dados

- Upload do XML da NF-e
- Edição de ICMS por produto
- Aplicação de ICMS em lote
- Controle de quantidade por caixa

### 📊 Resultado Final

- Cálculo do custo base
- Rateio de frete
- Aplicação automática de Suframa ou Outras Despesas
- Cálculo consolidado do custo final
- Exportação em PDF formatado

# 🧠 Lógica de Funcionamento

## 1️⃣ Leitura do XML

A aplicação:
- Lê o XML da NF-e usando lxml
- Extrai:
  - `xProd` → Descrição
  - `qCom` → Quantidade
  - `vUnCom` → Valor Unitário
  - `vProd` → Valor total do item
  - `vNF` → Valor total da nota

## 2️⃣ Cálculos Automáticos
📌 Rateio do Frete
```
Frete (%) = (Valor do Frete / Total Produtos) * 100
```

📌 Cesta Básica na importação GDD

Na planilha GDD, produtos de Cesta Básica vêm com `Multiplicador` (ICMS) zerado na própria linha do produto — a alíquota real (ex.: 12,35%) fica só na linha-resumo do tributo "... CESTA BÁSICA - FUNDO DE PROMOÇÃO SOCIAL". A aplicação identifica esse padrão e aplica automaticamente essa alíquota aos produtos da Cesta Básica, em vez de importar 0%.

📌 Suframa ou Outras Despesas
```
Diferença = Total Nota - Total Produtos
```
- Se negativo → Suframa (desconto)
- Se positivo → Outras Despesas (acréscimo)

## 3️⃣ Cálculo do Custo Final
Ajuste por quantidade da caixa
```
Custo = Valor Unitário / Qtd Caixa
```

Percentual total adicional
```
% Custos Adicionais = ICMS + % Frete + % Suframa/Outras
```

Cálculo final
```
Custo Final = Custo * (1 + (% Custos Adicionais / 100))
```

🗂 Estrutura do Projeto
```
📦 calculo-custo-unitario
│
├── app.py           # Aplicação principal (Streamlit)
├── pdf.py           # Geração do PDF com ReportLab
├── requirements.txt # Dependências do projeto
```

# 🛠 Tecnologias Utilizadas

- Python 3.10+
- Streamlit
- Pandas
- lxml
- ReportLab

# ⚙️ Como Executar o Projeto

## 1️⃣ Clone o repositório
```
git clone https://github.com/andre-jnr/calculo-custo-unitario.git
cd calculo-custo-unitario
```

## 2️⃣ Crie um ambiente virtual
```
python -m venv venv
```

## 3️⃣ Ative o ambiente

Windows (PowerShell):
```
venv\Scripts\Activate.ps1
```

Windows (CMD):
```
venv\Scripts\activate
```

Linux/Mac:
```
source venv/bin/activate
```

## 4️⃣ Instale as dependências
```
pip install -r requirements.txt
```

## 5️⃣ Execute a aplicação
```
streamlit run app.py
```

# 📄 Exportação em PDF

O PDF:
- Está em modo paisagem (A4)
- Possui:
  - Título
  - Cabeçalho formatado
  - Valores monetários no padrão brasileiro
  - Percentuais formatados
- Pronto para envio ao setor financeiro ou contábil

# 🎯 Funcionalidades Principais

- ✔️ Upload de XML da NF-e
- ✔️ Edição interativa via `st.data_editor`
- ✔️ Aplicação de ICMS em lote
- ✔️ Cálculo automático de frete rateado
- ✔️ Identificação automática de Suframa ou Outras Despesas
- ✔️ Cálculo por quantidade de caixa
- ✔️ Geração e download de PDF

# 👨‍💻 Autor

Projeto desenvolvido para automatizar o cálculo de custo unitário de notas fiscais, trazendo:
 - Mais precisão
 - Redução de erros manuais
 - Agilidade no setor de faturamento/controladoria
