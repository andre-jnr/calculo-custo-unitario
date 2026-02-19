import streamlit as st
import pandas as pd
from lxml import etree

st.set_page_config(layout="wide")
st.title("Cálculo de Custo Unitário - NF-e")

arquivo_xml = st.file_uploader("Selecione o XML da NF-e", type=["xml"])

# ========= CARREGA XML APENAS UMA VEZ =========
if arquivo_xml and "df" not in st.session_state:
    tree = etree.parse(arquivo_xml)
    root = tree.getroot()

    ns = {"nfe": "http://www.portalfiscal.inf.br/nfe"}

    produtos = []
    valor_total_produtos = 0

    for det in root.findall(".//nfe:det", namespaces=ns):
        descricao = det.find(".//nfe:xProd", namespaces=ns)
        quantidade = det.find(".//nfe:qCom", namespaces=ns)
        valor_unit = det.find(".//nfe:vUnCom", namespaces=ns)
        valor_prod = det.find(".//nfe:vProd", namespaces=ns)

        valor_total_produtos += float(valor_prod.text)

        produtos.append({
            "✔️": False,
            "Descrição": descricao.text if descricao is not None else "",
            "Quantidade": float(quantidade.text),
            "Valor Unitário": float(valor_unit.text),
            "ICMS %": 0.0
        })

    st.session_state.df = pd.DataFrame(produtos)
    st.session_state.valor_total_produtos = valor_total_produtos
    st.session_state.valor_total_nota = valor_total_produtos  # fallback

    # tenta pegar vNF do XML
    vnf = root.find(".//nfe:vNF", namespaces=ns)
    if vnf is not None:
        st.session_state.valor_total_nota = float(vnf.text)

# ========= SE DATAFRAME JÁ EXISTE =========
if "df" in st.session_state:

    df = st.session_state.df.copy()

    st.subheader("Dados Gerais da Nota")

    col1, col2 = st.columns(2)

    with col1:
        valor_frete = st.number_input(
            "Valor total do frete (R$)",
            min_value=0.0,
            step=0.01,
            key="frete"
        )

    # ========= CÁLCULO AUTOMÁTICO SUFRAMA / OUTRAS =========
    valor_total_nota = st.session_state.valor_total_nota
    valor_total_produtos = st.session_state.valor_total_produtos

    diferenca = valor_total_nota - valor_total_produtos

    percentual_ajuste = (
        abs(diferenca) / valor_total_produtos * 100
        if valor_total_produtos > 0 else 0
    )

    if diferenca < 0:
        nome_campo = "Suframa (%)"
        tipo_ajuste = "desconto"
    else:
        nome_campo = "Outras Despesas (%)"
        tipo_ajuste = "acrescimo"

    with col2:
        st.number_input(
            nome_campo,
            value=round(percentual_ajuste, 4),
            disabled=True
        )

    st.session_state.percentual_ajuste = percentual_ajuste
    st.session_state.tipo_ajuste = tipo_ajuste

    # ========= FRETE RATEADO =========
    frete_percentual = (
        valor_frete / valor_total_produtos * 100
        if valor_total_produtos > 0 else 0
    )

    with col1:
        st.info(f"Frete rateado: **{frete_percentual:.2f}%** sobre os produtos")

    with col2:
        st.info(f"{nome_campo}: **R${diferenca:.2f}**")

    st.write(
        "Digite o ICMS manualmente ou use o campo abaixo para aplicar em lote."
    )

    # ========= ICMS EM LOTE =========
    icms_lote = st.number_input(
        "ICMS (%) para linhas selecionadas",
        min_value=0.0,
        step=0.01,
        key="icms_lote"
    )

    marcar_todos = st.checkbox("Marcar todos os produtos")

    if marcar_todos:
        df["✔️"] = True
    else:
        df["✔️"] = False

    df_editado = st.data_editor(
        df,
        use_container_width=True,
        num_rows="fixed",
        key="editor"
    )

    if st.button("Aplicar ICMS às linhas selecionadas"):
        df_editado.loc[
            df_editado["✔️"] == True, "ICMS %"
        ] = icms_lote
        st.session_state.df = df_editado

    st.warning(
        "A tabela acima é apenas para edição. "
        "Use o resultado abaixo como valor final."
    )

    # ========= CÁLCULO FINAL =========
    ajuste = df_editado["Valor Unitário"] * st.session_state.percentual_ajuste / 100

    if st.session_state.tipo_ajuste == "desconto":
        ajuste = -ajuste

    df_editado["Custo Unitário Final"] = (
        df_editado["Valor Unitário"]
        + (df_editado["Valor Unitário"] * df_editado["ICMS %"] / 100)
        + (df_editado["Valor Unitário"] * frete_percentual / 100)
        + ajuste
    )

    st.subheader("Resultado Final")

    st.dataframe(
        df_editado.style.format({
            "Valor Unitário": "R$ {:.2f}",
            "Custo Unitário Final": "R$ {:.2f}"
        }),
        use_container_width=True
    )

    st.success("Cálculo realizado com sucesso ✅")
