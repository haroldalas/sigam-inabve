# Prueba: crear cuenta con correo + contraseña, suplantación, contraseña temporal y cambio obligatorio
import sys, subprocess; sys.path.insert(0, '.')
from smoke import *

def sql(s):
    return subprocess.run(['su', 'postgres', '-c', f'psql -d sigam -At -c "{s}"'], capture_output=True, text=True).stdout.strip()
ok = lambda c, m: print(('  ✔ ' if c else '  ✘ ') + m)
def toast(pg, timeout=60000):
    pg.wait_for_selector('.toast', timeout=timeout); t = pg.inner_text('#toasts'); pg.evaluate("document.querySelector('#toasts').innerHTML=''"); return t

PRUEBA = 'cuenta.prueba@inabve.gob.sv'
sql(f"delete from auth.users where email in ('{PRUEBA}', 'hacker@gmail.com'); delete from perfiles where email='{PRUEBA}'")
# un administrador precargado que aún no ha creado su cuenta (para probar la suplantación)
sql("insert into perfiles (email, nombre, rol, activo, estado_solicitud) values ('jefe.prueba@inabve.gob.sv','Jefe de Prueba','administrador',true,'aprobada') on conflict (email) do update set id=null, rol='administrador', activo=true, estado_solicitud='aprobada'")
sql("delete from auth.users where email='jefe.prueba@inabve.gob.sv'")

with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    def crear(pg, nombre, usuario, clave):
        pg.goto('http://localhost:8080/'); pg.click('text=Iniciar sesión con cuenta institucional')
        pg.click('text=¿Primera vez? Crear mi cuenta')
        pg.fill('input[placeholder="Nombre completo"]', nombre); pg.fill('input[name=usuario]', usuario)
        pg.fill('input[placeholder^="Contraseña (mínimo"]', clave); pg.fill('input[placeholder="Repita la contraseña"]', clave)
        pg.click('button:has-text("Crear cuenta")')

    print('1. Crear cuenta nueva')
    ctx = contexto(br, None); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/'); pg.wait_for_selector('.btn-ms', timeout=30000)
    pg.screenshot(path='shots/c0_inicio.png')
    crear(pg, 'Ana', 'x', 'abc'); pg.wait_for_selector('.aviso-error:not(.oculto)')
    ok('nombre completo' in pg.inner_text('.aviso-error'), 'valida nombre completo')
    pg.fill('input[placeholder="Nombre completo"]', 'Cuenta de Prueba Uno'); pg.fill('input[name=usuario]', 'cuenta.prueba@gmail.com')
    pg.fill('input[placeholder^="Contraseña (mínimo"]', 'Clave-1234'); pg.fill('input[placeholder="Repita la contraseña"]', 'Clave-9999')
    pg.click('button:has-text("Crear cuenta")'); pg.wait_for_timeout(300)
    ok('no coinciden' in pg.inner_text('.aviso-error'), 'valida que las contraseñas coincidan')
    pg.screenshot(path='shots/c1_crear.png')
    pg.fill('input[placeholder="Repita la contraseña"]', 'Clave-1234'); pg.click('button:has-text("Crear cuenta")')
    pg.wait_for_selector('text=Enviar solicitud', timeout=30000)
    ok(sql(f"select activo||'|'||rol from perfiles where email='{PRUEBA}'") == 'false|consulta', 'el dominio se fuerza a @inabve.gob.sv y entra sin acceso, a la solicitud')
    ok(sql(f"select nombre from perfiles where email='{PRUEBA}'") == 'Cuenta de Prueba Uno', 'guarda su nombre')
    ctx.close()

    print('2. No se puede registrar otro dominio (directo a la base)')
    r = subprocess.run(['su', 'postgres', '-c', "psql -d sigam -At -c \"insert into auth.users(email, raw_app_meta_data) values ('hacker@gmail.com','{\\\"provider\\\":\\\"email\\\"}')\""], capture_output=True, text=True)
    ok('inabve.gob.sv' in r.stderr, 'la base rechaza correos de otro dominio')

    print('3. Entrar con contraseña')
    ctx = contexto(br, None); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/'); pg.click('text=Iniciar sesión con cuenta institucional')
    pg.fill('input[name=usuario]', 'cuenta.prueba'); pg.fill('input[placeholder=Contraseña]', 'mala-clave'); pg.click('button:has-text("Entrar")')
    pg.wait_for_selector('.aviso-error:not(.oculto)'); ok('incorrectos' in pg.inner_text('.aviso-error'), 'contraseña mala: "Correo o contraseña incorrectos"')
    pg.screenshot(path='shots/c2_entrar.png')
    pg.fill('input[placeholder=Contraseña]', 'Clave-1234'); pg.keyboard.press('Enter')
    pg.wait_for_selector('text=Enviar solicitud', timeout=30000); ok(True, 'entra y ve su solicitud')
    ctx.close()

    print('4. Suplantación: alguien crea la cuenta de un administrador precargado')
    ctx = contexto(br, None); pg = ctx.new_page()
    crear(pg, 'Impostor Cualquiera', 'jefe.prueba', 'Impostor-123')
    pg.wait_for_selector('text=Enviar solicitud', timeout=30000)
    ok(sql("select activo||'|'||rol||'|'||rol_sugerido||'|'||estado_solicitud from perfiles where email='jefe.prueba@inabve.gob.sv'") == 'false|consulta|administrador|sin_enviar',
       'no hereda el rol de administrador: queda sin acceso y el rol solo como sugerencia')
    ctx.close()

    print('5. El administrador elimina la cuenta suplantada y asigna contraseña temporal')
    ctx = contexto(br, 'admin'); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/#admin'); pg.wait_for_selector('input[type=search]', timeout=30000)
    pg.fill('input[type=search]', 'jefe.prueba'); pg.wait_for_timeout(400)
    pg.click('td:has-text("jefe.prueba@inabve.gob.sv")'); pg.wait_for_selector('.modal')
    pg.screenshot(path='shots/c3_usuario.png')
    pg.click('.modal >> text=Eliminar cuenta'); pg.fill('.modal >> nth=1 >> textarea', 'La creó otra persona')
    pg.click('.modal >> nth=1 >> button:has-text("Eliminar cuenta")'); t = toast(pg); ok('eliminada' in t, t)
    ok(sql("select coalesce(id::text,'sin cuenta') from perfiles where email='jefe.prueba@inabve.gob.sv'") == 'sin cuenta'
       and sql("select count(*) from auth.users where email='jefe.prueba@inabve.gob.sv'") == '0', 'la cuenta se borró y el perfil se conserva')
    pg.fill('input[type=search]', 'cuenta.prueba'); pg.wait_for_timeout(400)
    pg.click('td:has-text("cuenta.prueba@inabve.gob.sv")'); pg.wait_for_selector('.modal')
    pg.click('.modal >> text=Contraseña temporal'); pg.wait_for_selector('.modal >> nth=1')
    pg.fill('.modal >> nth=1 >> input', 'Temporal-55'); pg.screenshot(path='shots/c4_temporal.png')
    pg.click('.modal >> nth=1 >> button:has-text("Asignar")'); t = toast(pg); ok('temporal' in t, t)
    ok(sql(f"select debe_cambiar_clave from perfiles where email='{PRUEBA}'") == 't', 'queda marcada para cambiar la contraseña')
    ctx.close()

    print('6. Entra con la temporal y debe cambiarla')
    ctx = contexto(br, None); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8080/'); pg.click('text=Iniciar sesión con cuenta institucional')
    pg.fill('input[name=usuario]', 'cuenta.prueba'); pg.fill('input[placeholder=Contraseña]', 'Temporal-55'); pg.click('button:has-text("Entrar")')
    pg.wait_for_selector('text=Cree una contraseña nueva', timeout=30000); pg.screenshot(path='shots/c5_cambio.png')
    pg.fill('input[placeholder^="Nueva contraseña"]', 'Definitiva-77'); pg.fill('input[placeholder^="Repita"]', 'Definitiva-77')
    pg.click('button:has-text("Guardar contraseña")'); pg.wait_for_selector('text=Enviar solicitud', timeout=30000)
    ok(sql(f"select debe_cambiar_clave from perfiles where email='{PRUEBA}'") == 'f', 'contraseña cambiada; sigue a su solicitud')
    ok(sql(f"select encrypted_password = extensions.crypt('Definitiva-77', encrypted_password) from auth.users where email='{PRUEBA}'") == 't', 'la nueva contraseña funciona')
    ctx.close()
    ok(not errs, f'sin errores JS {errs[:3]}')
    br.close()
sql("delete from auth.users where email='jefe.prueba@inabve.gob.sv'; delete from perfiles where email='jefe.prueba@inabve.gob.sv'")
