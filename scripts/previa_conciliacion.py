# Vista previa de conciliación SIVET para varios Excel (sin aplicar)
import openpyxl, json, sys, subprocess, re, unicodedata, os
norm = lambda s: re.sub(r'[^A-Z0-9]+', ' ', unicodedata.normalize('NFD', str(s or '')).encode('ascii','ignore').decode().upper()).strip()
def psql(sql, inp=None):
    r = subprocess.run(['su','postgres','-c','psql -d sigam -At -v ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr)
    return r.stdout
cont = [l.split('|') for l in psql("select id, nombre_sivet from contratos").split('\n') if l]
def contrato(fn):
    n = norm(re.sub(r'\.[a-z]+$', '', fn, flags=re.I).replace('Contrato_', '', 1))
    cands = sorted(((c[0], norm(c[1])) for c in cont), key=lambda x: -len(x[1]))
    for _ in range(4):
        for cid, k in cands:
            if n == k or n.startswith(k): return cid, k
        n = re.sub(r'\s*\d+(\s\d+)?$', '', n).strip()
    return None, None
APLICAR = '--aplicar' in sys.argv
res = []
for path in [a for a in sys.argv[1:] if not a.startswith('--')]:
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    rows = list(ws.iter_rows(values_only=True)); h = [norm(x) for x in rows[0]]
    ix = lambda *names: next(i for i, x in enumerate(h) if x in names)
    ic, ip, ifa, ipr, ife = ix('CODIGO'), ix('PRODUCTO'), ix('NUM FACTURA'), ix('PRECIO'), ix('FECHA FACTURA')
    n = lambda v: float(v or 0)
    if 'STOCK' in h: isk = ix('STOCK'); stock = lambda r: n(r[isk])
    else: ica, ig = ix('CANTIDAD'), ix('CANTIDAD GASTADA'); stock = lambda r: n(r[ica]) - n(r[ig])   # contratos de insumos
    filas = [{'codigo': None if r[ic] in (None, '') else str(r[ic]).strip(), 'producto': str(r[ip] or '').strip(),
              'factura': None if r[ifa] in (None, '') else str(r[ifa]), 'stock': str(max(0, stock(r))),
              'precio': None if r[ipr] is None else str(r[ipr]), 'fecha': None if r[ife] is None else str(r[ife])}
             for r in rows[1:] if any(v not in (None, '') for v in r)]
    negs = [(r[ic], r[ip], r[ifa], stock(r)) for r in rows[1:] if any(v not in (None, '') for v in r) and stock(r) < 0]
    if negs: print('  ⚠', os.path.basename(path), 'líneas con gastado mayor que lo comprado (se toman como 0):', negs)
    cid, k = contrato(os.path.basename(path))
    if not cid: print('SIN CONTRATO', path); continue
    j = json.dumps(filas).replace("'", "''")
    out = psql(f"""begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); set local role authenticated;
      select (conciliar_sivet({cid}::smallint, '{j}'::jsonb, {str(APLICAR).lower()}, '{os.path.basename(path)}'))::text; {'commit' if APLICAR else 'rollback'};""")
    r = json.loads([l for l in out.split('\n') if l.startswith('{')][0])
    r['archivo'] = os.path.basename(path); res.append(r)
json.dump(res, open('/tmp/previa_resultado.json', 'w'), ensure_ascii=False)
print(f"{'Contrato':46} {'filas':>5} {'SIVET':>9} {'NoCat':>6} {'Central':>8} {'Antes':>9} {'Después':>9} {'+':>8} {'-':>8} {'Lotes+':>6} {'Excede':>6}")
for r in res:
    print(f"{r['contrato'][:46]:46} {r['filas']:>5} {float(r['sivet_total']):>9,.0f} {float(r['no_encontrado_total']):>6,.0f} {float(r['conservado_total']):>8,.0f} {float(r['actual_total']):>9,.0f} {float(r['final_total']):>9,.0f} {float(r['aumenta']):>8,.0f} {float(r['disminuye']):>8,.0f} {r['lotes_nuevos']:>6} {float(r['conservado_excede']):>6,.0f}")
