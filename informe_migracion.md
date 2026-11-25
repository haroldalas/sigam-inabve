# Informe de migración SIFAR → SIGAM-INABVE

- Se crearon 18 bodegas: bodega central en Juan Pablo II; en cada sede Despacho de Medicamentos, Almacén de Insumos Médicos, Pequeña Cirugía y Campo; una bodega de Descarte visible solo para administradores.
- Producto ID 1023 (DOLOCRIM FORTE) estaba duplicado en SIFAR; se dejó un solo registro.
- 1301 productos migrados (144 insumos médicos, 1157 medicamentos). 415 sin código: se conservan así.
- 55 códigos internos están guardados con apóstrofo (p. ej. 35'82913'02688'1) en lugar de guion. No se modificaron; confirmar cómo están en SIVET.
- Cadena de frío marcada en: LANTUS SOLOSTAR 100 UI/ML, HUMULIN N.
- AWaRe asignada a 40 productos que coinciden con la lista OMS 2023; 12 antibióticos quedan sin clasificar para que los defina (tópicos, combinaciones o fuera de lista).
- Proveedores unificados: «Cefafa» y «CEFAFA» en uno solo; los dos «EQUIMED» en uno; «ASOCIACION DE CIEGOS» = ASCES; «CARLOS CIENFUEGOS» = CIENFUEGOS; el proveedor que tenía un código de barras como nombre (1 factura DTE) se asignó a CEFAFA.
- 2088 facturas migradas. Por bodega de registro en SIFAR: {'central': 1635, 'despacho_medicamentos': 419, 'almacen_insumos': 26, 'pequena_cirugia': 8}. En adelante solo la bodega central registra entradas.
- 9584 salidas y 16358 líneas migradas (las salidas en borrador no se migran). Las salidas de SIFAR solo tienen expediente; desde ahora se registra el DUI.
- 251 traslados migrados; 7 siguen en tránsito y podrán recibirse en SIGAM. 19 diferencias de SIFAR quedan pendientes en la bandeja del administrador.
- 50 usuarios precargados (correo = usuario de red @inabve.gob.sv): 2 administradores habilitados; el resto queda sin acceso hasta que envíe su solicitud (rol sugerido según SIFAR: 16 dependientes, 32 de consulta). Omitidos por usuario incompleto: ['oscar'].

## AWaRe asignada

| ID | Producto | Principio activo | Clasificación |
|---|---|---|---|
| 46 | AMOXICILINA / A. CLAVULAMICO CALOX 875/125 MG | AMOXICILINA + ACIDO CLAVULAMICO | acceso |
| 47 | AMOXICILINA FD 500 MG | AMOXICILINA | acceso |
| 48 | AMOXICILINA MK 500 MG | AMOXICILINA | acceso |
| 81 | AZITROMICINA CALOX 500 MG | AZITROMICINA | precaucion |
| 82 | AZITROMICINA EC 500 MG | AZITROMICINA | precaucion |
| 108 | BIO-MIKIN 500 MG | AMIKACINA | acceso |
| 131 | CAMYDA 300 MG | CLINDAMICINA | acceso |
| 146 | CEFADROXILO MK 500 MG | CEFADROXILO | acceso |
| 147 | CEFIBAC FD 400 MG | CEFIXIMA | precaucion |
| 164 | CIPRODEL 500 MG | CIPROFLOXACINO | precaucion |
| 165 | CIPROFLOXACINA CALOX 500 MG | CIPROFLOXACINO | precaucion |
| 175 | CLAMOXIDEL 875/125 MG | AMOXICILINA + ACIDO CLAVULAMICO | acceso |
| 176 | CLARITROMICINA MK 500 MG | CLARITROMICINA | precaucion |
| 177 | CLAVIMOX BID 875/125 MG | AMOXICILINA + ACIDO CLAVULAMICO | acceso |
| 178 | CLAVULIN C/12 875/125 MG | AMOXICILINA + ACIDO CLAVULAMICO | acceso |
| 179 | CLINDARIS 300 MG | CLINDAMICINA | acceso |
| 291 | DOXICLIN 100 MG | DOXICICLINA | acceso |
| 371 | FARTRIAXONA 1 GR | CEFTRIAXONA | precaucion |
| 435 | GARAXIL 160/2 MG/ML | GENTAMICINA | acceso |
| 545 | LEVODEL FD 500 MG | LEVOFLOXACINA | precaucion |
| 546 | LEVODEL PLUS 750 MG | LEVOFLOXACINA | precaucion |
| 614 | METRONIDAZOL EC 500 MG | METRONIDAZOL | acceso |
| 615 | METRONIDAZOL MK 500 MG | METRONIDAZOL | acceso |
| 672 | NITROFURANTOINA MK 100 MG | NITROFURANTOINA | acceso |
| 689 | NYVU RETARD | NITROFURANTOINA | acceso |
| 738 | PEN DI BEN 1200 UI | PENICILINA BENZATINICA | acceso |
| 750 | POSITRAL 3 GR | FOSFOMICINA | precaucion |
| 811 | RIGRESAN 3 GR | FOSFOMICINA | precaucion |
| 869 | SUPRAMYCINA 100 MG | DOXICICLINA | acceso |
| 870 | SUPRAMYCINA FORTE 200 MG | DOXICICLINA | acceso |
| 900 | TETRACICLINA MK 500 MG | TETRACICLINA | acceso |
| 927 | TRIMETOPRIM SULFAMETOXASOL EC 160/800 MG | TRIMETOPRIM SULFAMETOXASOL | acceso |
| 949 | UVAMIN RETARD | NITROFURANTOINA | acceso |
| 1021 | ZUVIC 100 MG | NITROFURANTOINA | acceso |
| 1105 | POSITRAL 3G | FOSFOMICINA | precaucion |
| 1141 | AZITROMICINA NORMON 500MG | AZITROMICINA | precaucion |
| 1154 | AMOXICILINA/ACIDO CLAVULAMICO CALOX 1G | AMOXICILINA + ACIDO CLAVULAMICO | acceso |
| 1186 | FOSFOCIL | FOSFOMICINA | precaucion |
| 1279 | CEFAMEN 400MG | CEFDITOREN | precaucion |
| 1280 | FARTRIAXONA 1GR | CEFTRIAXONA | precaucion |

## Antibióticos sin clasificar (definir en el catálogo)

| ID | Producto | Principio activo | Familia |
|---|---|---|---|
| 167 | CIRIAX OTIC 0.2/1% | CIPROFLOXACINO + HIDROCORTISONA | ANTIBIOTICO |
| 188 | CLOTRIDEL CREMA | CLOTRIMAZOL + NEOMICINA + BETAMETASONA | ANTIBIOTICO + ESTEROIDE + ANTIMICOTICO |
| 215 | CREMA DDF3 | CLOTRIMAZOL + NEOMICINA + BETAMETASONA | ANTIBIOTICO + ESTEROIDE + ANTIMICOTICO |
| 407 | FUCICORT | ACIDO FUSIDICO + BETAMETASONA | ANTIBIOTICO + ESTEROIDE |
| 593 | MENADERM CLIO 30/0.25 MG | CLIOQUINOL + BECLOMETASONA | ANTIBIOTICO + ESTEROIDE |
| 611 | METIOM H PYLORI 500/500/40 MG | AMOXICILINA + LEVOFLOXACINA + ESOMEPRAZOL | ANTIBIOTICO |
| 642 | NEBADERM | CLOTRIMAZOL + NEOMICINA + BETAMETASONA | ANTIBIOTICO + ESTEROIDE + ANTIMICOTICO |
| 647 | NEO-BATRIN | NEOMICINA + CLOSTEBOL | ANTIBIOTICO + ESTEROIDE |
| 649 | NEOBOL CREMA | NEOMICINA + CLOSTEBOL | ANTIBIOTICO + ESTEROIDE |
| 650 | NEOBOL SPRAY | NEOMICINA + CLOSTEBOL | ANTIBIOTICO + ESTEROIDE |
| 676 | NOR-METROGEL CV | METRONIDAZOL | ANTIBIOTICO |
| 852 | SOLIFEN 5 MG | SUCCIONATO DE SOLIFENACINA | ANTIBIOTICO |
