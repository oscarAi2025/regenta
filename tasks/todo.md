# Regenta · plan de trabajo

Especificación: https://claude.ai/artifact/78qFbvxbiGftd3bxur2Q7z (Claude Doc «Regenta · Especificación del producto»)

## Semana 1 · base (1/11/2026)
- [ ] Repo: Next.js 15 + TypeScript + Tailwind, pg, tipografía Barlow (autoalojada)
- [ ] Base de datos: migraciones compatibles con Supabase (empresas, sedes, cajas, miembros, catálogo maestro, productos, lotes, costos aparte, movimientos, ventas, pagos, clientes, resoluciones y documentos DIAN, auditoría)
- [ ] Seguridad por fila (RLS) por empresa + rol; costo solo para dueño/admin; documentos fiscales inmutables
- [ ] Función registrar_venta: lote por vencimiento más próximo (FEFO), pagos, numeración de la resolución, documento DIAN pendiente, auditoría; todo en una transacción
- [ ] Pruebas de aislamiento: un usuario de la empresa A no ve ni escribe nada de la B; cajero no ve costos
- [ ] Catálogo maestro precargado desde Farmagenéricos (nombre, laboratorio, IVA, EAN, categoría; sin proveedores ni costos)
- [ ] Capa de datos del servidor: cada consulta corre como «authenticated» con los claims del usuario (igual que Supabase)
- [ ] Acceso de desarrollo (usuarios sembrados) — Supabase Auth en la siguiente iteración
- [ ] Caja POS: búsqueda/escáner, caja o unidad, ticket tipo tirilla, cobro con medios de pago y cambio, venta registrada, estado DIAN
- [ ] Inventario: stock por lote con semáforo de vencimiento
- [ ] Emisión DIAN: adaptador con modo simulado (MATIAS real al tener cuenta y documentación)
- [ ] Verificación: pruebas SQL + e2e en navegador + capturas escritorio/móvil
