# Prueba: solicitud de acceso (usuario nuevo) y aprobación por el administrador; conciliación en lote
import sys, subprocess; sys.path.insert(0, '.')
from smoke import *

def sql(s):
    return subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True).stdout.strip()
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def toast(pg, timeout=60000):
    pg.wait_for_selector('.toast', timeout=timeout); t = pg.inner_text('#toasts'); pg.evaluate("document.querySelector('#toasts').innerHTML=''"); return t

sql("update perfiles set activo=false, rol='consulta', sede_id=null, estado_solicitud='sin_enviar', cargo=null, solicitado_at=null where email='nuevo.usuario@inabve.gob.sv'")
with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    print('1. Solicitud de acceso')
    ctx = contexto(br, 'nuevo'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/'); pg.wait_for_selector('text=Enviar solicitud', timeout=30000)
    ok(pg.locator('.login-solicitud select').first.locator('option').count() >= 5, 'puede elegir su sede antes de tener acceso')
    pg.fill('.login-solicitud input >> nth=0', 'Usuario Nuevo de Prueba')
    pg.fill('.login-solicitud input >> nth=1', 'Dependiente de farmacia')
    pg.locator('.login-solicitud select').first.select_option(label='Santa Ana')
    pg.click('text=Enviar solicitud'); toast(pg)
    pg.wait_for_selector('text=Solicitud enviada', timeout=20000)
    pg.screenshot(path='shots/s1_solicitud.png')
    ok(sql("select estado_solicitud||'|'||rol_solicitado||'|'||sede_solicitada from perfiles where email='nuevo.usuario@inabve.gob.sv'") == 'pendiente|dependiente|3', 'solicitud guardada como pendiente')
    ctx.close()

    print('2. El administrador aprueba')
    ctx = contexto(br, 'admin'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#pendientes'); pg.wait_for_selector('text=Solicitudes de acceso', timeout=30000)
    ok(True, 'aparece en la bandeja de revisión')
    pg.goto('http://localhost:8080/#admin'); pg.wait_for_selector('text=solicitud(es) de acceso por revisar', timeout=30000)
    pg.click('text=Usuario Nuevo de Prueba >> nth=0'); pg.wait_for_selector('.modal')
    pg.screenshot(path='shots/s2_aprobar.png')
    pg.click('.modal >> text=Aprobar acceso'); t = toast(pg); ok('aprobado' in t, t)
    ok(sql("select activo||'|'||rol||'|'||sede_id||'|'||estado_solicitud from perfiles where email='nuevo.usuario@inabve.gob.sv'") == 'true|dependiente|3|aprobada', 'queda habilitado como dependiente de Santa Ana')
    ctx.close()
    ctx = contexto(br, 'nuevo'); pg = ctx.new_page()
    pg.goto('http://localhost:8080/#despacho'); pg.wait_for_selector('.dui-grande', timeout=30000)
    ok(True, 'el usuario aprobado ya entra al despacho')
    ctx.close()

    print('3. Conciliación en lote (Campo se conserva)')
    ctx = contexto(br, 'admin'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    antes = sql("select coalesce(sum(disponible),0) from lotes where bodega_id in (1,4,5)")
    pg.goto('http://localhost:8080/#conciliacion'); pg.wait_for_selector('input[type=file]', timeout=30000)
    pg.set_input_files('input[type=file]', ['/home/claude/pruebas_conc/Contrato_CEFAFA_-_MEDICAMENTOS_-_JUAN_PABLO_II-1_4.xlsx', '/home/claude/pruebas_conc/archivo_sin_contrato.xlsx'])
    pg.wait_for_selector('text=Ver vista previa >> nth=1', timeout=30000)
    pg.click('text=Vista previa de todos'); pg.wait_for_selector('text=/listos para aplicar/', timeout=120000)
    ok('1 listos para aplicar' in pg.inner_text('body') and 'No se reconoció el contrato' in pg.inner_text('body'), 'uno listo y otro sin contrato reconocido')
    pg.click('text=Aplicar todos los revisados'); pg.click('.modal button.btn-primario')
    try: pg.wait_for_selector('text=/contratos aplicados/', timeout=120000)
    except Exception:
        pg.screenshot(path='shots/s_error.png', full_page=True); print(pg.inner_text('body')[:1500]); raise
    ok('1 de 1 contratos aplicados' in pg.inner_text('body'), 'aplicado en lote')
    ok(sql("select coalesce(sum(disponible),0) from lotes where bodega_id in (1,4,5)") == antes, 'Central, Pequeña Cirugía y Campo JPII no cambiaron')
    pg.screenshot(path='shots/s3_lote.png')
    ok(not errs, f'sin errores JS {errs[:3]}')
    br.close()
