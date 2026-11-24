# SIGAM-INABVE
**Sistema Integrado de Gestión de Abastecimiento Médico** · Departamento de Programas de Salud Integral, INABVE
Sucesor de SIFAR-INABVE ERP 3.1 (Excel/VBA). Base de datos en Supabase (Postgres) y aplicación web en Netlify, publicada desde GitHub.

## Estructura
```
supabase/migrations/   01 esquema · 02 seguridad (roles, RLS, dominio) · 03 operaciones (RPC) · 04 vistas y reportes
scripts/migrar_sifar.py   genera seed/*.sql desde el .xlsm de SIFAR y la lista AWaRe de la OMS
scripts/reportes.py       Excel para TICS (hoja MIGRAR) y PDF de traslado
seed/                     datos iniciales + informe_migracion.md + control_existencias.csv
local/                    solo pruebas locales (simulación de auth y casos de prueba)
```

## Roles
| Rol | Puede |
|---|---|
| **Administrador** | Todo, incluida la bodega Descarte; entradas; valida devoluciones; resuelve diferencias de traslado; liquidación |
| **Dependiente** | Opera las bodegas de **su sede** (despacho de medicamentos, almacén de insumos, pequeña cirugía, campo) eligiéndolas desde la misma pantalla; salidas, traslados, recepción, ajustes, registro de devoluciones |
| **Consulta** | Ver existencias y dónde están, en todas las sedes (médicos, Contact Center), y notificaciones |

Acceso solo con cuenta Microsoft institucional `@inabve.gob.sv`. Un usuario nuevo queda inactivo hasta que un administrador lo habilita.

## Operaciones (funciones RPC)
| Función | Regla clave |
|---|---|
| `registrar_entrada` | Solo bodega central. Medicamento o CEFAFA: todo obligatorio (factura, fecha, lote, vencimiento). Otro proveedor con insumo: solo el precio unitario |
| `registrar_salida` | PVPS automático en varios lotes; excluye vencidos. Beneficiario: DUI. Personal (pequeña cirugía): persona que recibe y quien solicita |
| `crear_traslado` / `recibir_traslado` | Lo enviado queda en tránsito. La sede indica lo recibido por línea; lo que coincide entra, las diferencias (faltante, sobrante, producto no enviado) van a la bandeja del administrador |
| `resolver_diferencia` | Devolver al origen, acreditar al destino, pérdida o rechazar |
| `registrar_ajuste` | Administrador y dependiente de la sede, con motivo obligatorio |
| `registrar_devolucion` / `validar_devolucion` | Dependiente registra (factura, DUI, fecha de receta); administrador decide reingresar, avería (a Descarte) o rechazar |
| `marcar_liquidacion` | Pendiente → En proceso → Liquidada |

## Estado del despliegue
- **Supabase** (organización INABVE, proyecto `SIGAM-INABVE`, `jlskootxwfadjmnqradb`): las 8 migraciones ya están aplicadas.
- **Datos iniciales:** `carga_supabase/parte_01…07.sql` se pegan en orden en *SQL Editor* y se verifican con `parte_99_verificacion.sql`.
- **Aplicación web:** carpeta `web/` (Vite). Netlify la construye con `netlify.toml`.

## Inicio de sesión con Microsoft (una sola vez)
1. **Microsoft Entra ID** (portal.azure.com, TIC o quien tenga permiso en el tenant de INABVE) → *App registrations* → *New registration*
   - Nombre: `SIGAM-INABVE` · Cuentas: *solo este directorio organizativo*
   - Redirect URI (Web): `https://jlskootxwfadjmnqradb.supabase.co/auth/v1/callback`
   - *Certificates & secrets* → nuevo *client secret* (copiar el **Value**)
   - Anotar *Application (client) ID* y *Directory (tenant) ID*
2. **Supabase** → Authentication → Sign In / Providers → **Azure**: activar, pegar Client ID y Secret, y en *Azure Tenant URL* poner
   `https://login.microsoftonline.com/<tenant-id>`. Desactivar *Email* (registro con correo y contraseña).
3. **Supabase** → Authentication → URL Configuration: *Site URL* = la dirección de Netlify (p. ej. `https://sigam-inabve.netlify.app`) y agregarla en *Redirect URLs*.
4. La base rechaza cualquier cuenta que no sea `@inabve.gob.sv`. Los 49 usuarios de SIFAR ya están precargados con su rol; quien no esté queda pendiente hasta que un administrador lo habilite.

## Publicación en Netlify
- **Con GitHub:** subir este repositorio, y en Netlify *Add new site → Import from Git*; `netlify.toml` ya trae la configuración.
- **Sin GitHub (rápido):** en Netlify *Add new site → Deploy manually* y arrastrar la carpeta `web/dist`.

## Pruebas locales
`local/reconstruir.sh` crea la base de pruebas; `pruebas/servidor.mjs` imita Supabase sobre ella y `pruebas/flujos.py` recorre los flujos (despacho, sin conexión, traslado, recepción con diferencias, bandeja, devolución, conteo, bloqueo, carga semanal) con Playwright.

## Regenerar datos desde SIFAR
```
python3 scripts/migrar_sifar.py SIFAR.xlsm WHO-AWaRe-2023.xlsx seed/
```
