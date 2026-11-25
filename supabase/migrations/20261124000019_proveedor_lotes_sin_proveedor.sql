-- =============================================================================
-- SIGAM-INABVE · 019 · Lotes de SIFAR sin proveedor (confirmado por H. Alas, 24/11/2026)
-- Pañales Pull-Up → SUPLIDORES DIVERSOS · PREDIN MC 5MG y APRANAX 550 MG → CEFAFA
-- =============================================================================
update lotes set proveedor_id = 7 where proveedor_id is null and producto_id in (1271, 1272);  -- pañales Pull-Up G/XG y M
update lotes set proveedor_id = 1 where proveedor_id is null and producto_id in (1243, 56);    -- PREDIN MC 5MG, APRANAX 550 MG
