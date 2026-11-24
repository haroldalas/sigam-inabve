"""
SIGAM-INABVE · Reportes de traslado
  - Excel para TICS (hoja MIGRAR, mismas 8 columnas que se migran a SIVET + columnas nuevas)
  - PDF del traslado, separado por categoría: MEDICAMENTO / INSUMO MÉDICO / PEQUEÑA CIRUGÍA

Uso:  python3 reportes.py <traslado_id> <carpeta_salida>
      DATABASE_URL=postgresql://...  (por defecto, la base local de pruebas)
En la aplicación web estos mismos reportes se generan en el navegador con las
vistas v_sivet_traslado y v_sivet_entrada.
"""
import os, sys, datetime as dt
from decimal import Decimal
import psycopg2, psycopg2.extras
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether

SISTEMA = "SIGAM-INABVE"
SISTEMA_LARGO = "Sistema Integrado de Gestión de Abastecimiento Médico"
INSTITUCION = "Instituto Administrador de los Beneficios de los Veteranos y Excombatientes"
DEPTO = "Departamento de Programas de Salud Integral"
AZUL = "154782"
ORDEN_CAT = ["MEDICAMENTO", "INSUMO MÉDICO", "PEQUEÑA CIRUGÍA"]

def datos(tid):
    con = psycopg2.connect(os.environ.get("DATABASE_URL", "postgresql://postgres:local@localhost/sigam"))
    cur = con.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""select t.*, bo.nombre origen, bd.nombre destino, so.nombre sede_origen, sd.nombre sede_destino
                     from traslados t join bodegas bo on bo.id=t.bodega_origen_id join bodegas bd on bd.id=t.bodega_destino_id
                     join sedes so on so.id=bo.sede_id join sedes sd on sd.id=bd.sede_id where t.id=%s""", (tid,))
    enc = cur.fetchone()
    cur.execute("select * from v_sivet_traslado where traslado_id=%s order by correlativo", (tid,))
    return enc, cur.fetchall()

def f(v): return float(v) if isinstance(v, Decimal) else v

# ----------------------------------------------------------------------------- Excel
def excel(enc, lineas, ruta):
    wb = Workbook(); ws = wb.active; ws.title = "MIGRAR"
    cols = ["Correlativo", "Codigo", "Cantidad", "Precio", "Total", "Factura", "Fecha de factura",
            "NombreContrato_SIVETWEB", "Lote", "Fecha de vencimiento", "Clasificacion AWaRe", "Refrigerado",
            "Controlado", "Categoria"]
    anchos = [13, 22, 9.2, 14.2, 14.2, 11, 15.7, 39.9, 14, 15.7, 16, 12, 12, 18]
    ws.append(cols)
    for i, c in enumerate(ws[1], 1):
        c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor=AZUL)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = anchos[i-1]
    for n, l in enumerate(lineas, 2):
        ws.append([l["correlativo"], l["codigo"], f(l["cantidad"]), f(l["precio"]), f"=C{n}*D{n}", l["factura"],
                   l["fecha_factura"], l["nombre_contrato_sivetweb"], l["lote"], l["fecha_vencimiento"],
                   l["clasificacion_aware"] or "", l["refrigerado"], l["controlado"], l["categoria"]])
        ws[f"B{n}"].number_format = "@"; ws[f"F{n}"].number_format = "@"
        ws[f"C{n}"].number_format = "#,##0"
        ws[f"D{n}"].number_format = ws[f"E{n}"].number_format = "\\$#,##0.00"
        ws[f"G{n}"].number_format = ws[f"J{n}"].number_format = "dd/mm/yyyy"
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{max(len(lineas)+1, 2)}"
    # hoja de referencia del documento
    info = wb.create_sheet("TRASLADO")
    for fila in [(SISTEMA, SISTEMA_LARGO), ("Traslado", enc["numero"]), ("Fecha", enc["fecha"]),
                 ("Origen", f"{enc['origen']} ({enc['sede_origen']})"), ("Destino", f"{enc['destino']} ({enc['sede_destino']})"),
                 ("Estado", enc["estado"]), ("Generado", dt.datetime.now().strftime("%d/%m/%Y %H:%M"))]:
        info.append(list(fila))
    info["A1"].font = Font(bold=True, color=AZUL, size=13); info.column_dimensions["A"].width = 14
    info.column_dimensions["B"].width = 60
    wb.save(ruta)

# ----------------------------------------------------------------------------- PDF
def pdf(enc, lineas, ruta):
    azul = colors.HexColor("#" + AZUL); gris = colors.HexColor("#f2f5f9"); borde = colors.HexColor("#c9d3df")
    st = lambda **k: ParagraphStyle("x", **{"fontName": "Helvetica", "fontSize": 7.4, "leading": 9, **k})
    celda, celda_b = st(), st(fontName="Helvetica-Bold")
    doc = SimpleDocTemplate(ruta, pagesize=landscape(letter), leftMargin=12*mm, rightMargin=12*mm,
                            topMargin=24*mm, bottomMargin=16*mm,
                            title=f"{SISTEMA} · Traslado {enc['numero']}", author=SISTEMA)

    def marco(c, d):
        w, h = landscape(letter)
        c.saveState()
        c.setFillColor(azul); c.rect(0, h-17*mm, w, 17*mm, stroke=0, fill=1)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 13); c.drawString(12*mm, h-9*mm, SISTEMA)
        c.setFont("Helvetica", 8); c.drawString(12*mm, h-13.5*mm, f"{SISTEMA_LARGO} · {DEPTO}")
        c.setFont("Helvetica-Bold", 11); c.drawRightString(w-12*mm, h-9*mm, f"REPORTE DE TRASLADO {enc['numero']}")
        c.setFont("Helvetica", 8); c.drawRightString(w-12*mm, h-13.5*mm, INSTITUCION)
        c.setFillColor(colors.HexColor("#5b6775")); c.setFont("Helvetica", 7)
        c.drawString(12*mm, 8*mm, f"Generado por {SISTEMA} el {dt.datetime.now().strftime('%d/%m/%Y %H:%M')} · "
                                  "Pendiente de migración a SIVET por TICS")
        c.drawRightString(w-12*mm, 8*mm, f"Página {d.page}")
        c.restoreState()

    hist = []
    enc_tab = [["Fecha", enc["fecha"].strftime("%d/%m/%Y"), "Estado", str(enc["estado"]).replace("_", " ").upper()],
               ["Origen", f"{enc['origen']} · {enc['sede_origen']}", "Destino", f"{enc['destino']} · {enc['sede_destino']}"],
               ["Enviado por", enc["enviado_por"] or "", "Recibido por", enc["recibido_por"] or ""]]
    t = Table([[Paragraph(str(x), celda_b if i % 2 == 0 else celda) for i, x in enumerate(r)] for r in enc_tab],
              colWidths=[24*mm, 105*mm, 24*mm, 102*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), gris), ("BACKGROUND", (2, 0), (2, -1), gris),
                           ("GRID", (0, 0), (-1, -1), 0.4, borde), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    hist += [t, Spacer(1, 5*mm)]

    cab = ["#", "Código", "Producto", "Presentación", "Lote", "Vence", "Cant.", "P. unit.", "Total", "Fact.",
           "AWaRe", "Frío", "Contrato SIVET"]
    anchos = [8, 25, 45, 27, 21, 17, 11, 15, 17, 13, 16, 10, 30]
    gran_total = 0
    resumen = []
    for cat in ORDEN_CAT:
        ls = [l for l in lineas if l["categoria"] == cat]
        if not ls: continue
        filas = [[Paragraph(h, st(fontName="Helvetica-Bold", textColor=colors.white)) for h in cab]]
        sub = 0
        for i, l in enumerate(ls, 1):
            sub += f(l["total"])
            filas.append([Paragraph(str(x), celda) for x in [
                i, l["codigo"] or "s/c", l["nombre_comercial"], l["presentacion"] or "", l["lote"] or "",
                l["fecha_vencimiento"].strftime("%d/%m/%Y") if l["fecha_vencimiento"] else "",
                f"{f(l['cantidad']):,.0f}", f"${f(l['precio']):,.2f}", f"${f(l['total']):,.2f}", l["factura"] or "",
                l["clasificacion_aware"] or "", "Sí" if l["refrigerado"] == "SÍ" else "",
                (l["nombre_contrato_sivetweb"] or "").replace(" - ", " · ")]])
        filas.append([""] * 6 + [Paragraph(f"<b>{sum(f(l['cantidad']) for l in ls):,.0f}</b>", celda), "",
                      Paragraph(f"<b>${sub:,.2f}</b>", celda)] + [""] * 4)
        tb = Table(filas, colWidths=[a*mm for a in anchos], repeatRows=1)
        tb.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), azul), ("GRID", (0, 0), (-1, -2), 0.3, borde),
                                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, gris]),
                                ("LINEABOVE", (0, -1), (-1, -1), 0.8, azul), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
        hist += [Paragraph(f"<b>{cat}</b> · {len(ls)} línea(s)", st(fontSize=10, leading=13, textColor=azul)),
                 Spacer(1, 1.5*mm), tb, Spacer(1, 5*mm)]
        gran_total += sub; resumen.append((cat, len(ls), sub))

    res = [["Categoría", "Líneas", "Monto"]] + [[c, str(n), f"${m:,.2f}"] for c, n, m in resumen] + \
          [["TOTAL", str(sum(r[1] for r in resumen)), f"${gran_total:,.2f}"]]
    tr = Table(res, colWidths=[45*mm, 20*mm, 30*mm])
    tr.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), azul), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                            ("FONT", (0, 0), (-1, -1), "Helvetica", 8), ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 8),
                            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("GRID", (0, 0), (-1, -1), 0.3, borde),
                            ("ALIGN", (1, 0), (-1, -1), "RIGHT")]))
    firmas = Table([["", "", "", "", ""], ["Entrega (nombre, firma y sello)", "", "Recibe (nombre, firma y sello)", "",
                                           "Coordinación de Medicamentos e Insumos Médicos"]],
                   colWidths=[72*mm, 18*mm, 72*mm, 18*mm, 72*mm], rowHeights=[16*mm, 6*mm])
    firmas.setStyle(TableStyle([("LINEBELOW", (0, 0), (0, 0), 0.6, colors.black), ("LINEBELOW", (2, 0), (2, 0), 0.6, colors.black),
                                ("LINEBELOW", (4, 0), (4, 0), 0.6, colors.black), ("FONT", (0, 1), (-1, 1), "Helvetica", 7.5),
                                ("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    hist.append(KeepTogether([tr, Spacer(1, 10*mm), firmas]))
    doc.build(hist, onFirstPage=marco, onLaterPages=marco)

if __name__ == "__main__":
    tid, out = int(sys.argv[1]), sys.argv[2]
    os.makedirs(out, exist_ok=True)
    enc, lineas = datos(tid)
    base = os.path.join(out, f"SIGAM_Traslado_{enc['numero']}_{enc['sede_destino'].replace(' ', '')}")
    excel(enc, lineas, base + ".xlsx"); pdf(enc, lineas, base + ".pdf")
    print(base + ".xlsx"); print(base + ".pdf")
