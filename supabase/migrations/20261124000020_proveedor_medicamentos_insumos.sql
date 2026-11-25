-- =============================================================================
-- SIGAM-INABVE · 020 · Proveedor de los lotes de SIFAR sin proveedor (H. Alas, 24/11/2026)
-- * Todo medicamento es de CEFAFA.
-- * Insumos: el proveedor del contrato SIVET donde aparece el producto; ácido fusídico y
--   Andicaina (medicamentos) → CEFAFA; dextrosa PISA → PISA.
-- * Sin asignar (no aparecen en ningún contrato SIVET): andadera con canastilla, baja lenguas
--   Nipro, bolsa de colostomía Novatec 70 mm, catéter Safelet 18G (2) y solución Hartman.
-- =============================================================================
update lotes l set proveedor_id = 1
  from productos p where p.id = l.producto_id and l.proveedor_id is null and p.tipo = 'medicamento';
-- CEFAFA: ACIDO FUSIDICO MK 2%; ANDICAINA SPRAY 5%; BOLSA DE UROSTOMIA CONVATEC 45MM; CATETER EXTERNO "L"; CLORHEXIDINA 4% FALMAR 1LT; CLORHEXIDINA 4% FALMART 250ML; COLD CREAM; CURA REDONDA CUREBAND; DOLOCRIM FORTE 226GR; GASA MIGASA 3X3"; GUANTES DE LATEX NIPRO TALLA M; GUANTES DE LATEX NIPRO TALLA S; GUANTES DE LATEX TALLA L NIPRO; GUANTES ESTERILES NIPRO 7.5; IRUXOL 60/1 U/GR; JERINGA BD PARA INSULINA ULTRA FINE 1 ML; JERINGA DE INSULINA NIPRO; LUBRIDERM HUMECTACION DIARIA; MEDIDOR DE GLUCOSA PREMIER ALPHA; MICRODACYN SPRAY; MICROPORE 3M 3X10; PARCHE DUODERM CGF 20X20 CM; PARCHE DUODERM CGF 4X4"; PARCHE DUODERM CGF 6X6"; PLACA PARA BOLSA DE UROSTOMIA CONVATEC 45MM; SOLUCION SALINA 0.9% 1000ML; SUFREXAL GEL; TIRAS REACTIVAS PREMIER; TOALLAS HUMEDAS HUGGIES; TOALLAS HUMEDAS TENA XG; TRIGENTAX CREMA; VENDA ELASTICA MIGASA 4"; VENDA GASA MIGASA 3X10; VENDA GASA MIGASA 6X10; VERSATIS PARCHE CUTANEO 0.05%
update lotes set proveedor_id = 1 where proveedor_id is null and producto_id in (3, 52, 196, 508, 563, 728, 729, 866, 926, 968, 1023, 1029, 1030, 1074, 1075, 1079, 1080, 1084, 1086, 1087, 1088, 1089, 1092, 1093, 1143, 1174, 1199, 1233, 1234, 1237, 1248, 1255, 1283, 1300, 1301);
-- S.T. MEDIC: BASTONES DE UN PUNTO CURVO; SILLA DE RUEDAS ESTANDAR 18"
update lotes set proveedor_id = 3 where proveedor_id is null and producto_id in (1190, 1281);
-- ASCES: BASTONES PARA DISCAPACIDAD VISUAL 52"
update lotes set proveedor_id = 4 where proveedor_id is null and producto_id in (1192);
-- DADA DADA Y CÍA: FAJA LUMBOSACRA
update lotes set proveedor_id = 8 where proveedor_id is null and producto_id in (1207);
-- PISA: SOLUCION DEXTROSA 5% PISA; SOLUCION SALINA 0.9% PISA
update lotes set proveedor_id = 13 where proveedor_id is null and producto_id in (1284, 1285);
