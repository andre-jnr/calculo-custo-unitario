from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import inch
import io


def formatar_percentual(valor):
    return f"{valor:.2f}".replace(".", ",") + "%"


def formatar_moeda(valor):
    return "R$ " + f"{valor:.2f}".replace(".", ",")


def gerar_pdf(df):
    buffer = io.BytesIO()

    # ✅ MODO PAISAGEM
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
    elements = []

    styles = getSampleStyleSheet()
    elements.append(Paragraph("Resultado Final - Cálculo de Custo Unitário", styles["Title"]))
    elements.append(Spacer(1, 0.3 * inch))

    # ========= FORMATANDO OS DADOS =========
    df_pdf = df.copy()

    df_pdf["Custo"] = df_pdf["Custo"].apply(formatar_moeda)
    df_pdf["Custo Final"] = df_pdf["Custo Final"].apply(formatar_moeda)

    df_pdf["ICMS %"] = df_pdf["ICMS %"].apply(formatar_percentual)
    df_pdf["% Frete"] = df_pdf["% Frete"].apply(formatar_percentual)
    df_pdf["% Suframa/Outras"] = df_pdf["% Suframa/Outras"].apply(formatar_percentual)
    df_pdf["% Custos Adicionais"] = df_pdf["% Custos Adicionais"].apply(formatar_percentual)

    # Converte dataframe para lista
    data = [df_pdf.columns.tolist()] + df_pdf.values.tolist()

    tabela = Table(data, repeatRows=1)

    tabela.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (1, 1), (-1, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
    ]))

    elements.append(tabela)
    doc.build(elements)

    buffer.seek(0)
    return buffer
