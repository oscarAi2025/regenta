# 14 · Dictamen técnico

## Panel ejecutivo

| Dimensión | Estado | En una línea |
|---|---|---|
| Venta, caja y dinero | 🟢 Sólido | Hay concurrencia probada, cobro idempotente y un cierre ciego que ahora es ciego de verdad. Con 100 cajas a la vez el 100 % de las ventas queda íntegro. |
| Inventario por lote y vencimiento | 🟢 Sólido | FEFO, kardex y ajustes numerados funcionan. La migración ya no carga los inactivos de Alegra. |
| Aislamiento entre droguerías | 🟢 Sólido | RLS y contrato de API con 2.711 comprobaciones. Los permisos del vendedor se cerraron en el servidor. |
| Suscripción y cobro | 🟢 Sólido | El pago manual es idempotente. Una cuenta impaga pasa a modo consulta y se reactiva sola al pagar. |
| Regenta IA | 🟢 Bueno | La rentabilidad se calcula con datos reales, hay regla contra la inyección y permisos por rol. |
| UX y accesibilidad | 🟡 Bueno | 748 pantallas en 10 equipos sin fallos. Queda un P3 de lector de pantalla en la caja. |
| Seguridad | 🟡 Pendiente de configurar | El código está listo. Faltan 2 variables en Netlify (dos pasos en la consola e IP real). |
| DIAN | 🟠 Conformidad técnica parcial | FE, POS y NC son correctas y fallan de forma segura. Quedan 4 P1 normativos que requieren decisión. |
| Datos de Farmagenéricos | 🟠 Requiere acción | Hay saldos fantasma heredados de Alegra (montelukast y 9 más). El ajuste necesita autorización. |

**Veredicto: APTO PARA OPERAR CON CONDICIONES.** El núcleo (vender, cobrar, inventariar, aislar y cobrar la suscripción) está probado y en verde: 1.772 comprobaciones e2e, 184 unitarias y de base, y 0 fallos. Para venderlo como «facturación DIAN completa» sin matices hay que cerrar antes los P1 de la sección 3.

## 1. Qué se corrigió (con prueba)

| ID | Prioridad | Corrección |
|---|---|---|
| AUD-01 | P1 | La factura electrónica a consumidor final (222222222222) ya se puede cobrar. |
| AUD-02 | P1 | Cierre ciego real: la cajera no recibe ventas ni el esperado, ni por la API ni impreso. |
| AUD-03 | P1 | Pago manual de la consola idempotente: el doble clic ya no suma dos periodos. |
| AUD-04 | P1 | El vendedor no entra a Inventario ni descarga el Excel. |
| AUD-05 | P2 | La cajera no reemplaza el correo ni el teléfono de un cliente. |
| AUD-06 | P1 | La migración desde Alegra no importa los saldos de artículos inactivos. |
| AUD-07 | P1 | La IA responde márgenes con la misma regla que Reportes. |
| Mejora | — | **Modo consulta + renovación en un clic:** con la cuenta suspendida, el dueño entra, descarga sus XML y su copia de datos, y renueva con los datos puestos. Al aprobarse el pago, la cuenta se reactiva sola. |
| AA | — | Se corrigió el contraste del menú y del aviso legal, y el foco de teclado en Reportes. |

## 2. Evidencia

Detalle en 12-PRUEBAS-FINALES:

- Regresión completa sin fallos.
- Carga de 5 a 100 cajas con la integridad intacta.
- Concurrencia de la última unidad y del cobro triple.
- Las pruebas de base y e2e **sí se ejecutaron** en esta auditoría. Esto corrige lo que dice el borrador de 05 («no se ejecutaron»), que es anterior a montar Postgres y el servidor.

## 3. Lo que falta, por dueño de la decisión

| # | Qué | Quién | Por qué no se hizo aquí |
|---|---|---|---|
| 1 | Aplicar `db/produccion/bloque4-051.sql` en Supabase | Oscar | Cambia producción. |
| 2 | `REGENTA_ADMIN_DOS_PASOS=1` y `REGENTA_CABECERA_IP=x-nf-client-connection-ip` en Netlify | Oscar | Configuración de producción. |
| 3 | Fusionar `audit/regenta-enterprise-quality` en `main` después del paso 1 | Oscar | Despliegue. |
| 4 | Conteo físico y ajuste de los saldos fantasma (AUD-08) | Oscar | Inventario real de un cliente. |
| 5 | Tope de 5 UVT en el POS (P1-1) | Contador → desarrollo | Hay ambigüedad normativa y puede cambiar cómo factura cada droguería. |
| 6 | Contingencia del art. 37 (P1-2) | Desarrollo | Es desarrollo mayor y hay que validarlo en el sandbox de MATIAS. **P1-3 (48 h → «rechazado») corregido** en la rama `mejora/dian-48h-contingencia`: sigue pendiente, reintento cada 6 h, aviso al dueño y a la consola, y anular exige nota crédito (prueba `dian-48h`, 11 comprobaciones; migración 052). |
| 7 | Plazos y aviso del documento soporte (P1-5) | Desarrollo | Hay que validarlo en el sandbox. |
| 8 | Caja: resultados de búsqueda sin controles anidados (P3) | Desarrollo | Toca el flujo de venta con teclado. |

## 4. Orden recomendado

Seguir los pasos 1 → 2 → 3 del 13-PLAN-DESPLIEGUE. La misma semana, consultar al contador el tope de 5 UVT. El siguiente ciclo de desarrollo debería ser la contingencia y el estado a 48 h, porque son lo único que puede dejar a una droguería sin facturar o con un documento mal anulado.
