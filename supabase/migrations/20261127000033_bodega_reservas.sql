-- Bodega de reservas para solicitudes (fuera de SIVET). Va sola porque un valor nuevo de enum
-- no se puede usar en la misma transacción en que se crea.
alter type tipo_bodega add value if not exists 'reservas';
