-- 052 · Un documento sin respuesta de la DIAN pasadas 48 h ya no se marca «rechazado» (src/lib/dian/index.ts).
-- Los que quedaron así con la regla anterior vuelven a la cola: se reintentan con el mismo uuid y, si la DIAN ya los tenía,
-- la regla 90 los recupera con su CUFE. Mientras estén pendientes, anular la venta exige nota crédito (024, anular_venta).
-- Solo toca documentos con el texto exacto que ponía el plazo vencido; un rechazo real de la DIAN no se toca.
update documentos_dian d set estado = 'pendiente', proximo_intento = now(), actualizado = now(),
  ultimo_error = 'Vuelto a la cola (migración 052): estaba marcado «rechazado» solo por llevar 48 h sin respuesta. ' || coalesce(d.ultimo_error, '')
where d.estado = 'rechazado' and d.ultimo_error like 'Sin respuesta tras 48 horas%';
