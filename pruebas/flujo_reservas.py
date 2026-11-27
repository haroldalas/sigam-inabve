# Reserva de 7 días hábiles: dependiente de la sede llama, pasa a Despacho; vencida → administración la pasa
import sys, subprocess; sys.path.insert(0, '.')
from smoke import *
def sql(s):
    r = subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True)
    return r.stdout.strip() or r.stderr.strip()
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def toast(pg, timeout=30000):
    pg.wait_for_selector('.toast', timeout=timeout); t = pg.inner_text('#toasts'); pg.evaluate("document.querySelector('#toasts').innerHTML=''"); return t
D1, D2 = '066600011', '066600022'
sql(f"delete from solicitud_eventos where solicitud_id in (select id from solicitudes where dui in ('{D1}','{D2}')); delete from solicitudes where dui in ('{D1}','{D2}'); delete from solicitud_responsables")
sql(f"insert into beneficiarios (dui,nombre,telefono,sede_id) values ('{D1}','ANA RESERVA PRUEBA','71110000',3),('{D2}','LUIS VENCIDO PRUEBA','72220000',3) on conflict do nothing")
sql("insert into lotes (producto_id,bodega_id,numero_lote,fecha_vencimiento,cantidad_inicial,disponible) values (750,20,'RES-UI','2028-01-01',5,5)")
for d, n in ((D1, 1), (D2, 2)):
    sql(f"insert into solicitudes (numero,tipo,dui,sede_id,area,estado,producto_id,cantidad,unidad,creado_por,creado_nombre,modalidad) values ('SOL-T-{n}','medicamento','{d}',3,'DSIN','aprobada',750,{n},'sobre','harold.alas@inabve.gob.sv','Harold','pendiente_entrega')")
lote = sql("select id from lotes where numero_lote='RES-UI' order by id desc limit 1")
sql(f"insert into movimientos (tipo,lote_id,producto_id,bodega_id,cantidad,documento) values ('traslado_recepcion',{lote},750,20,3,'traslado')")
antes = float(sql("select sum(disponible) from lotes where bodega_id=20"))
ok(sql(f"select string_agg(estado||'/'||bodega_reserva_id, ',') from solicitudes where dui in ('{D1}','{D2}')") == 'lista/20,lista/20', 'al llegar a Reservas Santa Ana quedan "lista"')

with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    print('1. Dependiente de Santa Ana llama y pasa a Despacho')
    ctx = contexto(br, 'dep'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#solicitudes?ver=seguimiento'); pg.wait_for_selector('.tarjeta-llamada', timeout=60000)
    ok('ANA RESERVA' in pg.inner_text('body'), 've a sus beneficiarios en "El producto ya llegó" sin ser responsable')
    card = pg.locator('.tarjeta-llamada', has_text='ANA RESERVA'); card.locator('button', has_text='✅ Contestó').click(); toast(pg)
    pg.wait_for_selector('.tarjeta-llamada .plazo')
    card = pg.locator('.tarjeta-llamada', has_text='ANA RESERVA')
    ok('quedan 7 día(s) hábil(es)' in card.inner_text(), 'muestra el plazo: ' + card.locator('.plazo').inner_text())
    pg.screenshot(path='shots/r1_esperando.png', full_page=True)
    card.locator('text=Llegó a retirar: pasar a Despacho').click(); pg.wait_for_selector('.modal >> text=SIVET')
    pg.click('.modal >> text=Pasar a Despacho >> nth=-1'); t = toast(pg); ok('pendiente de registrar en SIVET' in t, t)
    ok(sql(f"select s.estado||'|'||t.bodega_origen_id||'>'||t.bodega_destino_id||'|'||t.estado from solicitudes s join traslados t on t.id=s.traslado_id where dui='{D1}'") == 'en_despacho|20>10|recibido',
       'traslado Reservas → Despacho Santa Ana, ya recibido')
    ok(float(sql("select sum(disponible) from lotes where bodega_id=20")) == antes - 1, 'se descontó 1 de la reserva')
    ctx.close()

    print('2. Vence el plazo → administración la pasa a Despacho')
    sql(f"update solicitudes set estado='avisado', retiro_limite=current_date-1 where dui='{D2}'")
    ok(sql("select vencer_reservas()") == '1', 'la tarea diaria marca 1 vencida')
    ctx = contexto(br, 'admin'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#solicitudes?ver=seguimiento'); pg.wait_for_selector('.tarjeta-llamada.vencida', timeout=60000)
    pg.screenshot(path='shots/r2_vencidas.png', full_page=True)
    card = pg.locator('.tarjeta-llamada.vencida', has_text='LUIS VENCIDO'); card.locator('text=Pasar a Despacho').click()
    pg.click('.modal >> text=Pasar a Despacho >> nth=-1'); t = toast(pg); ok('SIVET' in t, t)
    ok(sql(f"select estado||'|'||(cerrada_at is not null) from solicitudes where dui='{D2}'") == 'no_retirado|true', 'queda "No retiró" y cerrada')
    pg.goto('http://localhost:8080/#solicitudes?ver=responsables'); pg.wait_for_selector('text=Feriados', timeout=30000)
    ok('Navidad' in pg.inner_text('body'), 'administración ve y edita feriados')
    ctx.close()
    ok(not errs, f'sin errores JS {errs[:3]}')
    br.close()
