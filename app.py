import streamlit as st
import pandas as pd
from lxml import etree
from pdf import gerar_pdf

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
            "Qtd Caixa": 1,
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
        st.info(f"{nome_campo[:-4]}: **R${diferenca:.2f}**")

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

    # Cria um NOVO dataframe só para cálculo
    df_calculo = df_editado.copy()

    # Percentuais individuais
    df_calculo["% Frete"] = frete_percentual
    df_calculo["% Suframa/Outras"] = st.session_state.percentual_ajuste

    if st.session_state.tipo_ajuste == "desconto":
        df_calculo["% Suframa/Outras"] = -df_calculo["% Suframa/Outras"]

    # Percentual total adicional
    df_calculo["% Custos Adicionais"] = (
        df_calculo["ICMS %"]
        + df_calculo["% Frete"]
        + df_calculo["% Suframa/Outras"]
    )

    # Ajuste do valor unitário pela quantidade da caixa
    df_calculo["Custo"] = (
        df_calculo["Valor Unitário"] / df_calculo["Qtd Caixa"]
    )

    # Cálculo do custo final
    df_calculo["Custo Final"] = (
        df_calculo["Custo"]
        * (1 + df_calculo["% Custos Adicionais"] / 100)
    )

    # ========= TABELA FINAL ORGANIZADA =========

    tabela_final = df_calculo[[
        "Descrição",
        "Custo",
        "ICMS %",
        "% Frete",
        "% Suframa/Outras",
        "% Custos Adicionais",
        "Custo Final"
    ]]

    st.subheader("Resultado Final")

    st.dataframe(
        tabela_final.style.format({
            "Custo": "R$ {:.2f}",
            "Custo Final": "R$ {:.2f}",
            "ICMS %": "{:.2f}%",
            "% Frete": "{:.2f}%",
            "% Suframa/Outras": "{:.2f}%",
            "% Custos Adicionais": "{:.2f}%"
        }),
        use_container_width=True
    )


    # Botão para exportar PDF
    pdf_buffer = gerar_pdf(tabela_final)

    st.download_button(
        label="📄 Baixar Resultado em PDF",
        data=pdf_buffer,
        file_name="resultado_custo_unitario.pdf",
        mime="application/pdf"
    )
