-- =============================================================================
-- SIGAM-INABVE · 016 · Catálogo y nombres de contratos iguales a SIVET (24/11/2026)
-- Ya aplicado en Supabase; idempotente.
-- =============================================================================
-- SIFAR perdió el cero inicial del código del parche de ojo
update productos set codigo = '051131000230', modificado_at = now(), modificado_por = 'harold.alas'
 where id = 1155 and codigo = '51131000230';
-- FENOVAS: mismo producto que SIVET, con su código y nombre
update productos set codigo = '7703153039585', nombre_comercial = 'FENOVAS 10/135 MG', concentracion = '10/135',
       modificado_at = now(), modificado_por = 'harold.alas'
 where id = 376 and codigo is null;
-- Productos que no estaban en SIFAR. Rivotril y Humbral no tienen código en SIVET:
-- se les asigna uno interno (CTRL-) y se marcan como controlados.
insert into productos (codigo, nombre_comercial, principio_activo, concentracion, presentacion, familia_id, tipo, controlado, creado_por)
values ('CTRL-0001', 'RIVOTRIL 2MG (CLONAZEPAM)', 'CLONAZEPAM', '2MG', 'FRASCO X 30 TABS', 45, 'medicamento', true, 'harold.alas'),
       ('CTRL-0002', 'HUMBRAL 100MG (FENOBARBITAL)', 'FENOBARBITAL', '100MG', 'CAJA X 30 TABS', 19, 'medicamento', true, 'harold.alas'),
       ('INS''0088', 'REGATONES PARA MULETAS (PAR)', null, null, 'PAR', 36, 'insumo', false, 'harold.alas'),
       ('INS''0047', 'BASTONES CANADIENSES "M" (PAR)', null, null, 'PAR', 36, 'insumo', false, 'harold.alas')
on conflict (codigo) do nothing;
-- Nombres de contrato como aparecen en SIVET
update contratos set nombre_sivet = 'ACES - INSUMOS - JUAN PABLO II' where id = 17 and nombre_sivet = 'ASCES - INSUMOS - JUAN PABLO II';
update contratos set nombre_sivet = replace(nombre_sivet, 'DADA DADA Y CÍA', 'DADA DADA Y C.A.') where nombre_sivet like 'DADA DADA Y CÍA%';
insert into contratos (id, numero_sivet, proveedor_id, sede_id, tipo, nombre_sivet)
select 45, 45, 13, 1, 'insumo', 'PISA - INSUMOS - JUAN PABLO II'
 where not exists (select 1 from contratos where nombre_sivet = 'PISA - INSUMOS - JUAN PABLO II');
select id, numero_sivet, nombre_sivet from contratos where id = 45;
