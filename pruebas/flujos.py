import sys, subprocess, re; sys.path.insert(0, '.')
from smoke import *
import openpyxl

def sql(s):
    return subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True).stdout.strip()

def pagina(br, quien, **kw):
    ctx = contexto(br, quien, **kw); pg = ctx.new_page()
    pg.errores = []
    pg.on('console', lambda m: pg.errores.append(m.text) if m.type == 'error' and 'GoTrue' not in m.text else None)
    pg.on('pageerror', lambda ex: pg.errores.append('PAGEERROR ' + str(ex)))
    return ctx, pg

def ir(pg, ruta):
    pg.goto(f'http://localhost:8080/#{ruta}'); pg.wait_for_selector('.titulo-pagina', timeout=30000); pg.wait_for_timeout(600)

def toast(pg, timeout=15000):
    pg.wait_for_selector('.toast', timeout=timeout); t = pg.inner_text('#toasts'); pg.evaluate("document.querySelector('#toasts').innerHTML=''"); return t

def elegir_producto(pg, texto, nth=0):
    caja = pg.locator('.campo-busqueda').nth(nth); caja.fill(texto); pg.wait_for_selector('.sugerencia', timeout=10000); pg.locator('.sugerencia').first.click(); pg.wait_for_timeout(700)

ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)

with sync_playwright() as p:
    br = p.chromium.launch()
    # ---------------------------------------------------------------- 1. despacho (dependiente Santa Ana)
    print('1. Despacho con DUI (dependiente Santa Ana)')
    ctx, pg = pagina(br, 'dep'); ir(pg, 'despacho')
    pg.fill('.dui', '01234567-8'); ok(pg.input_value('.dui') == '012345678', 'el DUI se limpia a 9 dígitos sin guion')
    elegir_producto(pg, 'PULL -UP TALLA G')
    pg.wait_for_selector('.linea input.campo-num'); pg.fill('.linea input.campo-num', '3'); pg.wait_for_timeout(300)
    pg.click('text=Registrar despacho'); t = toast(pg); ok('registrado' in t, f'toast: {t}')
    ok(sql("select count(*) from salidas where dui='012345678'") == '1', 'salida guardada con DUI 012345678')
    pg.screenshot(path='shots/f1_despacho.png')
    # modo B: cada escaneo suma 1 (lector USB = escribir código + Enter)
    pg.click('text=B · Cada escaneo suma 1'); pg.fill('.dui', '987654321')
    cod = sql("select codigo from productos where id=1271")
    for _ in range(3): pg.fill('.campo-busqueda', cod); pg.press('.campo-busqueda', 'Enter'); pg.wait_for_timeout(250)
    cant = pg.inner_text('.linea strong[style]'); ok(cant.strip() == '3', f'modo B: 3 lecturas = cantidad {cant}')
    pg.click('text=Registrar despacho'); t = toast(pg); ok('registrado' in t, f'toast: {t}')
    # error de negocio: cantidad mayor a la existencia
    pg.click('text=A · Escanear y escribir cantidad'); pg.fill('.dui', '111111111'); elegir_producto(pg, 'PULL -UP TALLA G')
    pg.fill('.linea input.campo-num', '999999'); pg.click('text=Registrar despacho'); t = toast(pg); ok('supera' in t, f'bloquea cantidad mayor: {t}')
    pg.click('text=Limpiar')
    # ---------------------------------------------------------------- 2. sin conexión
    print('2. Despacho sin conexión y envío automático')
    ctx.set_offline(True); pg.wait_for_timeout(500)
    ok(pg.evaluate("document.body.classList.contains('sin-red')"), 'aviso de "sin conexión" visible')
    pg.fill('.dui', '222222222'); elegir_producto(pg, 'PULL UP TALLA M'); pg.fill('.linea input.campo-num', '2')
    pg.click('text=Registrar despacho'); t = toast(pg); ok('guardado en este equipo' in t, f'toast: {t}')
    ok(sql("select count(*) from salidas where dui='222222222'") == '0', 'todavía no llega al servidor')
    pg.screenshot(path='shots/f2_sin_conexion.png')
    ctx.set_offline(False); pg.wait_for_timeout(4000)
    ok(sql("select count(*) from salidas where dui='222222222'") == '1', 'al volver la red se envió solo (una sola vez)')
    ok(not pg.errores, f'sin errores de consola {pg.errores[:3]}'); ctx.close()

    # ---------------------------------------------------------------- 3. traslado (admin) + PDF + Excel
    print('3. Traslado central → Despacho Santa Ana (administrador)')
    ctx, pg = pagina(br, 'admin'); ir(pg, 'traslados'); pg.click('text=Nuevo traslado'); pg.wait_for_timeout(800)
    sels = pg.locator('.tarjeta select.campo')
    sels.nth(0).select_option('1'); pg.wait_for_timeout(300); pg.locator('.tarjeta select.campo').nth(1).select_option('10'); pg.wait_for_timeout(300)
    for nombre, cant in [('ALUTRIN ARSAL', '5'), ('AERO-OM 40', '4')]:
        elegir_producto(pg, nombre); pg.wait_for_selector('text=Disponible en origen', timeout=10000)
        pg.locator('.linea input.campo-num').first.fill(cant)
    pg.screenshot(path='shots/f3_traslado.png')
    pg.click('text=Enviar traslado'); pg.click('.modal-pie >> text=Enviar'); t = toast(pg); ok('enviado' in t, f'toast: {t}')
    num = re.search(r'T-\d{4}-\d+', t).group(0)
    with pg.expect_download(timeout=30000) as d: pg.click('.modal-pie >> text=PDF')
    d.value.save_as(f'shots/{num}.pdf'); ok(d.value.suggested_filename.endswith('.pdf'), f'PDF generado: {d.value.suggested_filename}')
    with pg.expect_download(timeout=30000) as d: pg.click('.modal-pie >> text=Excel para TICS')
    d.value.save_as(f'shots/{num}.xlsx'); ws = openpyxl.load_workbook(f'shots/{num}.xlsx').active
    ok([c.value for c in ws[1]][:8] == ['Correlativo','Codigo','Cantidad','Precio','Total','Factura','Fecha de factura','NombreContrato_SIVETWEB'], 'Excel con las 8 columnas de la hoja MIGRAR')
    ok(ws.max_row == 3 and 'SANTA ANA' in str(ws['H2'].value), f'2 líneas, contrato {ws["H2"].value}')
    pg.click('.modal-pie >> text=Listo'); pg.wait_for_timeout(1500); pg.screenshot(path='shots/f3_bitacora.png')
    ok(not pg.errores, f'sin errores de consola (CSP incluido) {pg.errores[:3]}'); ctx.close()

    # ---------------------------------------------------------------- 4. recepción con diferencia (dependiente)
    print('4. Recepción en Santa Ana con una diferencia')
    ctx, pg = pagina(br, 'dep'); ir(pg, 'recepcion'); pg.click(f'text={num}'); pg.wait_for_selector('text=Confirmar recepción')
    lineas = pg.locator('.linea'); n = lineas.count()
    lineas.nth(0).locator('button[title="Recibí lo enviado"]').click()
    pg.locator('.linea').nth(1).locator('input.campo-num').fill('2'); pg.locator('.linea').nth(1).locator('input.campo').first.fill('Caja abierta, faltan 2')
    # producto extra escaneado
    cod = sql("select codigo from productos where id=1272"); pg.fill('.campo-busqueda', cod); pg.press('.campo-busqueda', 'Enter'); pg.wait_for_timeout(500); toast(pg)
    pg.screenshot(path='shots/f4_recepcion.png')
    pg.click('text=Confirmar recepción'); pg.click('.modal-pie >> text=Confirmar recepción'); t = toast(pg); ok('diferencia' in t, f'toast: {t}')
    ok(sql(f"select estado from traslados where numero='{num}'") == 'con_diferencias', 'traslado queda "con diferencias"')
    ok(sql(f"select count(*) from traslado_diferencias df join traslados t on t.id=df.traslado_id where t.numero='{num}'") == '2', '2 diferencias en la bandeja (faltante + producto no enviado)')
    ctx.close()

    # ---------------------------------------------------------------- 5. bandeja del administrador
    print('5. Bandeja: resolver diferencias')
    ctx, pg = pagina(br, 'admin'); ir(pg, 'pendientes'); pg.screenshot(path='shots/f5_bandeja.png')
    pg.locator('tr.clicable', has_text=num).filter(has_text='Llegó de menos').click(); pg.wait_for_selector('.modal')
    pg.click('.modal-pie >> text=Resolver'); t = toast(pg); ok('resuelta' in t, f'faltante devuelto al origen: {t}')
    pg.wait_for_timeout(800); pg.locator('tr.clicable', has_text=num).first.click(); pg.wait_for_selector('.modal')
    pg.select_option('.modal select.campo', 'rechazar'); pg.click('.modal-pie >> text=Resolver'); t = toast(pg); ok('resuelta' in t, f'producto no enviado rechazado: {t}')
    ok(sql(f"select estado from traslados where numero='{num}'") == 'cerrado', 'traslado cerrado al resolver todo')
    ctx.close()

    # ---------------------------------------------------------------- 6. devolución + validación
    print('6. Devolución registrada por la sede y validada por el administrador')
    fac = sql("select f.numero_sivet from lotes l join factura_detalle d on d.id=l.factura_detalle_id join facturas f on f.id=d.factura_id where l.bodega_id=10 and l.producto_id=1271 limit 1")
    ctx, pg = pagina(br, 'dep'); ir(pg, 'devoluciones'); elegir_producto(pg, 'PULL -UP TALLA G')
    campos = pg.locator('.tarjeta').first.locator('input.campo')
    pg.fill('input[placeholder="Número de factura del producto"]', fac); pg.fill('input[placeholder="9 dígitos, sin guion"]', '012345678')
    pg.fill('input[type=date]', '2026-11-24'); pg.locator('input[type=number]').first.fill('1'); pg.fill('input[placeholder^="Ej.: cambio"]', 'Cambio de talla')
    pg.click('text=Registrar devolución'); t = toast(pg); ok('pendiente de validación' in t, f'toast: {t}'); ctx.close()
    ctx, pg = pagina(br, 'admin'); ir(pg, 'pendientes'); pg.locator('tr.clicable', has_text='Cambio de talla').click(); pg.wait_for_selector('.modal')
    pg.click('.modal-pie >> text=Guardar decisión'); t = toast(pg); ok('validada' in t, f'toast: {t}')
    ok(sql("select estado from devoluciones order by id desc limit 1") == 'reingresada', 'devolución reingresada al mismo lote')
    ctx.close()

    # ---------------------------------------------------------------- 7. conteo físico
    print('7. Conteo físico: sede cuenta, administrador aprueba')
    ctx, pg = pagina(br, 'dep'); ir(pg, 'conteo'); pg.select_option('.tarjeta select.campo', '10'); pg.click('text=Iniciar conteo'); t = toast(pg); ok('iniciado' in t, t)
    pg.wait_for_selector('text=Finalizar y enviar a aprobación'); elegir_producto(pg, 'PULL UP TALLA M'); pg.wait_for_selector('.modal')
    pg.locator('.modal input.campo-num').first.fill('100'); pg.click('.modal-pie >> text=Guardar'); toast(pg)
    pg.click('text=Finalizar y enviar a aprobación'); pg.click('.modal-pie >> text=Finalizar'); t = toast(pg); ok('aprobación' in t, t); ctx.close()
    ctx, pg = pagina(br, 'admin'); ir(pg, 'conteo'); pg.locator('tr.clicable', has_text='Por aprobar').first.click(); pg.wait_for_selector('text=Aprobar')
    pg.click('button:has-text("Aprobar")'); pg.click('.modal-pie >> text=Aprobar y ajustar'); t = toast(pg); ok('ajuste' in t, t); ctx.close()

    # ---------------------------------------------------------------- 8. bloqueo de lote
    print('8. Bloqueo de lote en todas las sedes')
    ctx, pg = pagina(br, 'admin'); ir(pg, 'lotes'); elegir_producto(pg, 'AERO-OM 40'); pg.wait_for_selector('tr.clicable')
    pg.locator('tr.clicable').first.click(); pg.fill('.modal textarea', 'Alerta sanitaria de prueba'); pg.click('.modal-pie >> text=Aplicar'); t = toast(pg); ok('actualizados' in t, t)
    ctx.close()

    # ---------------------------------------------------------------- 9. carga semanal y liquidación
    print('9. Carga semanal del Excel de despachos y liquidación')
    wb = openpyxl.Workbook(); ws = wb.active; ws.append(['Fecha', 'Sede', 'Código', 'Cantidad', 'Factura'])
    for r in sql("select p.codigo||'|'||d.cantidad||'|'||f.numero_sivet from factura_detalle d join facturas f on f.id=d.factura_id join productos p on p.id=d.producto_id where f.proveedor_id=1 and p.codigo is not null order by f.id desc limit 3").splitlines():
        c, q, fnum = r.split('|'); ws.append(['20/11/2026', 'Santa Ana', c, float(q), fnum])
    wb.save('shots/despachos_semana.xlsx')
    ctx, pg = pagina(br, 'admin'); ir(pg, 'liquidacion'); pg.click('text=Cargar Excel semanal'); pg.set_input_files('input[type=file]', 'shots/despachos_semana.xlsx')
    pg.wait_for_selector('text=Vista previa'); pg.screenshot(path='shots/f9_carga.png'); pg.click('text=Guardar carga'); t = toast(pg); ok('Carga guardada: 3 filas' in t, t)
    pg.wait_for_timeout(2500); pg.click('label.check:has-text("Solo listas")'); pg.wait_for_timeout(2500); pg.screenshot(path='shots/f9_liquidacion.png')
    ok(pg.locator('tr.fila-ok').count() >= 1, f'{pg.locator("tr.fila-ok").count()} factura(s) al 100 % lista(s) para liquidar')
    ok(not pg.errores, f'sin errores de consola {pg.errores[:3]}'); ctx.close()

    # ---------------------------------------------------------------- 10. celular
    print('10. Vista en celular')
    ctx, pg = pagina(br, 'dep', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True) if False else (None, None)
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    sub, email = USERS['dep']; ctx.add_init_script(f"localStorage.setItem('sb-localhost-auth-token', {json.dumps(sesion(sub, email))});")
    pg = ctx.new_page(); pg.goto('http://localhost:8080/#despacho'); pg.wait_for_selector('.titulo-pagina'); pg.wait_for_timeout(800); pg.screenshot(path='shots/f10_movil.png')
    pg.click('.btn-menu'); pg.wait_for_timeout(400); pg.screenshot(path='shots/f10_movil_menu.png'); ctx.close()
    br.close()
