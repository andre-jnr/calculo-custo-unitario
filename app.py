import streamlit as st
import pandas as pd
from lxml import etree

st.title("Cálculo de Custo Unitário - NF-e")

arquivo_xml = st.file_uploader("Selecione o XML da NF-e", type=["xml"])

# ========= CARREGA XML APENAS UMA VEZ =========
if arquivo_xml and "df" not in st.session_state:
    tree = etree.parse(arquivo_xml)
    root = tree.getroot()

    ns = {"nfe": "http://www.portalfiscal.inf.br/nfe"}

    produtos = []
    valor_total_nota = 0

    for det in root.findall(".//nfe:det", namespaces=ns):
        descricao = det.find(".//nfe:xProd", namespaces=ns)
        quantidade = det.find(".//nfe:qCom", namespaces=ns)
        valor_unit = det.find(".//nfe:vUnCom", namespaces=ns)
        valor_prod = det.find(".//nfe:vProd", namespaces=ns)

        valor_total_nota += float(valor_prod.text)

        produtos.append({
            "✔️": False,
            "Descrição": descricao.text if descricao is not None else None,
            "Quantidade": float(quantidade.text),
            "Valor Unitário": float(valor_unit.text),
            "ICMS %": 0.0
        })

    st.session_state.df = pd.DataFrame(produtos)
    st.session_state.valor_total_nota = valor_total_nota

# ========= SE DATAFRAME JÁ EXISTE =========
if "df" in st.session_state:

    df = st.session_state.df

    st.subheader("Dados Gerais da Nota")

    col1, col2 = st.columns(2)

    with col1:
        valor_frete = st.number_input(
            "Valor total do frete (R$)",
            min_value=0.0,
            step=0.01,
            key="frete"
        )

    with col2:
        suframa_percentual = st.number_input(
            "Percentual de Suframa (%)",
            min_value=0.0,
            step=0.01,
            key="suframa"
        )

    frete_percentual = (
        valor_frete / st.session_state.valor_total_nota * 100
        if st.session_state.valor_total_nota > 0 else 0
    )

    st.info(f"Frete rateado: **{frete_percentual:.2f}%** sobre os produtos")

    st.write("Digite o ICMS embaixo e marque as caixinhas que deseja aplicar essa porcentagem, ou digite no campo ICMS que tem na tabela abaixo.")

    st.subheader("Selecione produtos para aplicar ICMS em lote")

    icms_lote = st.number_input(
        "ICMS (%) para linhas selecionadas",
        min_value=0.0,
        step=0.01,
        key="icms_lote"
    )

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

        # Atualiza o DataFrame persistido
        st.session_state.df = df_editado

    st.warning(
        "Se guie pela tabela abaixo, a tabela acima fica com o valor desatualizado!")

    # ========= CÁLCULO FINAL =========
    df_editado["Custo Unitário Final"] = (
        df_editado["Valor Unitário"]
        + (df_editado["Valor Unitário"] * df_editado["ICMS %"] / 100)
        + (df_editado["Valor Unitário"] * frete_percentual / 100)
        - (df_editado["Valor Unitário"] * st.session_state.suframa / 100)
    )

    st.subheader("Resultado Final")

    st.dataframe(
        df_editado.style.format({
            "Valor Unitário": "R$ {:.2f}",
            "Custo Unitário Final": "R$ {:.2f}"
        }),
        use_container_width=True
    )

    # st.success("Cálculo realizado com sucesso!")
