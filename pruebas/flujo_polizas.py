# Prueba: póliza CEFAFA (lectura del PDF y cruce con entradas) y marca "efectivo en SIVET" en traslados
import sys, subprocess; sys.path.insert(0, '.')
from smoke import *

def sql(s):
    return subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True).stdout.strip()
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def toast(pg, timeout=30000):
    pg.wait_for_selector('.toast', timeout=timeout); t = pg.inner_text('#toasts'); pg.evaluate("document.querySelector('#toasts').innerHTML=''"); return t

# facturas de prueba: 2244 con el mismo monto, 2253 con monto distinto
sql("delete from polizas"); sql("update traslados set sivet_efectivo=false, sivet_referencia=null")
sql("""do \\$\\$ declare f bigint; begin
  delete from factura_detalle where factura_id in (select id from facturas where numero in ('PRUEBA-2244','PRUEBA-2253'));
  delete from facturas where numero in ('PRUEBA-2244','PRUEBA-2253');
  insert into facturas(numero, fecha_factura, proveedor_id, bodega_id) values ('PRUEBA-2244','2026-05-20',1,1) returning id into f;
  insert into factura_detalle(factura_id, producto_id, cantidad, precio_unitario) values (f, 47, 10, 96.99);
  insert into facturas(numero, fecha_factura, proveedor_id, bodega_id) values ('PRUEBA-2253','2026-05-20',1,1) returning id into f;
  insert into factura_detalle(factura_id, producto_id, cantidad, precio_unitario) values (f, 47, 10, 90.00);
end \\$\\$""")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = contexto(br, 'admin'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'GoTrue' not in m.text else None)
    print('1. Póliza CEFAFA')
    pg.goto('http://localhost:8080/#polizas'); pg.wait_for_selector('.pestanas', timeout=30000)
    pg.click('text=Subir póliza')
    pg.set_input_files('input[type=file]', '/home/claude/pruebas_conc/P050526_escaneada.pdf')
    pg.wait_for_selector("text=/Se leyeron|No se pudieron|No se pudo leer/", timeout=180000)
    aviso = pg.inner_text('section.tarjeta p.nota >> nth=0')
    print('   ', [t for t in pg.inner_text('body').split('\n') if 'Se leyeron' in t or 'No se pudieron' in t][:1])
    filas = pg.locator('tbody tr').count()
    ok(filas == 44, f'se leyeron {filas} facturas del PDF')
    ok(pg.input_value('input[placeholder=P050526]') == 'P050526', 'número de póliza leído')
    import json
    verdad = {r[0]: r for r in json.load(open('/home/claude/ocr/verdad.json'))}
    amarillas = pg.locator('tbody tr.fila-aviso').count()
    print(f'    líneas marcadas para revisar: {amarillas}')
    # la persona compara las líneas amarillas con el papel y corrige
    for i in range(filas):
        tr = pg.locator('tbody tr').nth(i)
        if 'fila-aviso' not in (tr.get_attribute('class') or ''): continue
        fac = tr.locator('input').nth(0).input_value()
        v = verdad.get(fac) or verdad.get(fac[1:])
        if not v: continue
        tr.locator('input').nth(0).fill(v[0]); tr.locator('input').nth(0).dispatch_event('change')
        tr = pg.locator('tbody tr').nth(i)
        tr.locator('input').nth(2).fill(f'{v[2]:.2f}'); tr.locator('input').nth(2).dispatch_event('change')
        pg.wait_for_timeout(150)
    mal = [pg.locator('tbody tr').nth(i).locator('input').nth(0).input_value() for i in range(filas)
           if abs(float(pg.locator('tbody tr').nth(i).locator('input').nth(2).input_value() or 0) - verdad.get(pg.locator('tbody tr').nth(i).locator('input').nth(0).input_value(), [0,0,-1])[2]) > 0.001]
    ok(not mal, f'tras revisar, todas las líneas iguales al papel {mal}')
    ok('coincide con el total impreso' in pg.inner_text('body'), 'la suma coincide con el total impreso')
    pg.screenshot(path='shots/p1_poliza_lectura.png', full_page=True)
    pg.click('text=Guardar y comparar con SIGAM')
    t = toast(pg); ok('44 facturas' in t, t)
    pg.wait_for_selector('.modal', timeout=20000); pg.wait_for_timeout(800)
    cuerpo = pg.inner_text('.modal')
    ok('Monto distinto' in cuerpo and 'No ingresada' in cuerpo, 'muestra facturas con monto distinto y no ingresadas')
    r = sql("select resultado, count(*) from v_poliza_revision group by 1 order by 1")
    ok(r == 'coincide|1\nfecha_distinta|6\nmonto_distinto|1\nno_ingresada|36', 'cruce: ' + r.replace('\n', ', '))
    pg.screenshot(path='shots/p2_poliza_revision.png')
    pedidas = []
    ctx.on('request', lambda rq: pedidas.append(rq.url) if '/object/sign/' in rq.url and rq.method == 'GET' else None)
    pg.click('text=Ver documento'); pg.wait_for_timeout(2500)
    ok(any('token=prueba' in u for u in pedidas), 'abre el documento guardado')
    for pp in ctx.pages[1:]: pp.close()
    pg.select_option('.modal select >> nth=1', 'con_observaciones')
    pg.click('text=Guardar estado'); pg.fill('.modal textarea', 'Faltan 42 facturas por ingresar y una con monto distinto'); pg.click('.modal >> text=Aceptar')
    t = toast(pg); ok('Estado' in t, t)
    ok(sql("select estado from polizas") == 'con_observaciones', 'estado guardado')
    pg.wait_for_timeout(800); pg.screenshot(path='shots/p3_polizas_lista.png')

    print('2. Traslados efectivos en SIVET')
    pg.goto('http://localhost:8080/#traslados'); pg.wait_for_selector('text=Falta', timeout=30000) if False else pg.wait_for_selector('.tabla tbody tr', timeout=30000)
    pg.wait_for_timeout(1000)
    ok('aún no se han hecho efectivos en SIVET' in pg.inner_text('body'), 'aviso de traslados pendientes en SIVET')
    pg.locator('.tabla tbody tr input[type=checkbox]').nth(0).check(); pg.locator('.tabla tbody tr input[type=checkbox]').nth(1).check()
    pg.click('text=Marcar efectivos en SIVET'); pg.fill('.modal input', 'SIVET-TR-555'); pg.click('.modal >> text=Marcar efectivo')
    t = toast(pg); ok('2 traslado(s)' in t or 'traslado(s) marcados' in t, t)
    ok(sql("select count(*) from traslados where sivet_efectivo and sivet_referencia='SIVET-TR-555'") in ('1', '2'), 'marca guardada con referencia')
    pg.select_option('select >> nth=2', 'efectivo') if False else None
    pg.wait_for_timeout(1000); pg.screenshot(path='shots/p4_traslados_sivet.png')
    ok(not errs, f'sin errores JS {errs[:3]}')
    br.close()
