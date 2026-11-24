# Prueba del despacho rápido (DUI primero) y de la conciliación con SIVET
import sys, subprocess; sys.path.insert(0, '.')
from smoke import *

def sql(s):
    return subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True).stdout.strip()
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def toast(pg, timeout=20000):
    pg.wait_for_selector('.toast', timeout=timeout); t = pg.inner_text('#toasts'); pg.evaluate("document.querySelector('#toasts').innerHTML=''"); return t

with sync_playwright() as p:
    br = p.chromium.launch()
    print('1. Despacho rápido con lector (dependiente)')
    ctx = contexto(br, 'dep'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#despacho'); pg.wait_for_selector('.dui-grande', timeout=30000); pg.wait_for_timeout(800)
    ok(pg.evaluate("document.activeElement.classList.contains('dui')"), 'al abrir, el cursor está en el DUI')
    pg.keyboard.type('11122233-3'); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.activeElement.classList.contains('campo-busqueda')"), 'al completar 9 dígitos salta solo al buscador/escáner')
    bod = pg.eval_on_selector('select.campo', 'e => e.value')
    cod = sql(f"select p.codigo from lotes l join productos p on p.id=l.producto_id where l.bodega_id={bod} and l.disponible>5 and l.estado='activo' and (l.fecha_vencimiento is null or l.fecha_vencimiento>current_date) and p.codigo ~ '^[0-9]+$' order by l.id limit 1")
    pg.keyboard.type(cod); pg.keyboard.press('Enter'); pg.wait_for_selector('.linea', timeout=10000); pg.wait_for_timeout(500)
    if pg.locator('.linea input.campo-num').count():
        ok(pg.evaluate("document.activeElement.classList.contains('campo-num')"), 'modo A: el cursor pasa a la cantidad')
        pg.keyboard.type('2'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
        ok(pg.evaluate("document.activeElement.classList.contains('campo-busqueda')"), 'Enter en cantidad vuelve al escáner')
    ok('DUI 111222333' in pg.inner_text('.resumen-despacho'), 'resumen: ' + pg.inner_text('.resumen-despacho'))
    pg.screenshot(path='shots/r1_despacho_rapido.png')
    pg.keyboard.press('Enter')   # Enter con el buscador vacío = registrar
    t = toast(pg); ok('registrado' in t, 'Enter vacío registra: ' + t)
    pg.wait_for_timeout(500)
    ok(pg.evaluate("document.activeElement.classList.contains('dui')") and pg.input_value('.dui') == '', 'queda listo para el siguiente paciente (DUI vacío y enfocado)')
    ok(sql("select count(*) from salidas where dui='111222333'") == '1', 'salida guardada')
    pg.keyboard.type('111222333'); pg.wait_for_timeout(1500)
    ok('HOY' in pg.inner_text('.info-dui'), 'avisa despacho previo hoy: ' + pg.inner_text('.info-dui'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    ok(pg.input_value('.dui') == '', 'Esc limpia')
    ok(not errs, f'sin errores JS {errs}')
    ctx.close()

    print('2. Conciliación con SIVET (administrador)')
    ctx = contexto(br, 'admin'); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#conciliacion'); pg.wait_for_selector('input[type=file]', timeout=30000)
    pg.set_input_files('input[type=file]', '/home/claude/pruebas_conc/Contrato_CEFAFA_-_MEDICAMENTOS_-_JUAN_PABLO_II-1_4.xlsx')
    pg.wait_for_selector('text=Ver vista previa', timeout=30000)
    sel = pg.locator('section.tarjeta select').first
    ok(sel.evaluate('e => e.options[e.selectedIndex].text') == 'CEFAFA - MEDICAMENTOS - JUAN PABLO II', 'contrato detectado por el nombre del archivo')
    antes = sql("select sum(disponible) from lotes where bodega_id=1")
    pg.click('text=Ver vista previa'); pg.wait_for_selector('text=Aplicar conciliación', timeout=60000); pg.wait_for_timeout(500)
    pg.screenshot(path='shots/r2_conciliacion_previa.png', full_page=True)
    ok('HUMBRAL' in pg.inner_text('body'), 'lista los productos no encontrados en el catálogo')
    pg.click('text=Aplicar conciliación'); pg.click('.modal button.btn-primario'); t = toast(pg, 60000)
    ok('aplicada' in t, t)
    ok(sql("select sum(disponible) from lotes where bodega_id=1") == antes, 'la Bodega Central no cambió')
    ok(sql("select count(*) from conciliaciones") >= '1', 'queda en el historial')
    pg.click('text=Historial'); pg.wait_for_timeout(800); pg.screenshot(path='shots/r3_historial.png')
    ok(not errs, f'sin errores JS {errs}')
    br.close()
