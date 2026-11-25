"""
SIGAM-INABVE · Migración de datos desde SIFAR-INABVE ERP 3.1 (.xlsm)

Uso:
    python3 migrar_sifar.py <SIFAR.xlsm> <WHO-AWaRe.xlsx> <carpeta_salida>

Genera archivos SQL (seed_*.sql) listos para cargar en orden en Supabase,
y un informe (informe_migracion.md) con todo lo que se decidió o quedó por revisar.
Los códigos de producto NO se alteran (son los mismos de SIVET).
"""
import sys, os, re, datetime as dt, collections, warnings
import openpyxl

warnings.filterwarnings("ignore")
XLSM, AWARE_XLSX, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
INFORME = []
def nota(t): INFORME.append(t)

# --------------------------------------------------------------------------- lectura
wb = openpyxl.load_workbook(XLSM, data_only=True)
T = {}
for ws in wb.worksheets:
    for tn in ws.tables.keys():
        rows = list(ws[ws.tables[tn].ref]); h = [c.value for c in rows[0]]
        T[tn] = [dict(zip(h, [c.value for c in r])) for r in rows[1:] if any(c.value is not None for c in r)]

def q(v):
    """Literal SQL."""
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int,)): return str(v)
    if isinstance(v, float): return repr(round(v, 6))
    if isinstance(v, dt.datetime):   # SIFAR guardaba la hora local de El Salvador sin zona horaria
        return "'" + v.isoformat(sep=" ") + ("" if v.tzinfo else "-06:00") + "'"
    if isinstance(v, dt.date): return "'" + v.isoformat() + "'"
    return "'" + str(v).replace("'", "''") + "'"

def as_date(v):
    if v is None or v == "": return None
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    s = str(v).strip()
    for f in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try: return dt.datetime.strptime(s, f).date()
        except ValueError: pass
    return None

def as_ts(v):
    if isinstance(v, dt.datetime): return v
    d = as_date(v); return dt.datetime.combine(d, dt.time()) if d else None

def num(v, default=0.0):
    try: return float(v) if v not in (None, "") else default
    except (TypeError, ValueError): return default

def codigo(v):
    if v is None or str(v).strip() == "": return None
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()

def ins(tabla, cols, filas, archivo, lote=800):
    out = []
    for i in range(0, len(filas), lote):
        vals = ",\n".join("(" + ",".join(q(x) for x in f) + ")" for f in filas[i:i+lote])
        out.append(f"insert into {tabla} ({','.join(cols)}) overriding system value values\n{vals};\n")
    archivo.write("".join(out))

# --------------------------------------------------------------------------- sedes y bodegas
SEDES = [  # id, codigo, nombre, nombre_sivet
    (1, "JPII", "Juan Pablo II", "JUAN PABLO II"),
    (2, "SM",   "San Miguel",    "SAN MIGUEL"),
    (3, "SA",   "Santa Ana",     "SANTA ANA"),
    (4, "CH",   "Chalatenango",  "CHALATENANGO"),
]
SEDE_COD = {s[1]: s[0] for s in SEDES}
# id, codigo, nombre, sede, tipo, permite_entradas, solo_admin, sifar_id
BODEGAS = [(1, "JPII-CEN", "Bodega Central Juan Pablo II", 1, "central", True, False, 1)]
nid = 2
SIFAR_BOD = {"JPII": {"despacho_medicamentos": 2, "almacen_insumos": 8, "pequena_cirugia": 7, "campo": 9},
             "SM": {"despacho_medicamentos": 3, "almacen_insumos": 10},
             "CH": {"despacho_medicamentos": 4, "almacen_insumos": 11},
             "SA": {"despacho_medicamentos": 5, "almacen_insumos": 12}}
NOMBRE_TIPO = {"despacho_medicamentos": "Despacho de Medicamentos", "almacen_insumos": "Almacén de Insumos Médicos",
               "pequena_cirugia": "Pequeña Cirugía", "campo": "Campo"}
for sid, scod, snom, _ in SEDES:
    for tipo, tnom in NOMBRE_TIPO.items():
        BODEGAS.append((nid, f"{scod}-{tipo[:3].upper()}", f"{tnom} {snom}", sid, tipo, False, False,
                        SIFAR_BOD.get(scod, {}).get(tipo)))
        nid += 1
BODEGAS.append((nid, "DESCARTE", "Descarte (solo administración)", 1, "descarte", False, True, 6))
BOD_MAP = {b[7]: b[0] for b in BODEGAS if b[7]}          # sifar -> sigam
BOD_SEDE = {b[0]: b[3] for b in BODEGAS}
BOD_TIPO = {b[0]: b[4] for b in BODEGAS}
nota(f"- Se crearon {len(BODEGAS)} bodegas: bodega central en Juan Pablo II; en cada sede Despacho de Medicamentos, "
     "Almacén de Insumos Médicos, Pequeña Cirugía y Campo; una bodega de Descarte visible solo para administradores.")

# --------------------------------------------------------------------------- familias
fam_rows, FAM = [], {}
for f in T["tblFamiliasTerapeuticas"]:
    if f["IDFamilia"] and f["NombreFamilia"]:
        FAM[f["IDFamilia"]] = str(f["NombreFamilia"]).strip()
        fam_rows.append((f["IDFamilia"], FAM[f["IDFamilia"]], str(f["Estado"]).upper() != "INACTIVO"))

# --------------------------------------------------------------------------- AWaRe
aw = {}
wbw = openpyxl.load_workbook(AWARE_XLSX, data_only=True)
for r in wbw["AWaRe classification 2023"].iter_rows(values_only=True):
    if r[0] and r[3] in ("Access", "Watch", "Reserve") or (r[0] and str(r[3]).strip() in ("Access", "Watch", "Reserve")):
        aw[str(r[0]).strip().lower()] = {"Access": "acceso", "Watch": "precaucion", "Reserve": "reserva"}[str(r[3]).strip()]
# principio activo (SIFAR) -> nombre OMS. Solo antibióticos sistémicos que coinciden con la lista.
ES_EN = {
    "AMIKACINA": "amikacin", "AMOXICILINA": "amoxicillin",
    "AMOXICILINA + ACIDO CLAVULAMICO": "amoxicillin/clavulanic-acid", "AZITROMICINA": "azithromycin",
    "CEFADROXILO": "cefadroxil", "CEFDITOREN": "cefditoren-pivoxil", "CEFIXIMA": "cefixime",
    "CEFTRIAXONA": "ceftriaxone", "CIPROFLOXACINO": "ciprofloxacin", "CLARITROMICINA": "clarithromycin",
    "CLINDAMICINA": "clindamycin", "DOXICICLINA": "doxycycline", "FOSFOMICINA": "fosfomycin_oral",
    "GENTAMICINA": "gentamicin", "LEVOFLOXACINA": "levofloxacin", "METRONIDAZOL": "metronidazole_oral",
    "NITROFURANTOINA": "nitrofurantoin", "PENICILINA BENZATINICA": "benzathine-benzylpenicillin",
    "TETRACICLINA": "tetracycline", "TRIMETOPRIM SULFAMETOXASOL": "sulfamethoxazole/trimethoprim",
}
TOPICO = re.compile(r"TUBO|CREMA|GEL|OTIC|SPRAY|POMADA|UNGUENTO|UNGÜENTO|GOTAS|COLIRIO|OFT", re.I)

# --------------------------------------------------------------------------- productos
prod_rows, PROD_IDS, aware_rep, pend_aware, sin_codigo = [], set(), [], [], 0
vistos = {}
for m in T["tblMedicamentos"]:
    pid = m["IDMedicamento"]
    if not pid: continue
    if pid in vistos:   # ID duplicado: se conserva el registro modificado más recientemente
        nota(f"- Producto ID {pid} ({m['NombreComercial']}) estaba duplicado en SIFAR; se dejó un solo registro.")
        if not m["FechaModificacion"]: continue
        prod_rows = [r for r in prod_rows if r[0] != pid]
    vistos[pid] = True
    fam = FAM.get(m["IDFamilia"])
    cod = codigo(m["CodigoBarras"])
    if cod is None: sin_codigo += 1
    tipo = "insumo" if (fam in ("INSUMO MEDICO", "CURACION") or (cod or "").upper().startswith("INS")) else "medicamento"
    pa = re.sub(r"\s+", " ", str(m["PrincipioActivo"] or "")).strip().upper()
    present = f"{m['NombreComercial']} {m['Presentacion']}"
    aware = None
    if fam and "ANTIBIOTICO" in fam:
        en = ES_EN.get(pa)
        if en and en in aw and not TOPICO.search(present):
            aware = aw[en]; aware_rep.append((pid, m["NombreComercial"], pa, aware))
        else:
            pend_aware.append((pid, m["NombreComercial"], pa, fam))
    frio = "INSULINA" in pa and "JERINGA" not in str(m["NombreComercial"]).upper()
    prod_rows.append((pid, cod, str(m["NombreComercial"]).strip(), pa or None, codigo(m["Concentracion"]),
                      m["Presentacion"], m["IDFamilia"] if m["IDFamilia"] in FAM else None, tipo, aware,
                      False, frio, str(m["Estado"]).lower() == "activo", m["MotivoInactividad"],
                      m["UsuarioModificacion"], as_ts(m["FechaModificacion"])))
    PROD_IDS.add(pid)
cods = collections.Counter(r[1] for r in prod_rows if r[1])
for c, k in cods.items():
    if k > 1: nota(f"- ALERTA: el código {c} lo tienen {k} productos distintos; se dejó sin unicidad hasta revisar.")
dup_cod = {c for c, k in cods.items() if k > 1}
apostrofe = [r for r in prod_rows if r[1] and "'" in r[1]]
nota(f"- {len(prod_rows)} productos migrados ({sum(1 for r in prod_rows if r[7]=='insumo')} insumos médicos, "
     f"{sum(1 for r in prod_rows if r[7]=='medicamento')} medicamentos). {sin_codigo} sin código: se conservan así.")
if apostrofe:
    nota(f"- {len(apostrofe)} códigos internos están guardados con apóstrofo (p. ej. {apostrofe[0][1]}) en lugar de guion. "
         "No se modificaron; confirmar cómo están en SIVET.")
nota(f"- Cadena de frío marcada en: {', '.join(r[2] for r in prod_rows if r[10])}.")
nota(f"- AWaRe asignada a {len(aware_rep)} productos que coinciden con la lista OMS 2023; "
     f"{len(pend_aware)} antibióticos quedan sin clasificar para que los defina (tópicos, combinaciones o fuera de lista).")

# --------------------------------------------------------------------------- proveedores y contratos
PROVS = [  # id, nombre, nombre_sivet, es_cefafa, carga_inicial, activo
    (1, "CEFAFA", "CEFAFA", True, False, True), (2, "EQUIMED", "EQUIMED", False, False, True),
    (3, "S.T. MEDIC", "S.T. MEDIC", False, False, True), (4, "ASCES", "ASCES", False, False, True),
    (5, "APAMO", "APAMO", False, False, True), (6, "FOPROLYD", "FOPROLYD", False, False, True),
    (7, "SUPLIDORES DIVERSOS", "SUPLIDORES DIVERSOS", False, False, True),
    (8, "DADA DADA Y CÍA", "DADA DADA Y CÍA", False, False, True), (9, "CIENFUEGOS", "CIENFUEGOS", False, False, True),
    (10, "COPROSER", "COPROSER", False, False, True),   # TECMED (11) = CIENFUEGOS
    (12, "PROMEDIC", "PROMEDIC", False, False, True), (13, "PISA", "PISA", False, False, True),
    (14, "AMERICARE", "AMERICARE", False, False, True), (15, "MEDICALD INVERSIONES", "MEDICALD INVERSIONES", False, False, True),
    (16, "FARMA", "FARMA", False, False, False),
    (17, "CARGA INICIAL INVENTARIO", "CARGA INICIAL", False, True, True),
]
PROV_MAP = {1: 1, 10: 1, 16: 1, 4: 2, 12: 2, 5: 3, 6: 4, 15: 5, 7: 6, 8: 7, 9: 8, 11: 9, 13: 10, 14: 9,
            17: 12, 18: 13, 19: 14, 20: 15, 2: 16, 3: 1}   # «CARGA INICIAL» de SIFAR = CEFAFA
nota("- Proveedores unificados: «Cefafa» y «CEFAFA» en uno solo; los dos «EQUIMED» en uno; «ASOCIACION DE CIEGOS» = ASCES; "
     "«CARLOS CIENFUEGOS» y «TECMED» = CIENFUEGOS; la «CARGA INICIAL» de SIFAR es de CEFAFA; el proveedor que tenía un código de barras como nombre (1 factura DTE) se asignó a CEFAFA.")
# números de contrato SIVET: (JPII, SA, CH, SM)
NUM = {("CEFAFA", "medicamento"): (1, 2, 3, 4), ("CEFAFA", "insumo"): (5, 6, 7, 8),
       ("EQUIMED", "insumo"): (9, 10, 11, 12), ("S.T. MEDIC", "insumo"): (13, 14, 15, 16),
       ("ASCES", "insumo"): (17, 18, 19, 20), ("APAMO", "insumo"): (21, 22, 23, 24),
       ("FOPROLYD", "insumo"): (25, 26, 27, 28), ("SUPLIDORES DIVERSOS", "insumo"): (29, 30, 32, 31),
       ("DADA DADA Y CÍA", "insumo"): (33, 34, 35, 36), ("CIENFUEGOS", "insumo"): (37, 39, 38, 40),
       ("COPROSER", "insumo"): (41, 42, 44, 43)}
prov_id = {p[1]: p[0] for p in PROVS}
cont_rows, cid = [], 1
for (pn, tp), nums in NUM.items():
    for scod, n in zip(("JPII", "SA", "CH", "SM"), nums):
        s = next(x for x in SEDES if x[1] == scod)
        cont_rows.append((cid, n, prov_id[pn], s[0], tp,
                          f"{pn} - {'MEDICAMENTOS' if tp=='medicamento' else 'INSUMOS'} - {s[3]}"))
        cid += 1

# --------------------------------------------------------------------------- facturas
fac_rows, FAC_PROV, FAC_OK = [], {}, set()
for e in T["tblEntradasEnc"]:
    if not e["IDEntrada"] or e["Estado"] == "Borrador": continue
    prov = PROV_MAP.get(e["IDProveedor"], 17)
    bod = BOD_MAP.get(e["IDBodega"], 1)
    numero = codigo(e["NumeroFactura"])
    fac_rows.append((e["IDEntrada"], numero, as_date(e["FechaFactura"]), prov, bod,
                     "anulada" if e["Estado"] == "Anulada" else "confirmada", e["Observaciones"],
                     as_ts(e["FechaRegistro"]), e["IDEntrada"]))
    FAC_PROV[e["IDEntrada"]] = prov; FAC_OK.add(e["IDEntrada"])
fen = collections.Counter(BOD_TIPO[r[4]] for r in fac_rows)
nota(f"- {len(fac_rows)} facturas migradas. Por bodega de registro en SIFAR: {dict(fen)}. "
     "En adelante solo la bodega central registra entradas.")

# lote original (para número de lote de la línea de factura)
lote_por_det = {}
for l in sorted(T["tblLotes"], key=lambda x: x["IDLote"] or 0):
    if l["IDDetalleEntrada"] and l["IDDetalleEntrada"] not in lote_por_det:
        lote_por_det[l["IDDetalleEntrada"]] = l
det_rows, DET_OK, DET_FAC = [], set(), {}
for d in T["tblEntradasDet"]:
    if not d["IDDetalleEntrada"] or d["IDEntrada"] not in FAC_OK or d["IDMedicamento"] not in PROD_IDS: continue
    if num(d["Cantidad"]) <= 0: continue
    lo = lote_por_det.get(d["IDDetalleEntrada"], {})
    det_rows.append((d["IDDetalleEntrada"], d["IDEntrada"], d["IDMedicamento"], num(d["Cantidad"]),
                     max(num(d["PrecioUnitario"]), 0), lo.get("NumeroLote"),
                     as_date(d["FechaExpiracion"]) or as_date(lo.get("FechaVencimiento")), d["IDDetalleEntrada"]))
    DET_OK.add(d["IDDetalleEntrada"]); DET_FAC[d["IDDetalleEntrada"]] = d["IDEntrada"]

# --------------------------------------------------------------------------- lotes
lot_rows, LOT_OK, mov_rows, mid = [], set(), [], 1
for l in T["tblLotes"]:
    if not l["IDLote"] or l["IDBodega"] not in BOD_MAP or l["IDMedicamento"] not in PROD_IDS: continue
    bod = BOD_MAP[l["IDBodega"]]
    det = l["IDDetalleEntrada"] if l["IDDetalleEntrada"] in DET_OK else None
    prov = FAC_PROV.get(DET_FAC.get(det)) if det else None
    disp = max(num(l["CantidadDisponible"]), 0)
    estado = "agotado" if disp <= 0 else ("bloqueado" if l["IDEstadoLote"] == 4 else
                                          "cuarentena" if l["IDEstadoLote"] == 7 else "activo")
    lot_rows.append((l["IDLote"], det, l["IDMedicamento"], bod, prov, l["NumeroLote"], as_date(l["FechaVencimiento"]),
                     num(l["PrecioCompra"]), num(l["CantidadInicial"]), disp, estado, as_ts(l["FechaCreacion"]), l["IDLote"]))
    LOT_OK.add(l["IDLote"])
    if disp > 0:
        mov_rows.append((mid, as_ts(l["FechaModificacion"]) or as_ts(l["FechaCreacion"]), "carga_inicial", l["IDLote"],
                         l["IDMedicamento"], bod, disp, disp, "migracion_sifar", None, "migracion", "Saldo migrado de SIFAR"))
        mid += 1
# lote_origen_id: copias por traslado (misma línea de factura, otra bodega)
primero = {}
for r in sorted(lot_rows, key=lambda x: x[0]):
    if r[1]:
        primero.setdefault(r[1], r[0])

# --------------------------------------------------------------------------- salidas
sal_rows, SAL_OK, sal_ids = [], set(), set()
for s in T["tblSalidasEnc"]:
    if not s["IDSalida"] or s["Estado"] == "Borrador" or s["IDBodega"] not in BOD_MAP: continue
    if s["IDSalida"] in sal_ids:
        nota(f"- Salida ID {s['IDSalida']} duplicada en SIFAR ({s['NumeroSalida']}); se conservó la primera.")
        continue
    sal_ids.add(s["IDSalida"])
    bod = BOD_MAP[s["IDBodega"]]
    sal_rows.append((s["IDSalida"], s["NumeroSalida"], as_date(s["Fecha"]), bod,
                     "personal" if BOD_TIPO[bod] == "pequena_cirugia" else "beneficiario",
                     codigo(s["Expediente"]), s["Observaciones"],
                     "anulada" if s["Estado"] == "Anulada" else "confirmada", as_ts(s["FechaRegistro"]), s["IDSalida"]))
    SAL_OK.add(s["IDSalida"])
nums = collections.Counter(r[1] for r in sal_rows)
sal_rows = [r if nums[r[1]] == 1 else (r[0], f"{r[1]}-{r[0]}",) + r[2:] for r in sal_rows]
sd_rows, sdid, sd_seen = [], 1, set()
for d in T["tblSalidasDet"]:
    if d["IDSalida"] not in SAL_OK or d["IDMedicamento"] not in PROD_IDS or num(d["Cantidad"]) <= 0: continue
    key = (d["IDDetalleSalida"], d["IDSalida"], d["IDMedicamento"], d["IDLote"], d["Cantidad"])
    if key in sd_seen: continue
    sd_seen.add(key)
    sd_rows.append((sdid, d["IDSalida"], d["IDMedicamento"], d["IDLote"] if d["IDLote"] in LOT_OK else None,
                    num(d["Cantidad"]), d["IDDetalleSalida"]))
    sdid += 1
nota(f"- {len(sal_rows)} salidas y {len(sd_rows)} líneas migradas (las salidas en borrador no se migran). "
     "Las salidas de SIFAR solo tienen expediente; desde ahora se registra el DUI.")

# --------------------------------------------------------------------------- traslados
EST = {"Recibido": "recibido", "Cancelado": "anulado", "ConDiferencias": "con_diferencias", "EnTransito": "enviado"}
tr_rows, TR_OK, TR_DEST = [], set(), {}
for t in T["tblTrasladosEnc"]:
    if not t["IDTraslado"] or t["IDBodegaOrigen"] not in BOD_MAP or t["IDBodegaDestino"] not in BOD_MAP: continue
    o, d = BOD_MAP[t["IDBodegaOrigen"]], BOD_MAP[t["IDBodegaDestino"]]
    if o == d: continue
    tr_rows.append((t["IDTraslado"], t["NumeroTraslado"], as_date(t["FechaTraslado"]), o, d, EST.get(t["EstadoTraslado"], "recibido"),
                    t["Observaciones"], t["UsuarioCreacion"], as_ts(t["FechaCreacion"]) or as_ts(t["FechaTraslado"]),
                    as_ts(t["FechaRecepcion"]), t["IDTraslado"]))
    TR_OK.add(t["IDTraslado"]); TR_DEST[t["IDTraslado"]] = (d, EST.get(t["EstadoTraslado"]))
lotes_by_key = collections.defaultdict(list)
for r in lot_rows: lotes_by_key[(r[3], r[2], r[1])].append(r[0])
lot_det = {r[0]: r[1] for r in lot_rows}
td_rows, dif_rows, did = [], [], 1
for d in T["tblTrasladosDet"]:
    if d["IDTraslado"] not in TR_OK or d["IDMedicamento"] not in PROD_IDS or num(d["CantidadEnviada"]) <= 0: continue
    lo = d["IDLote"] if d["IDLote"] in LOT_OK else None
    dest, est = TR_DEST[d["IDTraslado"]]
    ld = None
    if lo and est != "enviado":
        cands = lotes_by_key.get((dest, d["IDMedicamento"], lot_det.get(lo)), [])
        ld = cands[0] if cands else None
    rec = None if est == "enviado" else num(d["CantidadRecibida"], num(d["CantidadEnviada"]))
    td_rows.append((d["IDDetalleTraslado"], d["IDTraslado"], d["IDMedicamento"], lo, ld, num(d["CantidadEnviada"]),
                    rec, d["Observaciones"], d["IDDetalleTraslado"]))
    if est == "con_diferencias" and rec is not None and rec != num(d["CantidadEnviada"]):
        dif_rows.append((did, d["IDTraslado"], d["IDDetalleTraslado"], d["IDMedicamento"],
                         "faltante" if rec < num(d["CantidadEnviada"]) else "sobrante",
                         num(d["CantidadEnviada"]), rec, "Migrado de SIFAR"))
        did += 1
nota(f"- {len(tr_rows)} traslados migrados; {sum(1 for r in tr_rows if r[5]=='enviado')} siguen en tránsito y podrán "
     f"recibirse en SIGAM. {len(dif_rows)} diferencias de SIFAR quedan pendientes en la bandeja del administrador.")
tr_without_lote = sum(1 for r in td_rows if r[3] is None)
if tr_without_lote: nota(f"- {tr_without_lote} líneas de traslado no tienen lote de origen identificable en SIFAR.")

# --------------------------------------------------------------------------- usuarios
ADMINS = {"oscar.rivas", "harold.alas"}   # los demás solicitan su acceso desde SIGAM
perf_rows, omit = [], []
for u in T["tblUsuarios"]:
    red = str(u["UsuarioRed"] or "").strip().lower()
    if not red or "." not in red: omit.append(red); continue
    bod = BOD_MAP.get(u["IDBodegaAsignada"], 1)
    rol = "administrador" if red in ADMINS else ("consulta" if u["IDRol"] in (4, 5) else "dependiente")
    # Solo los administradores quedan habilitados. El resto entra con su cuenta Microsoft, envía su
    # solicitud y un administrador le asigna el rol; el rol de SIFAR queda como sugerencia.
    adm = rol == "administrador"
    perf_rows.append((f"{red}@inabve.gob.sv", u["NombreCompleto"], "administrador" if adm else "consulta",
                      BOD_SEDE[bod] if rol != "consulta" else None,
                      adm and str(u["Estado"]).lower() == "activo", red, rol,
                      "aprobada" if adm else "sin_enviar"))
nota(f"- {len(perf_rows)} usuarios precargados (correo = usuario de red @inabve.gob.sv): "
     f"{sum(1 for r in perf_rows if r[6]=='administrador')} administradores habilitados; el resto queda sin acceso hasta que envíe su solicitud "
     f"(rol sugerido según SIFAR: {sum(1 for r in perf_rows if r[6]=='dependiente')} dependientes, {sum(1 for r in perf_rows if r[6]=='consulta')} de consulta). Omitidos por usuario incompleto: {omit}.")

# --------------------------------------------------------------------------- escritura
with open(os.path.join(OUT, "seed_01_catalogos.sql"), "w") as f:
    f.write("-- SIGAM-INABVE · datos iniciales: catálogos\n")
    ins("sedes", ["id", "codigo", "nombre", "nombre_sivet"], SEDES, f)
    ins("bodegas", ["id", "codigo", "nombre", "sede_id", "tipo", "permite_entradas", "solo_admin", "sifar_id"], BODEGAS, f)
    ins("familias", ["id", "nombre", "activa"], fam_rows, f)
    f.write("alter table productos disable trigger productos_validar;\n")
    pr = [r if r[1] not in dup_cod else (r[0], None) + r[2:] for r in prod_rows]
    ins("productos", ["id", "codigo", "nombre_comercial", "principio_activo", "concentracion", "presentacion", "familia_id",
                      "tipo", "aware", "controlado", "cadena_frio", "activo", "motivo_inactividad", "modificado_por",
                      "modificado_at"], pr, f)
    f.write("alter table productos enable trigger productos_validar;\n")
    ins("proveedores", ["id", "nombre", "nombre_sivet", "es_cefafa", "es_carga_inicial", "activo"], PROVS, f)
    ins("contratos", ["id", "numero_sivet", "proveedor_id", "sede_id", "tipo", "nombre_sivet"], cont_rows, f)
    ins("perfiles", ["email", "nombre", "rol", "sede_id", "activo", "sifar_usuario", "rol_sugerido", "estado_solicitud"], [r for r in perf_rows], f)
    f.write(f"insert into correlativos values ('traslado', {max(r[0] for r in tr_rows)}) on conflict do nothing;\n")

with open(os.path.join(OUT, "seed_02_facturas_lotes.sql"), "w") as f:
    ins("facturas", ["id", "numero", "fecha_factura", "proveedor_id", "bodega_id", "estado", "observaciones", "creado_at",
                     "sifar_id"], fac_rows, f)
    ins("factura_detalle", ["id", "factura_id", "producto_id", "cantidad", "precio_unitario", "numero_lote",
                            "fecha_vencimiento", "sifar_id"], det_rows, f)
    ins("lotes", ["id", "factura_detalle_id", "producto_id", "bodega_id", "proveedor_id", "numero_lote", "fecha_vencimiento",
                  "precio_unitario", "cantidad_inicial", "disponible", "estado", "creado_at", "sifar_id"], lot_rows, f)
    f.write("""update lotes l set lote_origen_id = o.id from (
  select factura_detalle_id, min(id) id from lotes where factura_detalle_id is not null group by 1) o
 where l.factura_detalle_id = o.factura_detalle_id and l.id <> o.id;\n""")
    ins("movimientos", ["id", "fecha", "tipo", "lote_id", "producto_id", "bodega_id", "cantidad", "saldo_lote", "documento",
                        "documento_id", "usuario", "observacion"], mov_rows, f)

with open(os.path.join(OUT, "seed_03_salidas.sql"), "w") as f:
    ins("salidas", ["id", "numero", "fecha", "bodega_id", "tipo", "expediente", "observaciones", "estado", "creado_at",
                    "sifar_id"], sal_rows, f)
    ins("salida_detalle", ["id", "salida_id", "producto_id", "lote_id", "cantidad", "sifar_id"], sd_rows, f, lote=1500)

with open(os.path.join(OUT, "seed_04_traslados.sql"), "w") as f:
    ins("traslados", ["id", "numero", "fecha", "bodega_origen_id", "bodega_destino_id", "estado", "observaciones",
                      "enviado_por", "enviado_at", "recibido_at", "sifar_id"], tr_rows, f)
    ins("traslado_detalle", ["id", "traslado_id", "producto_id", "lote_origen_id", "lote_destino_id", "cantidad_enviada",
                             "cantidad_recibida", "observacion", "sifar_id"], td_rows, f)
    if dif_rows:
        ins("traslado_diferencias", ["id", "traslado_id", "traslado_detalle_id", "producto_id", "tipo", "cantidad_enviada",
                                     "cantidad_recibida", "observacion_sede"], dif_rows, f)
    # reinicia las secuencias de identidad
    for t in ["sedes", "bodegas", "familias", "productos", "proveedores", "contratos", "facturas", "factura_detalle",
              "lotes", "movimientos", "salidas", "salida_detalle", "traslados", "traslado_detalle", "traslado_diferencias"]:
        f.write(f"select setval(pg_get_serial_sequence('{t}','id'), coalesce((select max(id) from {t}),0)+1, false);\n")

with open(os.path.join(OUT, "informe_migracion.md"), "w") as f:
    f.write("# Informe de migración SIFAR → SIGAM-INABVE\n\n" + "\n".join(INFORME) + "\n\n")
    f.write("## AWaRe asignada\n\n| ID | Producto | Principio activo | Clasificación |\n|---|---|---|---|\n")
    for r in aware_rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |\n")
    f.write("\n## Antibióticos sin clasificar (definir en el catálogo)\n\n| ID | Producto | Principio activo | Familia |\n|---|---|---|---|\n")
    for r in pend_aware: f.write(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |\n")

# control de cuadre para las pruebas
tot = collections.defaultdict(float)
for r in lot_rows: tot[(r[2], r[3])] += r[9]
with open(os.path.join(OUT, "control_existencias.csv"), "w") as f:
    f.write("producto_id,bodega_id,disponible\n")
    for (p, b), v in sorted(tot.items()):
        if v: f.write(f"{p},{b},{v}\n")
print("\n".join(INFORME))
