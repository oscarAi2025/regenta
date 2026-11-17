# 02 · Inventario total de funcionalidades (Regenta)

Rama auditada: `audit/regenta-enterprise-quality`. Construido leyendo el código (no el menú): `src/app/**/page.tsx` (102), `src/app/**/route.ts` (116), `src/lib/sesion.ts`, `src/lib/api.ts`, `src/lib/admin.ts`, `src/lib/idem.ts`, `netlify/`, funciones SQL de `db/migrations` y las pruebas de `tests/`. No se modificó código ni se tocó producción.

## 0. Leyenda

- **Roles** (`src/lib/sesion.ts:10`): `dueno` (D), `admin` (A), `cajero` (C), `bodeguero` (B), `vendedor` (V). Además: **Superadmin** (tabla `superadmins`, cookie `regenta_admin`, `src/lib/admin.ts`), sesión de **soporte** (superadmin dentro de un cliente, 1 h, `soporte` en el JWT), **Público**, **Cron** (`Authorization: Bearer REGENTA_CRON_KEY`) y **Webhook** firmado.
- **Guardas**: `conSesion` (`src/lib/api.ts:9`: mismo origen en escrituras + sesión revalidada en BD en cada petición + errores de BD traducidos + `Cache-Control: private, no-store` en GET); `conAdmin` (`src/lib/admin.ts:59`); `comoUsuario` = transacción con rol `authenticated` y RLS; `sinRLS` = conexión sin RLS (la ruta filtra a mano por `s.empresa`).
- **Permisos de interfaz** (`src/lib/sesion.ts:66-76`): `vender`/`fiar` = D/A/C · `verCostos`/`anular`/`cartera` = D/A · `moverInventario` = D/A/B. Otros: `puedeCompras` (`src/lib/compras.ts:6`), `puedePrecios` (`src/lib/precios.ts:5`), `permisoCartera` (`src/lib/cartera.ts:7`), `puedeResultados` (`src/lib/gastos.ts:7`), `puedeEntregar` (`src/lib/entregas-datos.ts:10`), `puedeTemperatura` (`src/lib/temperatura.ts:10`), `puedePedidos` (`src/lib/pedidos.ts:12`), `puedeDian` (`src/lib/dian/soporte.ts:13`). Las funciones SQL `SECURITY DEFINER` vuelven a comprobar el rol con `rol_en(empresa)` (verificado en `registrar_venta`, `anular_venta`, `devolver_venta`, `registrar_recibo`, `registrar_abono`, `abrir_turno`, `cerrar_turno`, `exigir_turno`, `guardar_pedido`, `contar_conteo`, `registrar_informe_anexo13`).
- **Idempotencia**: «idem_key (idempotente())» = `src/lib/idem.ts` en la app; «idem_key en SQL» = la función guarda y devuelve el resultado previo (verificado en `registrar_venta`, `registrar_compra`, `registrar_gasto`, `registrar_entrada`, `aplicar_ajuste`, `registrar_entrega`, `registrar_pago_proveedor`, `registrar_devolucion_proveedor`, `aplicar_cambio_precios`, `generar_soporte`, `ajustar_soporte`, `nota_debito`); «natural» = la operación no se puede repetir por estado o restricción única; **NO** = repetir duplica.
- **Test que la cubre**: «Contrato» = la combinación método+ruta está en `tests/e2e/endpoints.mjs` (prueba sin credenciales, CSRF, rol sin permiso, vendedor, datos basura y método inexistente: **no prueba el efecto**). Después, los archivos de `tests/` que usan la ruta (búsqueda por texto; «vía UI» = solo se ejerce pulsando la pantalla).

## 1. Endpoints (116 archivos `route.ts`, 160 manejadores método+ruta)

| Identificador | Ruta | Tipo | Componente/Archivo | Rol | Escribe vía | Validación | Idempotencia | Test que la cubre | Observación |
|---|---|---|---|---|---|---|---|---|---|
| E-001 | `/api/acceso` | POST | `src/app/api/acceso/route.ts` | Público (mismoOrigen + límite en BD por IP/correo) | sinRLS: intentos_acceso, cuentas (ultimo_ingreso, totp_ultimo); crea cookie | zod | n/a | Contrato; admin.mjs, factura-carta.mjs, habilitacion.mjs (+2) | 2FA de consola solo si REGENTA_ADMIN_DOS_PASOS=1 (l.39). |
| E-002 | `/api/activar` | POST | `src/app/api/activar/route.ts` | Público (mismoOrigen + limitador en memoria) | sinRLS: invitaciones, cuentas, correos | zod | natural (token de un uso) | Contrato; admin.mjs, consola-clave.mjs, ingresos.mjs | Límite solo en memoria por instancia (l.9). |
| E-003 | `/api/activar/nuevo` | POST | `src/app/api/activar/nuevo/route.ts` | Público (mismoOrigen + limitador + limiteBD) | sinRLS: invitaciones, correos | zod | n/a | Contrato; ingresos.mjs | Respuesta constante; no aplica a superadmins. |
| E-004 | `/api/admin/activar` | POST | `src/app/api/admin/activar/route.ts` | Público (mismoOrigen + limitador en memoria) | sinRLS: invitaciones, cuentas | zod | natural (token de un uso) | Contrato; vía UI: consola-clave.mjs | Límite solo en memoria (l.8). |
| E-005 | `/api/admin/cargos` | PATCH | `src/app/api/admin/cargos/route.ts` | Superadmin | sinRLS: cargos_documentos + admin_eventos (misma tx) | zod | natural (estado='pendiente') | Contrato; ingresos.mjs |  |
| E-006 | `/api/admin/clientes` | POST | `src/app/api/admin/clientes/route.ts` | Superadmin | sinRLS: empresas, sedes, cajas, resoluciones_dian, cuentas/miembros, correos, solicitudes_demo, pagos_suscripcion | zod | natural (NIT único) | Contrato; admin.mjs, factura-carta.mjs, habilitacion.mjs (+2) |  |
| E-007 | `/api/admin/clientes/[id]` | DELETE | `src/app/api/admin/clientes/[id]/route.ts` | Superadmin + confirmar NIT | eliminar_empresa_prueba(); Stripe | zod | natural | Contrato; admin.mjs |  |
| E-008 | `/api/admin/clientes/[id]` | PATCH | `src/app/api/admin/clientes/[id]/route.ts` | Superadmin | sinRLS: empresas, resoluciones_dian, correos; Stripe | zod | natural | Contrato; admin.mjs, dian-soporte.mjs, habilitacion.mjs (+1) | Rama matias: bitácora fuera de la tx (l.86). |
| E-009 | `/api/admin/clientes/[id]/entrar` | POST | `src/app/api/admin/clientes/[id]/entrar/route.ts` | Superadmin | admin_eventos + cookie de soporte | sin cuerpo | n/a | Contrato; admin.mjs, factura-carta.mjs, migracion.mjs | Bitácora antes de la sesión. |
| E-010 | `/api/admin/clientes/[id]/exportar` | GET | `src/app/api/admin/clientes/[id]/exportar/route.ts` | Superadmin | admin_eventos | — | n/a | Contrato; admin.mjs |  |
| E-011 | `/api/admin/clientes/[id]/habilitacion` | GET | `src/app/api/admin/clientes/[id]/habilitacion/route.ts` | Superadmin | — | — | n/a | Contrato; habilitacion.mjs | Llama a MATIAS. |
| E-012 | `/api/admin/clientes/[id]/habilitacion` | POST | `src/app/api/admin/clientes/[id]/habilitacion/route.ts` | Superadmin | empresas.matias_cliente; MATIAS | zod (discriminatedUnion) | no | Contrato; habilitacion.mjs | Bitácora fuera de tx en varias ramas. |
| E-013 | `/api/admin/clientes/[id]/logo` | PUT | `src/app/api/admin/clientes/[id]/logo/route.ts` | Superadmin | sinRLS: empresas.logo | zod (LogoCuerpo) | natural | Contrato; vía UI probable (SubirLogo); sin aserción directa |  |
| E-014 | `/api/admin/clientes/[id]/migracion` | POST | `src/app/api/admin/clientes/[id]/migracion/route.ts` | Superadmin | registrar_entrada, registrar_ajuste, productos, proveedores… | zod | idem_key | Contrato; migracion.mjs |  |
| E-015 | `/api/admin/clientes/[id]/numeraciones` | POST | `src/app/api/admin/clientes/[id]/numeraciones/route.ts` | Superadmin | sinRLS: resoluciones_dian | zod | natural (reemplaza la vigente) | Contrato; ingresos.mjs |  |
| E-016 | `/api/admin/clientes/[id]/pagos` | POST | `src/app/api/admin/clientes/[id]/pagos/route.ts` | Superadmin | sinRLS: INSERT pagos_suscripcion aprobado + alCambiarPago | zod | NO | Contrato; ingresos.mjs | Doble clic = 2 pagos aprobados y 2 periodos (l.20-31). |
| E-017 | `/api/admin/clientes/[id]/usuarios` | PATCH | `src/app/api/admin/clientes/[id]/usuarios/route.ts` | Superadmin | sinRLS: miembros, cuentas, invitaciones, correos | zod | natural | Contrato; admin.mjs, ingresos.mjs | Desactivar (activo=false) no comprueba que quede un dueño (l.43). |
| E-018 | `/api/admin/clientes/[id]/usuarios` | POST | `src/app/api/admin/clientes/[id]/usuarios/route.ts` | Superadmin | invitar(): cuentas, miembros, invitaciones, correos | zod | natural | Contrato; admin.mjs | Enum de rol sin «vendedor» (l.9). |
| E-019 | `/api/admin/correos` | PATCH | `src/app/api/admin/correos/route.ts` | Superadmin | sinRLS: correos | zod | natural (estado) | Contrato; ingresos.mjs |  |
| E-020 | `/api/admin/dos-pasos` | POST | `src/app/api/admin/dos-pasos/route.ts` | Superadmin (también en «inscribir») | sinRLS: cuentas.totp_* | zod | natural | Contrato; vía UI: consola-clave.mjs, admin.mjs |  |
| E-021 | `/api/admin/pagos` | PATCH | `src/app/api/admin/pagos/route.ts` | Superadmin | sinRLS: pagos_suscripcion; Stripe (reembolso/expirar) | zod | natural (where estado=…) | Contrato; admin.mjs, ingresos.mjs | Rama final desliga pago sin validar estado; bitácora fuera de tx (l.103-106). |
| E-022 | `/api/admin/salir` | POST | `src/app/api/admin/salir/route.ts` | Público (mismoOrigen) | sesiones_cerradas (revocar) | sin cuerpo | natural | Contrato; **SIN prueba funcional** |  |
| E-023 | `/api/admin/sistema` | POST | `src/app/api/admin/sistema/route.ts` | Superadmin | procesarCola, sincronizarInvima, correos | zod | n/a | Contrato; vía UI: admin.mjs:268 |  |
| E-024 | `/api/admin/solicitudes` | PATCH | `src/app/api/admin/solicitudes/route.ts` | Superadmin | sinRLS: solicitudes_demo | zod | natural | Contrato; vía UI: admin.mjs:264 |  |
| E-025 | `/api/alertas` | POST | `src/app/api/alertas/route.ts` | D/A/B (comprobación en ruta + RLS) | INSERT alertas_revision (RLS) | zod | NO | Contrato; **SIN prueba funcional** | Doble clic duplica la revisión (tabla inmutable). |
| E-026 | `/api/bitacora` | GET | `src/app/api/bitacora/route.ts` | D/A (puedeResultados) | — | query (filtroBitacora) | n/a | Contrato; resultados.mjs, ubicacion.mjs |  |
| E-027 | `/api/cajas` | GET | `src/app/api/cajas/route.ts` | Sesión, cualquier rol | — | — | n/a | Contrato; admin.mjs, ingresos.mjs | sinRLS filtrado por s.empresa. |
| E-028 | `/api/cajas` | PATCH | `src/app/api/cajas/route.ts` | Solo dueño | sinRLS: cajas, auditoria | zod | natural | Contrato; admin.mjs |  |
| E-029 | `/api/cajas` | POST | `src/app/api/cajas/route.ts` | Solo dueño | sinRLS: cajas, auditoria | zod | natural (nombre único) | Contrato; admin.mjs |  |
| E-030 | `/api/cartera` | GET | `src/app/api/cartera/route.ts` | D/A | — | query manual | n/a | Contrato; cuentas-clientes.mjs, migracion.mjs, seguridad.mjs |  |
| E-031 | `/api/cartera` | PATCH | `src/app/api/cartera/route.ts` | D/A | configurar_mora() | zod | natural | Contrato; cuentas-clientes.mjs |  |
| E-032 | `/api/cartera` | POST | `src/app/api/cartera/route.ts` | D/A (puede.cartera) | registrar_abono() | zod | idem_key (idempotente()) | Contrato; cuentas-clientes.mjs, facturacion.mjs, migracion.mjs (+1) |  |
| E-033 | `/api/cartera/[id]` | DELETE | `src/app/api/cartera/[id]/route.ts` | D/A | anular_abono() | zod | natural (estado) | Contrato; **SIN prueba funcional** |  |
| E-034 | `/api/clientes` | GET | `src/app/api/clientes/route.ts` | D/A/C (puede.vender) | — | query manual | n/a | Contrato; cuentas-clientes.mjs, factura-carta.mjs, facturacion.mjs (+3) |  |
| E-035 | `/api/clientes` | POST | `src/app/api/clientes/route.ts` | D/A/C | INSERT … ON CONFLICT clientes (RLS) | zod (ClienteEntrada) | natural (upsert) | Contrato; cuentas-clientes.mjs, seguridad.mjs |  |
| E-036 | `/api/clientes/[id]` | PATCH | `src/app/api/clientes/[id]/route.ts` | D/A (puede.verCostos) | UPDATE clientes (RLS) | zod | natural | Contrato; cuentas-clientes.mjs, ingresos.mjs |  |
| E-037 | `/api/clientes/[id]/correo` | POST | `src/app/api/clientes/[id]/correo/route.ts` | D/A/C | UPDATE clientes.email (solo si vacío) | zod | natural | Contrato; **SIN prueba funcional** |  |
| E-038 | `/api/clientes/[id]/credito` | GET | `src/app/api/clientes/[id]/credito/route.ts` | D/A/C (permisoCartera.verCredito) | — | query manual | n/a | Contrato; cuentas-clientes.mjs |  |
| E-039 | `/api/clientes/[id]/credito` | PATCH | `src/app/api/clientes/[id]/credito/route.ts` | D/A | configurar_credito_cliente() | zod | natural | Contrato; cuentas-clientes.mjs |  |
| E-040 | `/api/compras` | GET | `src/app/api/compras/route.ts` | D/A/B (bodega sin dinero) | — | query manual | n/a | Contrato; compras.mjs, dian-soporte.mjs, resultados.mjs |  |
| E-041 | `/api/compras` | POST | `src/app/api/compras/route.ts` | D/A/B (pago solo D/A) | registrar_compra(), agregar_cargos_compra(), vincular_archivo_compra(), recordar_productos_proveedor(), registrar_pago_proveedor() | zod | idem_key en SQL | Contrato; compras-factura.mjs, compras.mjs, dian-soporte.mjs (+2) |  |
| E-042 | `/api/compras/[id]` | DELETE | `src/app/api/compras/[id]/route.ts` | D/A | anular_compra() | zod | natural (estado) | Contrato; compras.mjs |  |
| E-043 | `/api/compras/[id]` | GET | `src/app/api/compras/[id]/route.ts` | D/A/B | — | uuid | n/a | Contrato; compras.mjs |  |
| E-044 | `/api/compras/[id]` | PATCH | `src/app/api/compras/[id]/route.ts` | D/A | completar_costos_compra() | zod | natural (estado) | Contrato; compras.mjs |  |
| E-045 | `/api/compras/devoluciones` | PATCH | `src/app/api/compras/devoluciones/route.ts` | D/A | aplicar_nc_proveedor() | zod | natural | Contrato; compras.mjs |  |
| E-046 | `/api/compras/devoluciones` | POST | `src/app/api/compras/devoluciones/route.ts` | D/A | registrar_devolucion_proveedor() | zod | idem_key en SQL | Contrato; compras.mjs | compra_id sin precomprobación en la ruta; la función filtra por empresa. |
| E-047 | `/api/compras/leer-factura` | POST | `src/app/api/compras/leer-factura/route.ts` | D/A/B | guardar_archivo_compra() (archivo + sha256); IA | manual (multipart, tamaño, firma de bytes) | natural (sha256) | Contrato; compras-factura.mjs, seguridad.mjs | Sin zod: formulario multipart. |
| E-048 | `/api/compras/pagos` | DELETE | `src/app/api/compras/pagos/route.ts` | D/A | anular_pago_proveedor() | zod | natural | Contrato; compras.mjs |  |
| E-049 | `/api/compras/pagos` | POST | `src/app/api/compras/pagos/route.ts` | D/A | registrar_pago_proveedor() | zod | idem_key en SQL | Contrato; compras.mjs |  |
| E-050 | `/api/configuracion` | PATCH | `src/app/api/configuracion/route.ts` | Solo dueño | sinRLS: empresas, auditoria | zod | natural | Contrato; admin.mjs | No en demo. |
| E-051 | `/api/control-especial` | GET | `src/app/api/control-especial/route.ts` | D/A (verCostos) | — | query manual | n/a | Contrato; anexo13.mjs, control-especial.mjs, modo-interno.mjs | Datos de pacientes. |
| E-052 | `/api/control-especial` | PATCH | `src/app/api/control-especial/route.ts` | D/A | configurar_formulas() | zod | natural | Contrato; vía UI: control-especial.mjs:189 |  |
| E-053 | `/api/control-especial/anexo13` | GET | `src/app/api/control-especial/anexo13/route.ts` | D/A | — | query manual | n/a | Contrato; anexo13.mjs, modo-interno.mjs |  |
| E-054 | `/api/control-especial/anexo13` | POST | `src/app/api/control-especial/anexo13/route.ts` | D/A | registrar_informe_anexo13() | zod | NO (cada envío crea un reemplazo) | Contrato; anexo13.mjs | Doble clic deja dos informes encadenados. |
| E-055 | `/api/control-especial/configuracion` | GET | `src/app/api/control-especial/configuracion/route.ts` | D/A | — | — | n/a | Contrato; anexo13.mjs |  |
| E-056 | `/api/control-especial/configuracion` | PUT | `src/app/api/control-especial/configuracion/route.ts` | D/A | configurar_anexo13() | zod + validarPlantilla | natural | Contrato; anexo13.mjs |  |
| E-057 | `/api/control-especial/fichas` | GET | `src/app/api/control-especial/fichas/route.ts` | D/A | — | — | n/a | Contrato; anexo13.mjs |  |
| E-058 | `/api/control-especial/fichas` | PUT | `src/app/api/control-especial/fichas/route.ts` | D/A | guardar_ficha_control() | zod | natural | Contrato; anexo13.mjs |  |
| E-059 | `/api/control-especial/libro` | GET | `src/app/api/control-especial/libro/route.ts` | D/A | — | query manual | n/a | Contrato; anexo13.mjs |  |
| E-060 | `/api/correo/baja` | POST | `src/app/api/correo/baja/route.ts` | Público (token firmado; sin mismoOrigen por RFC 8058) | sinRLS: correos_bajas, correos, solicitudes_demo | manual (leerTokenBaja) | natural | Contrato; admin.mjs |  |
| E-061 | `/api/cuenta` | POST | `src/app/api/cuenta/route.ts` | Sesión, cualquier rol (no soporte, no demo) | sinRLS: cuentas (clave, version_sesion) | zod | natural | Contrato; ingresos.mjs |  |
| E-062 | `/api/cuentas-por-pagar` | GET | `src/app/api/cuentas-por-pagar/route.ts` | D/A | — | query manual | n/a | Contrato; compras.mjs |  |
| E-063 | `/api/demo` | POST | `src/app/api/demo/route.ts` | Público (mismoOrigen + trampa bot + límites) | sinRLS: solicitudes_demo, correos, demo_visitas | zod | no (mitigado por límites) | Contrato; admin.mjs, demo-visitas.mjs, gestion.mjs |  |
| E-064 | `/api/demo/evento` | POST | `src/app/api/demo/evento/route.ts` | Sesión, cualquier rol (solo registra en empresa demo) | demo_eventos (registrarEvento) | zod | no | Contrato; demo-visitas.mjs |  |
| E-065 | `/api/dian` | POST | `src/app/api/dian/route.ts` | Cron (cronAutorizado) | procesarCola → documentos_dian | sin cuerpo | skip locked | Contrato; dian-soporte.mjs, operacion.mjs |  |
| E-066 | `/api/dian/nota-debito` | GET | `src/app/api/dian/nota-debito/route.ts` | D/A (puedeDian.emitir) | — | uuid | n/a | Contrato; dian-soporte.mjs |  |
| E-067 | `/api/dian/nota-debito` | POST | `src/app/api/dian/nota-debito/route.ts` | D/A | nota_debito() + procesarCola | zod | idem_key en SQL | Contrato; dian-soporte.mjs |  |
| E-068 | `/api/dian/soporte` | GET | `src/app/api/dian/soporte/route.ts` | D/A | — | uuid | n/a | Contrato; dian-soporte.mjs |  |
| E-069 | `/api/dian/soporte` | POST | `src/app/api/dian/soporte/route.ts` | D/A | generar_soporte() + procesarCola | zod | idem_key en SQL | Contrato; dian-soporte.mjs |  |
| E-070 | `/api/dian/soporte/[id]/ajuste` | POST | `src/app/api/dian/soporte/[id]/ajuste/route.ts` | D/A | ajustar_soporte() + procesarCola | zod | idem_key en SQL | Contrato; dian-soporte.mjs |  |
| E-071 | `/api/documentos` | GET | `src/app/api/documentos/route.ts` | D/A (puede.anular) | — | query (leerFiltro) | n/a | Contrato; cumplimiento.mjs, dian-soporte.mjs |  |
| E-072 | `/api/documentos/[id]/reenviar` | POST | `src/app/api/documentos/[id]/reenviar/route.ts` | D/A | sinRLS: UPDATE documentos_dian, auditoria + procesarCola | sin cuerpo | natural (estado='rechazado') | Contrato; dian-soporte.mjs |  |
| E-073 | `/api/documentos/[id]/xml` | GET | `src/app/api/documentos/[id]/xml/route.ts` | D/A | — | uuid | n/a | Contrato; dian-soporte.mjs |  |
| E-074 | `/api/documentos/xml` | GET | `src/app/api/documentos/xml/route.ts` | D/A | — | query (leerFiltro) | n/a | Contrato; dian-soporte.mjs |  |
| E-075 | `/api/empresa/factura` | PUT | `src/app/api/empresa/factura/route.ts` | D/A | sinRLS: empresas.factura_formato, auditoria | zod | natural | Contrato; factura-carta.mjs | NO protege la demo (l.12-16). |
| E-076 | `/api/empresa/logo` | PUT | `src/app/api/empresa/logo/route.ts` | Solo dueño | sinRLS: empresas.logo, auditoria | zod (LogoCuerpo) | natural | Contrato; factura-carta.mjs | No en demo. |
| E-077 | `/api/entregas` | GET | `src/app/api/entregas/route.ts` | D/A/C/B (puedeEntregar) | — | query manual | n/a | Contrato; modo-interno.mjs |  |
| E-078 | `/api/entregas` | POST | `src/app/api/entregas/route.ts` | D/A/C/B | registrar_entrega() (exige modo interno) | zod | idem_key obligatoria en SQL | Contrato; modo-interno.mjs |  |
| E-079 | `/api/entregas/[id]` | GET | `src/app/api/entregas/[id]/route.ts` | D/A/C/B | — | uuid | n/a | Contrato; modo-interno.mjs |  |
| E-080 | `/api/entregas/[id]/anular` | POST | `src/app/api/entregas/[id]/anular/route.ts` | D/A | anular_entrega() | zod | natural | Contrato; modo-interno.mjs |  |
| E-081 | `/api/equipo` | PATCH | `src/app/api/equipo/route.ts` | Solo dueño | sinRLS: miembros, invitaciones, correos, auditoria | zod | natural | Contrato; admin.mjs |  |
| E-082 | `/api/equipo` | POST | `src/app/api/equipo/route.ts` | Solo dueño | sinRLS: invitar() cuentas/miembros/invitaciones, correos, auditoria | zod | natural | Contrato; admin.mjs, mostrador.mjs |  |
| E-083 | `/api/etiquetas` | GET | `src/app/api/etiquetas/route.ts` | D/A/B | — | query manual | n/a | Contrato; precios-lotes.mjs |  |
| E-084 | `/api/exportar` | GET | `src/app/api/exportar/route.ts` | Solo dueño (leerSesion propio, sin conSesion) | — | — | n/a | Contrato; admin.mjs | No en demo; 6/h. |
| E-085 | `/api/gastos` | DELETE | `src/app/api/gastos/route.ts` | D/A | anular_gasto() | zod | natural | Contrato; resultados.mjs |  |
| E-086 | `/api/gastos` | GET | `src/app/api/gastos/route.ts` | D/A | — | query (filtroGastos) | n/a | Contrato; resultados.mjs |  |
| E-087 | `/api/gastos` | POST | `src/app/api/gastos/route.ts` | D/A | registrar_gasto() | zod | idem_key en SQL | Contrato; resultados.mjs |  |
| E-088 | `/api/ia` | POST | `src/app/api/ia/route.ts` | Sesión, cualquier rol (herramientas filtradas por rol) | demo_eventos; limites | zod | n/a | Contrato; ia.mjs | Herramientas de solo lectura con comoUsuario. |
| E-089 | `/api/inventario` | POST | `src/app/api/inventario/route.ts` | D/A/B (moverInventario) | registrar_entrada() + INSERT proveedores | zod | idem_key en SQL | Contrato; ingresos.mjs, inventario-control.mjs, precios-lotes.mjs | Vía antigua: entra mercancía tipo «compra» sin compra ni cuenta por pagar (l.8, 31-36). |
| E-090 | `/api/inventario/ajustes` | POST | `src/app/api/inventario/ajustes/route.ts` | D/A/B | registrar_ajuste() | zod | idem_key en SQL | Contrato; inventario-control.mjs |  |
| E-091 | `/api/inventario/conteos` | POST | `src/app/api/inventario/conteos/route.ts` | D/A/B | iniciar_conteo() | zod | natural (un conteo abierto por sede) | Contrato; inventario-control.mjs |  |
| E-092 | `/api/inventario/conteos/[id]` | DELETE | `src/app/api/inventario/conteos/[id]/route.ts` | D/A | anular_conteo() | zod | natural | Contrato; inventario-control.mjs |  |
| E-093 | `/api/inventario/conteos/[id]` | GET | `src/app/api/inventario/conteos/[id]/route.ts` | D/A/B | — | uuid | n/a | Contrato; inventario-control.mjs |  |
| E-094 | `/api/inventario/conteos/[id]` | PATCH | `src/app/api/inventario/conteos/[id]/route.ts` | D/A/B | contar_conteo() | zod | no («sumar» repetido suma dos veces) | Contrato; inventario-control.mjs |  |
| E-095 | `/api/inventario/conteos/[id]/cerrar` | POST | `src/app/api/inventario/conteos/[id]/cerrar/route.ts` | D/A/B | cerrar_conteo() | zod | natural (estado) | Contrato; inventario-control.mjs |  |
| E-096 | `/api/inventario/costos` | PATCH | `src/app/api/inventario/costos/route.ts` | D/A | sinRLS: UPDATE lote_costos, auditoria | zod | natural | SIN contrato; ingresos.mjs, reportes-costos.mjs | Método ausente del contrato endpoints.mjs. |
| E-097 | `/api/inventario/costos` | POST | `src/app/api/inventario/costos/route.ts` | D/A | sinRLS: INSERT lote_costos ON CONFLICT DO NOTHING, auditoria | zod | natural | Contrato; ingresos.mjs |  |
| E-098 | `/api/inventario/cuarentena` | GET | `src/app/api/inventario/cuarentena/route.ts` | D/A/B | — | — | n/a | Contrato; precios-lotes.mjs |  |
| E-099 | `/api/inventario/cuarentena` | PATCH | `src/app/api/inventario/cuarentena/route.ts` | D/A | configurar_devoluciones() | zod | natural | Contrato; precios-lotes.mjs |  |
| E-100 | `/api/inventario/cuarentena` | POST | `src/app/api/inventario/cuarentena/route.ts` | D/A/B | poner_cuarentena() | zod | natural | Contrato; precios-lotes.mjs |  |
| E-101 | `/api/inventario/cuarentena/baja` | POST | `src/app/api/inventario/cuarentena/baja/route.ts` | D/A/B | registrar_ajuste() | zod | idem_key en SQL | Contrato; precios-lotes.mjs |  |
| E-102 | `/api/inventario/cuarentena/liberar` | POST | `src/app/api/inventario/cuarentena/liberar/route.ts` | D/A/B | liberar_cuarentena() | zod | natural | Contrato; precios-lotes.mjs |  |
| E-103 | `/api/inventario/exportar` | GET | `src/app/api/inventario/exportar/route.ts` | Sesión, CUALQUIER rol | — | — | n/a | Contrato; factura-carta.mjs, ubicacion.mjs | Sin comprobación de rol (l.9): vendedor/cajera descargan todo el inventario con precios. |
| E-104 | `/api/inventario/kardex` | GET | `src/app/api/inventario/kardex/route.ts` | D/A/B | — | query manual | n/a | Contrato; compras.mjs, inventario-control.mjs |  |
| E-105 | `/api/inventario/lotes` | GET | `src/app/api/inventario/lotes/route.ts` | D/A/B | — | query manual | n/a | Contrato; inventario-control.mjs, lotes-corregir.mjs |  |
| E-106 | `/api/inventario/lotes/[id]` | PATCH | `src/app/api/inventario/lotes/[id]/route.ts` | D/A/B | corregir_lote() | zod (vence sin fechaReal) | natural | Contrato; lotes-corregir.mjs |  |
| E-107 | `/api/invima` | POST | `src/app/api/invima/route.ts` | Cron (cronAutorizado) | sincronizarInvima → alertas_invima | sin cuerpo | natural | Contrato; **SIN prueba funcional** |  |
| E-108 | `/api/maestro` | GET | `src/app/api/maestro/route.ts` | Sesión, cualquier rol | — | query manual | n/a | Contrato; vía UI: gestion.mjs:129 |  |
| E-109 | `/api/pagos` | POST | `src/app/api/pagos/route.ts` | Público (mismoOrigen + limitador + limiteBD por correo) | sinRLS: pagos_suscripcion, correos | zod | no (cada intento crea orden) | Contrato; admin.mjs, ingresos.mjs, pagos.mjs | Crea una orden nueva por clic (l.31-34). |
| E-110 | `/api/pagos/estado` | GET | `src/app/api/pagos/estado/route.ts` | Público (limitador en memoria 60/min) | sinRLS: UPDATE pagos_suscripcion (confirmación Wompi/Stripe) | query manual (regex referencia) | natural (where estado='pendiente') | Contrato; pagos.mjs | GET público que ESCRIBE (l.24-30); se valida contra la API de Wompi. |
| E-111 | `/api/pagos/stripe` | POST | `src/app/api/pagos/stripe/route.ts` | Webhook (firma Stripe, tolerancia 5 min) | procesarEventoStripe → pagos_suscripcion | sin zod (JSON.parse tras firma, l.12) | natural por estado | Contrato; ingresos.mjs, pagos.mjs |  |
| E-112 | `/api/pagos/wompi` | POST | `src/app/api/pagos/wompi/route.ts` | Webhook (checksum Wompi + re-consulta API) | sinRLS: pagos_suscripcion | sin zod (cast, l.15) | natural (for update + estado) | Contrato; pagos.mjs | Checksum sin ventana de tiempo (lib/pagos-firma.ts:23-30), mitigado al re-consultar la transacción. |
| E-113 | `/api/pedidos` | GET | `src/app/api/pedidos/route.ts` | D/A/C/V (puedePedidos.armar) | — | query manual | n/a | Contrato; mostrador.mjs |  |
| E-114 | `/api/pedidos` | POST | `src/app/api/pedidos/route.ts` | D/A/C/V | guardar_pedido() | zod (PedidoEntrada) | NO | Contrato; mostrador.mjs | Doble clic crea dos pedidos. |
| E-115 | `/api/pedidos/[id]` | GET | `src/app/api/pedidos/[id]/route.ts` | D/A/C/V | — | uuid | n/a | Contrato; mostrador.mjs |  |
| E-116 | `/api/pedidos/[id]` | PATCH | `src/app/api/pedidos/[id]/route.ts` | D/A/C/V | cambiar_estado_pedido() / guardar_pedido() | zod | natural | Contrato; mostrador.mjs | No comprueba modo interno. |
| E-117 | `/api/pedidos/[id]/cobrar` | POST | `src/app/api/pedidos/[id]/cobrar/route.ts` | D/A/C (puedePedidos.cobrar) | registrar_venta() + cobrar_pedido() + DIAN | zod (Venta) | idem_key (uuid obligatoria) en SQL | Contrato; mostrador.mjs |  |
| E-118 | `/api/precios` | GET | `src/app/api/precios/route.ts` | D/A | — | — | n/a | Contrato; precios-lotes.mjs |  |
| E-119 | `/api/precios` | POST | `src/app/api/precios/route.ts` | D/A | aplicar_cambio_precios(simular=false) | zod + firma de vista previa | idem_key en SQL | Contrato; precios-lotes.mjs | No en demo. |
| E-120 | `/api/precios/[id]` | GET | `src/app/api/precios/[id]/route.ts` | D/A | — | uuid | n/a | Contrato; precios-lotes.mjs |  |
| E-121 | `/api/precios/[id]/revertir` | POST | `src/app/api/precios/[id]/revertir/route.ts` | D/A | revertir_cambio_precios() | zod | natural | Contrato; precios-lotes.mjs |  |
| E-122 | `/api/precios/vista-previa` | POST | `src/app/api/precios/vista-previa/route.ts` | D/A | aplicar_cambio_precios(simular=true) — no escribe | zod | n/a | Contrato; precios-lotes.mjs |  |
| E-123 | `/api/productos` | GET | `src/app/api/productos/route.ts` | Sesión, cualquier rol (leerSesion propio) | — | query manual | n/a | Contrato; admin.mjs, auditoria.mjs, caja.mjs (+13) | Fuera de conSesion: las ramas búsqueda/vencen no fijan Cache-Control (l.12-65). |
| E-124 | `/api/productos` | POST | `src/app/api/productos/route.ts` | D/A | INSERT productos (RLS), guardarUbicacion, entrarExistencia→registrar_entrada | zod | NO (sin EAN, doble clic duplica) | Contrato; admin.mjs, descuentos.mjs, devoluciones.mjs (+8) |  |
| E-125 | `/api/productos/[id]` | PATCH | `src/app/api/productos/[id]/route.ts` | D/A | UPDATE productos (RLS), registrar_entrada | zod (rama activo=false sin zod, l.16-19) | natural | Contrato; resultados.mjs |  |
| E-126 | `/api/productos/[id]/codigos` | DELETE | `src/app/api/productos/[id]/codigos/route.ts` | D/A/B | quitar_codigo_producto() | zod | natural | Contrato; precios-lotes.mjs |  |
| E-127 | `/api/productos/[id]/codigos` | GET | `src/app/api/productos/[id]/codigos/route.ts` | D/A/B | — | uuid | n/a | Contrato; precios-lotes.mjs |  |
| E-128 | `/api/productos/[id]/codigos` | POST | `src/app/api/productos/[id]/codigos/route.ts` | D/A/B | agregar_codigo_producto() | zod | natural (único) | Contrato; precios-lotes.mjs |  |
| E-129 | `/api/productos/[id]/ubicacion` | PUT | `src/app/api/productos/[id]/ubicacion/route.ts` | D/A/B | guardarUbicacion → cambiar_ubicacion() | zod | natural | Contrato; ubicacion.mjs |  |
| E-130 | `/api/productos/alternativas` | GET | `src/app/api/productos/alternativas/route.ts` | D/A/C | — | uuid | n/a | Contrato; facturacion.mjs |  |
| E-131 | `/api/productos/importar` | POST | `src/app/api/productos/importar/route.ts` | D/A | INSERT/UPDATE productos masivo + registrar_entrada() | zod parcial (filas = record<unknown>, luego leerFilas) | idem_key en SQL + candado | Contrato; gestion.mjs, precios-lotes.mjs, ubicacion.mjs | Auditoría fuera de la tx con sinRLS y error tragado (l.145-146). |
| E-132 | `/api/proveedores` | GET | `src/app/api/proveedores/route.ts` | D/A/B | — | uuid | n/a | Contrato; compras.mjs, dian-soporte.mjs |  |
| E-133 | `/api/proveedores` | PATCH | `src/app/api/proveedores/route.ts` | D/A | UPDATE proveedores (columnas dinámicas de claves zod) | zod | natural | Contrato; compras.mjs |  |
| E-134 | `/api/proveedores` | POST | `src/app/api/proveedores/route.ts` | D/A/B | INSERT proveedores (RLS) | zod | natural (nombre único) | Contrato; compras.mjs, dian-soporte.mjs |  |
| E-135 | `/api/recibos` | GET | `src/app/api/recibos/route.ts` | D/A/C | — | query manual | n/a | Contrato; cuentas-clientes.mjs, seguridad.mjs |  |
| E-136 | `/api/recibos` | POST | `src/app/api/recibos/route.ts` | D/A/C | registrar_recibo() | zod | idem_key (idempotente()) | Contrato; cuentas-clientes.mjs, seguridad.mjs |  |
| E-137 | `/api/recibos/[id]` | DELETE | `src/app/api/recibos/[id]/route.ts` | D/A | anular_recibo() | zod | natural | Contrato; cuentas-clientes.mjs |  |
| E-138 | `/api/reportes` | GET | `src/app/api/reportes/route.ts` | D/A (leerSesion propio) | — | query manual | n/a | Contrato; migracion.mjs, reportes.mjs, resultados.mjs |  |
| E-139 | `/api/reportes/cierre` | GET | `src/app/api/reportes/cierre/route.ts` | D/A | — | query manual | n/a | Contrato; resultados.mjs |  |
| E-140 | `/api/reportes/iva` | GET | `src/app/api/reportes/iva/route.ts` | D/A | — | query manual | n/a | Contrato; resultados.mjs |  |
| E-141 | `/api/reportes/resultados` | GET | `src/app/api/reportes/resultados/route.ts` | D/A | — | query manual | n/a | Contrato; resultados.mjs |  |
| E-142 | `/api/restablecer` | POST | `src/app/api/restablecer/route.ts` | Público (mismoOrigen + limitador + limiteBD) | sinRLS: invitaciones, correos | zod | n/a | Contrato; admin.mjs | Tiempo de respuesta constante. |
| E-143 | `/api/sesion` | DELETE | `src/app/api/sesion/route.ts` | Público (mismoOrigen) | sesiones_cerradas | sin cuerpo | natural | Contrato; seguridad.mjs |  |
| E-144 | `/api/sesion` | POST | `src/app/api/sesion/route.ts` | Público (solo si demoActiva; mismoOrigen + JSON) | cookie de sesión demo; demo_visitas | manual (lista blanca de 3 uid) | n/a | Contrato; admin.mjs | Sin zod pero con lista blanca (l.19). |
| E-145 | `/api/suscripcion` | POST | `src/app/api/suscripcion/route.ts` | Solo dueño | Stripe (cancelar) + sinRLS: pagos_suscripcion, auditoria, correos | sin cuerpo | natural | Contrato; **SIN prueba funcional** |  |
| E-146 | `/api/tareas` | POST | `src/app/api/tareas/route.ts` | Cron (REGENTA_CRON_KEY, propia copia de cronAutorizado) | correos, documentos_dian, pagos, borra intentos/invitaciones/sesiones/idem, purgar_visitas_demo | sin cuerpo | natural | Contrato; admin.mjs, anexo13.mjs, ingresos.mjs (+2) | Reimplementa cronAutorizado (l.15-21). |
| E-147 | `/api/temperatura` | GET | `src/app/api/temperatura/route.ts` | D/A/B | — | query manual | n/a | Contrato; cumplimiento.mjs |  |
| E-148 | `/api/temperatura` | PATCH | `src/app/api/temperatura/route.ts` | D/A | configurar_rango_temperatura() | zod | natural | Contrato; cumplimiento.mjs |  |
| E-149 | `/api/temperatura` | POST | `src/app/api/temperatura/route.ts` | D/A/B | registrar_temperatura() | zod | natural (jornada/área) | Contrato; cumplimiento.mjs |  |
| E-150 | `/api/turnos` | GET | `src/app/api/turnos/route.ts` | Sesión, CUALQUIER rol | — | — | n/a | Contrato; cajas.mjs, compras.mjs, cuentas-clientes.mjs (+3) | Devuelve efectivo_esperado a la cajera: rompe el cierre ciego (src/lib/turnos.ts:12). |
| E-151 | `/api/turnos` | POST | `src/app/api/turnos/route.ts` | D/A/C (cajera solo su caja) | abrir_turno(), movimiento_caja(), cerrar_turno(), exigir_turno() | zod | movimiento: idem_key (idempotente()); abrir/cerrar: natural | Contrato; cajas.mjs, compras.mjs, cuentas-clientes.mjs (+3) |  |
| E-152 | `/api/ventas` | POST | `src/app/api/ventas/route.ts` | D/A/C (puede.vender) | registrar_venta() + emitirDocumento (DIAN) | zod (Venta) | idem_key (uuid obligatoria) en SQL | Contrato; caja.mjs, cajas.mjs, control-especial.mjs (+16) |  |
| E-153 | `/api/ventas/[id]` | DELETE | `src/app/api/ventas/[id]/route.ts` | Sesión; rol lo decide SOLO la BD (anular_venta: D/A) | anular_venta() + procesarCola | zod | natural (estado) | Contrato; control-especial.mjs, cumplimiento.mjs, devoluciones.mjs (+1) | Sin comprobación de rol en la ruta (l.9-18). |
| E-154 | `/api/ventas/[id]/devolucion` | GET | `src/app/api/ventas/[id]/devolucion/route.ts` | D/A | — | — | n/a | Contrato; cumplimiento.mjs, devoluciones.mjs, ia.mjs (+3) |  |
| E-155 | `/api/ventas/[id]/devolucion` | POST | `src/app/api/ventas/[id]/devolucion/route.ts` | D/A (puede.anular) | devolver_venta() + procesarCola | zod | idem_key (idempotente()) | Contrato; cumplimiento.mjs, devoluciones.mjs, ia.mjs (+3) |  |
| E-156 | `/api/ventas/[id]/reenviar` | POST | `src/app/api/ventas/[id]/reenviar/route.ts` | D/A | sinRLS: UPDATE documentos_dian, auditoria + procesarCola | sin cuerpo | natural (estado) | Contrato; vía UI: cumplimiento.mjs:119 (a confirmar) |  |
| E-157 | `/api/ventas/historial/exportar` | GET | `src/app/api/ventas/historial/exportar/route.ts` | D/A | — | query (leerFiltro) | n/a | Contrato; migracion.mjs |  |
| E-158 | `/demo` | GET | `src/app/demo/route.ts` | Público | — | — | n/a | SIN contrato; auditoria.mjs, cajas.mjs, dispositivos.mjs (+4) | HTML mínimo; fuera del contrato endpoints.mjs. |
| E-159 | `/demo` | POST | `src/app/demo/route.ts` | Público (demoActiva + mismoOrigen + limiteBD 40/h) | cookie de sesión demo; demo_visitas | manual (form, rol en lista) | n/a | SIN contrato; auditoria.mjs, cajas.mjs, dispositivos.mjs (+4) | Fuera del contrato endpoints.mjs. |
| E-160 | `/favicon.ico` | GET | `src/app/favicon.ico/route.ts` | Público | — | — | n/a | SIN contrato; **SIN prueba funcional** | Redirección 308. |

## 2. Páginas (102 `page.tsx`)

Rol = guarda del servidor en la propia página (`redirect` si no cumple). Las de `(app)` además exigen sesión en `src/app/(app)/layout.tsx:23`; las de `/admin` en `src/app/admin/layout.tsx:18-25` + `exigirAdmin()`.

| Identificador | Ruta | Tipo | Componente/Archivo | Rol | Escribe vía | Validación | Idempotencia | Test que la cubre | Observación |
|---|---|---|---|---|---|---|---|---|---|
| P-001 | `/` | Pública | `src/app/page.tsx` · ChatDemo, Calculadora, FormDemo, BotonDemo, HeroProducto, Desfile, Sello, IncluyeTodo, Cum | Público | lectura: mesAnual | — | — | auditoria.mjs, demo-visitas.mjs, dispositivos.mjs (+2) |  |
| P-002 | `/activar` | Pública | `src/app/activar/page.tsx` · Activar, PedirNuevo | Público (token) | lectura: [sinRLS] invitaciones, superadmins; hashToken | — | — | consola-clave.mjs, ingresos.mjs |  |
| P-003 | `/admin` | Consola | `src/app/admin/page.tsx` · Accion | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] alertas_invima, cargos_documentos, documentos_dian, empresas, pagos_suscripcion, resoluciones_dian… | — | — | admin.mjs, consola-clave.mjs, demo-visitas.mjs (+6) |  |
| P-004 | `/admin/activar` | Consola | `src/app/admin/activar/page.tsx` · — (solo servidor) | Público (token) | lectura: [sinRLS] invitaciones, superadmins; hashToken | — | — | consola-clave.mjs |  |
| P-005 | `/admin/bitacora` | Consola | `src/app/admin/bitacora/page.tsx` · — (solo servidor) | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] admin_eventos, cuentas, empresas | — | — | admin.mjs, dispositivos.mjs |  |
| P-006 | `/admin/clientes` | Consola | `src/app/admin/clientes/page.tsx` · Accion | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] cuentas, empresas, miembros, ventas | — | — | admin.mjs, dian-soporte.mjs, dispositivos.mjs (+3) |  |
| P-007 | `/admin/clientes/[id]` | Consola | `src/app/admin/clientes/[id]/page.tsx` · Usuarios, Nota, Habilitacion, Migracion, Facturacion, Eliminar, Fiscal, PagoManual, Accion | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] admin_eventos, cuentas, documentos_dian, empresas, miembros, pagos_suscripcion… | — | — | admin.mjs, dian-soporte.mjs, dispositivos.mjs (+3) |  |
| P-008 | `/admin/clientes/nuevo` | Consola | `src/app/admin/clientes/nuevo/page.tsx` · NuevoCliente | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] pagos_suscripcion, solicitudes_demo | — | — | admin.mjs, dispositivos.mjs |  |
| P-009 | `/admin/correos` | Consola | `src/app/admin/correos/page.tsx` · Accion | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] correos, correos_bajas | — | — | admin.mjs, dispositivos.mjs |  |
| P-010 | `/admin/demo` | Consola | `src/app/admin/demo/page.tsx` · — (solo servidor) | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] demo_eventos, demo_visitas, solicitudes_demo | — | — | demo-visitas.mjs, dispositivos.mjs |  |
| P-011 | `/admin/demo/[id]` | Consola | `src/app/admin/demo/[id]/page.tsx` · — (solo servidor) | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] demo_eventos, demo_visitas, solicitudes_demo | — | — | demo-visitas.mjs |  |
| P-012 | `/admin/dos-pasos` | Consola | `src/app/admin/dos-pasos/page.tsx` · ActivarDosPasos | Superadmin (también «inscribir»; solo si 2FA activa) | lectura: [sinRLS] cuentas; cifrar, descifrar, dosPasosActivos, nuevoSecretoTotp | — | — | admin.mjs | 2FA de consola apagada salvo REGENTA_ADMIN_DOS_PASOS=1. |
| P-013 | `/admin/entrar` | Consola | `src/app/admin/entrar/page.tsx` · — (solo servidor) | Público (redirige si ya hay sesión de consola) | lectura: leerAdmin | — | — | admin.mjs, demo-visitas.mjs, dian-soporte.mjs (+1) |  |
| P-014 | `/admin/pagos` | Consola | `src/app/admin/pagos/page.tsx` · Accion, FacturaPago | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] cargos_documentos, empresas, pagos_suscripcion; nitSinDv | — | — | admin.mjs, dispositivos.mjs, ingresos.mjs |  |
| P-015 | `/admin/sistema` | Consola | `src/app/admin/sistema/page.tsx` · Accion | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] alertas_invima, cuentas, documentos_dian, empresas, productos, regenta_migraciones… | — | — | admin.mjs, dispositivos.mjs |  |
| P-016 | `/admin/solicitudes` | Consola | `src/app/admin/solicitudes/page.tsx` · Accion | Superadmin (layout + exigirAdmin) | lectura: [sinRLS] solicitudes_demo | — | — | admin.mjs, dispositivos.mjs |  |
| P-017 | `/alertas` | App | `src/app/(app)/alertas/page.tsx` · Revisar | Sesión, CUALQUIER rol (gestiona D/A/B) | lectura: [RLS] alertas_empresa, alertas_invima | — | — | auditoria.mjs, demo-visitas.mjs, dispositivos.mjs (+2) | El menú lo oculta al vendedor (Navegacion.tsx:22) pero la página no lo rechaza. |
| P-018 | `/ayuda` | App | `src/app/(app)/ayuda/page.tsx` · VideoGuia | Sesión (layout), cualquier rol | lectura: estático | — | — | **SIN test** | Sin test. |
| P-019 | `/baja` | Pública | `src/app/baja/page.tsx` · BotonBaja | Público (token firmado) | lectura: leerTokenBaja | — | — | admin.mjs, parametros.mjs |  |
| P-020 | `/bitacora` | App | `src/app/(app)/bitacora/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] miembros; bitacora, filtroBitacora | — | — | auditoria.mjs, dispositivos.mjs, parametros.mjs (+2) |  |
| P-021 | `/caja` | App | `src/app/(app)/caja/page.tsx` · Caja, ElegirCaja | D/A/C (vendedor→/pedidos; modo interno→/entregas) | lectura: [RLS] cajas, empresas, resoluciones_dian, turnos; modoDe | — | — | admin.mjs, auditoria.mjs, caja.mjs (+14) | Única pantalla que comprueba el modo interno en servidor (l.18). |
| P-022 | `/cartera` | App | `src/app/(app)/cartera/page.tsx` · Abonar, Valor, MoraBloqueo | D/A | lectura: [RLS] empresas, v_cartera; carteraPorCliente, esEdad | — | — | auditoria.mjs, cuentas-clientes.mjs, dispositivos.mjs (+3) |  |
| P-023 | `/clientes` | App | `src/app/(app)/clientes/page.tsx` · EditarCliente | D/A | lectura: [RLS] clientes, v_cartera, ventas, ventas_externas | — | — | cuentas-clientes.mjs, dispositivos.mjs, ingresos.mjs (+2) |  |
| P-024 | `/clientes/[id]` | App | `src/app/(app)/clientes/[id]/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] empresas, ventas_externas; estadoCuenta, normalizarCredito, permisoCartera, whatsappEstado | — | — | cuentas-clientes.mjs, migracion.mjs |  |
| P-025 | `/compras` | App | `src/app/(app)/compras/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] proveedores, v_recepciones; listaCompras, fechaReal | — | — | auditoria.mjs, compras-factura.mjs, compras.mjs (+5) |  |
| P-026 | `/compras/[id]` | App | `src/app/(app)/compras/[id]/page.tsx` · Compra, Soporte | D/A | lectura: [RLS] detalleCompra, estadoSoporte | — | — | auditoria.mjs, compras-factura.mjs, compras.mjs (+4) |  |
| P-027 | `/compras/nueva` | App | `src/app/(app)/compras/nueva/page.tsx` · NuevaCompra | D/A | lectura: [RLS] proveedores | — | — | auditoria.mjs, compras-factura.mjs, compras.mjs (+2) |  |
| P-028 | `/contratar` | Pública | `src/app/contratar/page.tsx` · FormContratar, Sello | Público | lectura: qrActivo, stripeActivo, wompiActivo | — | — | admin.mjs, dispositivos.mjs, embudo.mjs (+2) |  |
| P-029 | `/contratar/resultado` | Pública | `src/app/contratar/resultado/page.tsx` · Resultado | Público | lectura: estático | — | — | admin.mjs, pagos.mjs |  |
| P-030 | `/control-especial` | App | `src/app/(app)/control-especial/page.tsx` · Ajustes, AvisoPlazo, Pestanas | D/A | lectura: [RLS] empresas; datosLibro, estadoPlazo | — | — | anexo13.mjs, auditoria.mjs, control-especial.mjs (+3) |  |
| P-031 | `/control-especial/anexo-13` | App | `src/app/(app)/control-especial/anexo-13/page.tsx` · Descargar, Presentar | D/A | lectura: [RLS] empresas; detiene, estadoPlazo, informeMes, informesPresentados | — | — | anexo13.mjs, auditoria.mjs |  |
| P-032 | `/control-especial/anexo-13/imprimir` | Imprimible | `src/app/control-especial/anexo-13/imprimir/page.tsx` · Imprimir | D/A | lectura: [RLS] informeMes, moduloListo, recetariosMes | — | — | anexo13.mjs |  |
| P-033 | `/control-especial/fichas` | App | `src/app/(app)/control-especial/fichas/page.tsx` · Configuracion, Fichas | D/A | lectura: [RLS] empresas; leerConfig, moduloListo, productosAnexo | — | — | anexo13.mjs, auditoria.mjs |  |
| P-034 | `/control-especial/informe` | Imprimible | `src/app/control-especial/informe/page.tsx` · Imprimir | D/A | lectura: [RLS] empresas, sedes; datosLibro | — | — | control-especial.mjs |  |
| P-035 | `/control-especial/libro-completo` | App | `src/app/(app)/control-especial/libro-completo/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] estadoPlazo, libroCompleto, moduloListo, sedes | — | — | anexo13.mjs, auditoria.mjs |  |
| P-036 | `/cuenta` | App | `src/app/(app)/cuenta/page.tsx` · MiCuenta | Sesión, cualquier rol | lectura: [sinRLS] cuentas, empresas | — | — | auditoria.mjs, dispositivos.mjs |  |
| P-037 | `/cuentas-por-pagar` | App | `src/app/(app)/cuentas-por-pagar/page.tsx` · CuentasPorPagar | D/A | lectura: [RLS] cuentasPorPagar | — | — | auditoria.mjs, compras.mjs, dispositivos.mjs |  |
| P-038 | `/demo/gracias` | Pública | `src/app/demo/gracias/page.tsx` · BotonDemo, FormDemo, Oferta, Sello | Público | lectura: estático | — | — | auditoria.mjs, embudo.mjs |  |
| P-039 | `/documentos` | App | `src/app/(app)/documentos/page.tsx` · ReenviarDoc, ReenviarTodos | D/A | lectura: [RLS] consultaDian, contarDocumentos, leerFiltro, listarDocumentos, qs, resta, reenvio | — | — | auditoria.mjs, cumplimiento.mjs, dian-soporte.mjs (+2) |  |
| P-040 | `/documentos/nota-debito/[id]` | App | `src/app/(app)/documentos/nota-debito/[id]/page.tsx` · NotaDebito | D/A | lectura: [RLS] empresas; facturaParaNotaDebito | — | — | dian-soporte.mjs |  |
| P-041 | `/entrar` | Pública | `src/app/entrar/page.tsx` · EntrarDemo, FormAcceso | Público | lectura: demoActiva | — | — | admin.mjs, anexo13.mjs, caja.mjs (+30) |  |
| P-042 | `/entregas` | App | `src/app/(app)/entregas/page.tsx` · — (solo servidor) | D/A/C/B | lectura: [RLS] existenciasTexto, atajos, modoDe, numeroEntrega, consumo, listaEntregas | — | — | modo-interno.mjs |  |
| P-043 | `/entregas/[id]` | App | `src/app/(app)/entregas/[id]/page.tsx` · Anular, ComprobanteEntrega | D/A/C/B | lectura: [RLS] numeroEntrega, detalleEntrega | — | — | modo-interno.mjs |  |
| P-044 | `/entregas/[id]/imprimir` | Imprimible | `src/app/entregas/[id]/imprimir/page.tsx` · BotonImprimir, ComprobanteEntrega | D/A/C/B | lectura: [RLS] detalleEntrega | — | — | modo-interno.mjs |  |
| P-045 | `/entregas/nueva` | App | `src/app/(app)/entregas/nueva/page.tsx` · NuevaEntrega | D/A/C/B | lectura: [RLS] empresas; modoDe | — | — | modo-interno.mjs |  |
| P-046 | `/equipo` | App | `src/app/(app)/equipo/page.tsx` · Equipo, Configuracion, Renovacion, Cajas, SubirLogo, FormatoFactura | Solo dueño | lectura: [sinRLS] cajas, cargos_documentos, cuentas, documentos_dian, empresas, miembros…; suscripcionStripe, limite, datosQr | — | — | admin.mjs, dispositivos.mjs, factura-carta.mjs (+1) |  |
| P-047 | `/etiquetas` | App | `src/app/(app)/etiquetas/page.tsx` · Etiquetas | D/A/B | lectura: [RLS] productosEtiquetas | — | — | auditoria.mjs, dispositivos.mjs, precios-lotes.mjs |  |
| P-048 | `/funciones` | Pública | `src/app/funciones/page.tsx` · BotonDemo | Público | lectura: estático | — | — | dispositivos.mjs, gestion.mjs |  |
| P-049 | `/funciones/[ruta]` | Pública | `src/app/funciones/[ruta]/page.tsx` · PaginaProducto | Público | lectura: estático | — | — | gestion.mjs |  |
| P-050 | `/gastos` | App | `src/app/(app)/gastos/page.tsx` · Gastos | D/A | lectura: [RLS] cajas, turnos; filtroGastos, listaGastos | — | — | auditoria.mjs, dispositivos.mjs, parametros.mjs (+1) |  |
| P-051 | `/guias` | Pública | `src/app/guias/page.tsx` · — (solo servidor) | Público | lectura: estático | — | — | dispositivos.mjs, gestion.mjs |  |
| P-052 | `/guias/[slug]` | Pública | `src/app/guias/[slug]/page.tsx` · BotonDemo | Público | lectura: estático | — | — | **SIN test** | Sin test directo (gestion.mjs recorre enlaces /guias/ dinámicamente). |
| P-053 | `/informes/temperatura` | Imprimible | `src/app/informes/temperatura/page.tsx` · Botones | D/A/B | lectura: [RLS] empresas, sedes; datosMes, celdas, dec | — | — | cumplimiento.mjs |  |
| P-054 | `/inicio` | App | `src/app/(app)/inicio/page.tsx` · InicioInterno, EstadoDian, PreguntarIA | Sesión, cualquier rol (contenido por rol) | lectura: [RLS] alertas_empresa, devoluciones, documentos_dian, empresas, miembros, p…; saludoPersonal, resultados, modoDe | — | — | admin.mjs, auditoria.mjs, demo-visitas.mjs (+9) |  |
| P-055 | `/inventario` | App | `src/app/(app)/inventario/page.tsx` · EditarUbicacion, CostosPendientes | Sesión, CUALQUIER rol (sin guarda) | lectura: [RLS] compra_lineas, compras, conteos, lote_costos, movimientos, productos…; ubicacionSql | — | — | auditoria.mjs, caja.mjs, compras.mjs (+12) | El menú lo oculta al vendedor (Navegacion.tsx:26) pero la página no lo rechaza; botón Excel para todos (l.110). |
| P-056 | `/inventario/actas/[id]` | App | `src/app/(app)/inventario/actas/[id]/page.tsx` · — (solo servidor) | D/A/B | lectura: [RLS] ajuste_lineas, ajustes, conteos, empresas, lote_costos, lotes…; llevaActa, nombreMotivo | — | — | inventario-control.mjs |  |
| P-057 | `/inventario/ajustes` | App | `src/app/(app)/inventario/ajustes/page.tsx` · Ajustar | D/A/B | lectura: [RLS] ajuste_lineas, ajustes, conteos, lote_costos, miembros, productos; llevaActa, nombreMotivo | — | — | dispositivos.mjs, inventario-control.mjs, parametros.mjs |  |
| P-058 | `/inventario/conteos` | App | `src/app/(app)/inventario/conteos/page.tsx` · IniciarConteo | D/A/B | lectura: [RLS] ajustes, conteo_lineas, conteos, miembros, productos, v_stock_lotes | — | — | dispositivos.mjs, inventario-control.mjs, parametros.mjs |  |
| P-059 | `/inventario/conteos/[id]` | App | `src/app/(app)/inventario/conteos/[id]/page.tsx` · Contar, AnularConteo | D/A/B | lectura: [RLS] ajustes, conteos; lineasConteo, pesosConSigno as pesos | — | — | inventario-control.mjs |  |
| P-060 | `/inventario/conteos/[id]/informe` | App | `src/app/(app)/inventario/conteos/[id]/informe/page.tsx` · — (solo servidor) | D/A/B | lectura: [RLS] ajustes, conteos, empresas, miembros, sedes; lineasConteo, pesosConSigno | — | — | inventario-control.mjs |  |
| P-061 | `/inventario/cuarentena` | App | `src/app/(app)/inventario/cuarentena/page.tsx` · Cuarentena | D/A/B | lectura: [RLS] empresas; lotesSeparados | — | — | auditoria.mjs, dispositivos.mjs, precios-lotes.mjs |  |
| P-062 | `/inventario/lotes` | App | `src/app/(app)/inventario/lotes/page.tsx` · CorregirLotes | D/A/B | lectura: [RLS] productos, v_stock_lotes | — | — | lotes-corregir.mjs |  |
| P-063 | `/inventario/recibir` | App | `src/app/(app)/inventario/recibir/page.tsx` · — (solo servidor) | D/A/B (redirige a /compras/nueva) | lectura: estático | — | — | auditoria.mjs, compras.mjs, dispositivos.mjs (+1) |  |
| P-064 | `/para` | Pública | `src/app/para/page.tsx` · IndiceSilo | Público | lectura: estático | — | — | gestion.mjs |  |
| P-065 | `/para/[ruta]` | Pública | `src/app/para/[ruta]/page.tsx` · PaginaProducto | Público | lectura: estático | — | — | gestion.mjs |  |
| P-066 | `/pedidos` | App | `src/app/(app)/pedidos/page.tsx` · TarjetaPedido | D/A/C/V | lectura: [RLS] empresas; contarPedidos, leerFiltroPedidos, listarPedidos | — | — | auditoria.mjs, dispositivos.mjs, mostrador.mjs (+1) | No comprueba modo interno (solo oculto en menú, Navegacion.tsx:45). |
| P-067 | `/pedidos/[id]` | App | `src/app/(app)/pedidos/[id]/page.tsx` · — (solo servidor) | D/A/C/V | lectura: [RLS] empresas; etiquetaPedido, detallePedido | — | — | auditoria.mjs, dispositivos.mjs, mostrador.mjs |  |
| P-068 | `/pedidos/nuevo` | App | `src/app/(app)/pedidos/nuevo/page.tsx` · — (solo servidor) | D/A/C/V | lectura: [RLS] empresas | — | — | auditoria.mjs, dispositivos.mjs, mostrador.mjs |  |
| P-069 | `/por-que-regenta` | Pública | `src/app/por-que-regenta/page.tsx` · BotonDemo | Público | lectura: estático | — | — | dispositivos.mjs, gestion.mjs |  |
| P-070 | `/precios` | Pública | `src/app/precios/page.tsx` · Cambiate, BotonDemo, CalculadoraSocio, IncluyeTodo, Cumplimiento, Oferta, BarraOferta | Público | lectura: mesAnual | — | — | demo-visitas.mjs, dispositivos.mjs, embudo.mjs (+1) |  |
| P-071 | `/prediccion` | App | `src/app/(app)/prediccion/page.tsx` · Pedido | D/A/B | lectura: [RLS] lote_costos, patron_semanal, prediccion_productos, riesgo_vencimiento, v_stock_lotes, ventas | — | — | auditoria.mjs, demo-visitas.mjs, dispositivos.mjs (+3) |  |
| P-072 | `/privacidad` | Pública | `src/app/privacidad/page.tsx` · — (solo servidor) | Público | lectura: estático | — | — | dispositivos.mjs |  |
| P-073 | `/productos` | App | `src/app/(app)/productos/page.tsx` · — (solo servidor) | Sesión, CUALQUIER rol (sin guarda) | lectura: [RLS] productos, v_stock_vigente | — | — | auditoria.mjs, control-especial.mjs, dispositivos.mjs (+8) | El menú lo oculta al vendedor (Navegacion.tsx:14) pero la página no lo rechaza. |
| P-074 | `/productos/[id]` | App | `src/app/(app)/productos/[id]/page.tsx` · Kardex, Codigos, ProductoForm | D/A/B | lectura: [RLS] producto_codigos, productos, v_stock_vigente | — | — | auditoria.mjs, control-especial.mjs, dispositivos.mjs (+6) |  |
| P-075 | `/productos/importar` | App | `src/app/(app)/productos/importar/page.tsx` · Importar | D/A | lectura: estático | — | — | auditoria.mjs, dispositivos.mjs, gestion.mjs |  |
| P-076 | `/productos/nuevo` | App | `src/app/(app)/productos/nuevo/page.tsx` · ProductoForm | D/A | lectura: estático | — | — | auditoria.mjs, dispositivos.mjs, gestion.mjs (+1) |  |
| P-077 | `/productos/precios` | App | `src/app/(app)/productos/precios/page.tsx` · CambioMasivo | D/A | lectura: [RLS] compra_lineas, compras, productos, proveedores; historialPrecios | — | — | auditoria.mjs, dispositivos.mjs, precios-lotes.mjs |  |
| P-078 | `/productos/precios/[id]` | App | `src/app/(app)/productos/precios/[id]/page.tsx` · DetalleCambio | D/A | lectura: [RLS] detallePrecios | — | — | precios-lotes.mjs |  |
| P-079 | `/proveedores` | App | `src/app/(app)/proveedores/page.tsx` · Proveedores | D/A | lectura: [RLS] listaProveedores | — | — | auditoria.mjs, compras.mjs, dispositivos.mjs |  |
| P-080 | `/proveedores/[id]` | App | `src/app/(app)/proveedores/[id]/page.tsx` · Ficha | D/A | lectura: [RLS] compras, pago_aplicaciones, pagos_proveedor; nombreMedio, cuentasPorPagar, listaCompras, listaProveedores | — | — | compras.mjs |  |
| P-081 | `/recibo/[ref]` | Imprimible | `src/app/recibo/[ref]/page.tsx` · Botones | Solo dueño | lectura: [sinRLS] empresas, pagos_suscripcion | — | — | admin.mjs |  |
| P-082 | `/reportes` | App | `src/app/(app)/reportes/page.tsx` · Pestanas, CostosPorRevisar | D/A | lectura: [RLS] atajos as rangosRapidos, datosReporte | — | — | auditoria.mjs, dispositivos.mjs, migracion.mjs (+4) |  |
| P-083 | `/reportes/cierre` | App | `src/app/(app)/reportes/cierre/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] cierreDia | — | — | auditoria.mjs, dispositivos.mjs, resultados.mjs |  |
| P-084 | `/reportes/iva` | App | `src/app/(app)/reportes/iva/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] auxiliarIva, sumaIva | — | — | auditoria.mjs, dispositivos.mjs, parametros.mjs (+1) |  |
| P-085 | `/reportes/resultados` | App | `src/app/(app)/reportes/resultados/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] nombreCategoria, lineasResultado, resultados | — | — | auditoria.mjs, dispositivos.mjs, parametros.mjs (+1) |  |
| P-086 | `/software` | Pública | `src/app/software/page.tsx` · IndiceSilo | Público | lectura: estático | — | — | visitas-demo.test.mjs, dispositivos.mjs, habilitacion.mjs |  |
| P-087 | `/software/[ruta]` | Pública | `src/app/software/[ruta]/page.tsx` · PaginaProducto | Público | lectura: estático | — | — | visitas-demo.test.mjs, habilitacion.mjs |  |
| P-088 | `/temperatura` | App | `src/app/(app)/temperatura/page.tsx` · Planilla, Rangos | D/A/B | lectura: [RLS] empresas, sedes; datosMes, jornadaActual | — | — | cumplimiento.mjs, dispositivos.mjs, parametros.mjs |  |
| P-089 | `/terminos` | Pública | `src/app/terminos/page.tsx` · — (solo servidor) | Público | lectura: estático | — | — | dispositivos.mjs |  |
| P-090 | `/tiquete/[id]` | Imprimible | `src/app/tiquete/[id]/page.tsx` · AutoImprimir | D/A/C | lectura: [RLS] cajas, clientes, documentos_dian, empresas, miembros, pagos… | — | — | compras.mjs, cuentas-clientes.mjs, cumplimiento.mjs (+6) |  |
| P-091 | `/tiquete/cotizacion/[id]` | Imprimible | `src/app/tiquete/cotizacion/[id]/page.tsx` · Barra | D/A/C/V | lectura: [RLS] empresas; etiquetaPedido, fechaCorta, netoLinea, textoCotizacion, detallePedido | — | — | mostrador.mjs |  |
| P-092 | `/tiquete/devolucion/[id]` | Imprimible | `src/app/tiquete/devolucion/[id]/page.tsx` · — (solo servidor) | D/A/C | lectura: [RLS] devolucion_lineas, devoluciones, documentos_dian, empresas, miembros, productos… | — | — | devoluciones.mjs |  |
| P-093 | `/tiquete/estado-cuenta/[id]` | Imprimible | `src/app/tiquete/estado-cuenta/[id]/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] empresas; estadoCuenta, permisoCartera | — | — | cuentas-clientes.mjs |  |
| P-094 | `/tiquete/factura/[id]` | Imprimible | `src/app/tiquete/factura/[id]/page.tsx` · — (solo servidor) | D/A/C | lectura: [RLS] auditoria, cajas, clientes, documentos_dian, empresas, lotes…; pesosEnLetras, consultaDian | — | — | factura-carta.mjs |  |
| P-095 | `/tiquete/recepcion/[id]` | Imprimible | `src/app/tiquete/recepcion/[id]/page.tsx` · — (solo servidor) | D/A/B | lectura: [RLS] empresas; detalleCompra | — | — | compras.mjs |  |
| P-096 | `/tiquete/recibo/[id]` | Imprimible | `src/app/tiquete/recibo/[id]/page.tsx` · — (solo servidor) | D/A/C | lectura: [RLS] cajas, clientes, empresas, miembros, recibos_caja; permisoCartera | — | — | cuentas-clientes.mjs |  |
| P-097 | `/tiquete/turno/[id]` | Imprimible | `src/app/tiquete/turno/[id]/page.tsx` · — (solo servidor) | D/A/C | lectura: [RLS] cajas, empresas, miembros, movimientos_caja, turnos | — | — | turnos.mjs |  |
| P-098 | `/turno` | App | `src/app/(app)/turno/page.tsx` · Turno, ElegirCaja | D/A | lectura: [RLS] cajas, miembros, turnos; estadoTurno | — | — | auditoria.mjs, cajas.mjs, cuentas-clientes.mjs (+3) | Pasa estado completo (con efectivo_esperado) al cliente aunque ciego={rol==='cajero'}: cierre ciego solo en el front (page.tsx:38). |
| P-099 | `/ventas` | App | `src/app/(app)/ventas/page.tsx` · EstadoDian | D/A | lectura: [RLS] documentos_dian, miembros, pagos, venta_lineas, ventas, ventas_externas | — | — | auditoria.mjs, control-especial.mjs, cumplimiento.mjs (+9) | No comprueba modo interno (solo menú); las ventas sí las bloquea el trigger 049. |
| P-100 | `/ventas/[id]` | App | `src/app/(app)/ventas/[id]/page.tsx` · Anular, Devolver, Reenviar, Abonos, Imprimir | D/A | lectura: [RLS] abonos, clientes, devolucion_lineas, devoluciones, documentos_dian, empresas… | — | — | control-especial.mjs, cumplimiento.mjs, devoluciones.mjs (+7) |  |
| P-101 | `/ventas/historial` | App | `src/app/(app)/ventas/historial/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] clientes, ventas_externas; documentosHistorial, leerFiltro, resumenHistorial, ventasRegenta | — | — | factura-carta.mjs, migracion.mjs, parametros.mjs (+1) |  |
| P-102 | `/ventas/historial/[id]` | App | `src/app/(app)/ventas/historial/[id]/page.tsx` · — (solo servidor) | D/A | lectura: [RLS] abonos, empresas, v_cartera, ventas, ventas_externas | — | — | migracion.mjs |  |

## 3. Tareas programadas

| Identificador | Ruta | Tipo | Componente/Archivo | Rol | Escribe vía | Validación | Idempotencia | Test que la cubre | Observación |
|---|---|---|---|---|---|---|---|---|---|
| T-001 | `netlify/functions/tareas.mjs` → `POST /api/tareas` | Cron Netlify `*/15 * * * *` (UTC) | `netlify/functions/tareas.mjs:13`; `src/app/api/tareas/route.ts` | `Bearer REGENTA_CRON_KEY` (≥24 car., comparación en tiempo constante) | Cada 15 min: `programarRecordatorios`, `enviarPendientes(80)`, `procesarCola(50)` (DIAN), limpieza (`intentos_acceso` >1 día, `invitaciones` vencidas >30 días, `sesiones_cerradas`, `operaciones_idem` >7 días), `purgar_visitas_demo()`. Cada hora (minuto <15 o `?operacion=1`): `revisarSuscripciones`, `sincronizarStripe`, `cancelarReemplazadas`, `aplicarBajadas`, `cobrarDocumentosExtra`, `avisarCupoDocumentos`, `avisarNumeraciones`, `avisarRechazos`, `avisarDemorados`, `avisarAnexo13`. Cada 6 h (o `?invima=1`): `sincronizarInvima` | sin cuerpo | cada paso aislado (`paso()`); DIAN con `skip locked` | endpoints.mjs:337-340 (clave correcta y casi igual); admin.mjs; anexo13.mjs | Requiere `REGENTA_URL` (o `URL`) y `REGENTA_CRON_KEY` en alcance Functions. Reimplementa `cronAutorizado` (route.ts:15-21). |
| T-002 | `POST /api/dian` | Cron (manual/externo) | `src/app/api/dian/route.ts` | `cronAutorizado` | `procesarCola(50)` | sin cuerpo | `skip locked` | Contrato; dian-soporte.mjs | Redundante con T-001. |
| T-003 | `POST /api/invima` | Cron (manual/externo) | `src/app/api/invima/route.ts` | `cronAutorizado` | `sincronizarInvima` → `alertas_invima` | sin cuerpo | natural | Contrato; **sin prueba funcional** | Redundante con T-001. |
| T-004 | `POST /api/admin/sistema` `{accion}` | Disparo manual desde la consola | `src/app/api/admin/sistema/route.ts` | Superadmin | `dian`, `invima`, `correos`, `matias` (prueba token), `probar_correo`, `ia` | zod | n/a | Contrato; vía UI admin.mjs:268 | — |
| T-005 | Envío inmediato tras la operación | En línea | `procesarCola(2..3, venta|documento)` en `ventas/[id]`, `ventas/[id]/devolucion`, `ventas/[id]/reenviar`, `documentos/[id]/reenviar`, `dian/*`; `emitirDocumento` en `ventas` y `pedidos/[id]/cobrar` | según ruta | `documentos_dian` | — | — | facturacion.mjs, cumplimiento.mjs, dian-soporte.mjs | Si el envío falla queda para T-001. |

`netlify.toml` solo fija `npm run build` y `NODE_VERSION=22`; las variables van en el panel de Netlify.

## 4. Webhooks e integraciones externas

| Identificador | Ruta | Tipo | Componente/Archivo | Rol | Escribe vía | Validación | Idempotencia | Test que la cubre | Observación |
|---|---|---|---|---|---|---|---|---|---|
| W-001 | `POST /api/pagos/wompi` | Webhook Wompi (`transaction.updated`) | `src/app/api/pagos/wompi/route.ts`; `src/lib/pagos-firma.ts:23` | checksum SHA-256 con `WOMPI_EVENTS_SECRET` | `pagos_suscripcion` + `alCambiarPago` (crea/reactiva cuenta, correos) | firma + re-consulta de la transacción a la API de Wompi (monto, moneda, referencia) | `for update` + máquina de estados (anulado final; aprobado solo → anulado); segundo cobro marcado `revisar` | Contrato; pagos.mjs; pagos.test.mjs | Sin ventana de tiempo para el `timestamp` (mitigado por la re-consulta). 503 si falta el secreto. |
| W-002 | `POST /api/pagos/stripe` | Webhook Stripe (opcional) | `src/app/api/pagos/stripe/route.ts`; `src/lib/pagos-firma.ts:34`; `src/lib/pagos-stripe.ts` | `Stripe-Signature` v1 HMAC con `STRIPE_WEBHOOK_SECRET`, tolerancia 300 s | `procesarEventoStripe` → `pagos_suscripcion` | firma; cuerpo con `JSON.parse` sin zod | por estado (sin registro de `event.id`) | Contrato; pagos.mjs; pagos.test.mjs | Sin secreto, los pagos se confirman al volver (`/api/pagos/estado`) y con la tarea horaria (`sincronizarStripe`). |
| W-003 | `GET /api/pagos/estado?ref&id` | Retorno de pasarela (público) | `src/app/api/pagos/estado/route.ts` | Público, limitador en memoria 60/min | `UPDATE pagos_suscripcion` si Wompi/Stripe confirman | regex de referencia | `where estado='pendiente'` | pagos.mjs:36,87 | GET que escribe. |
| W-004 | DIAN vía MATIAS (salida) | Cliente HTTP, sin webhook de entrada | `src/lib/dian/matias.ts`, `matias-cuenta.ts`, `index.ts:71` (`procesarCola`) | — | `documentos_dian` (estado, XML, CUFE) | — | `skip locked` + reintentos | matias.test.mjs; dian-soporte.mjs; habilitacion.mjs | **No existe webhook de MATIAS/DIAN**: el estado se obtiene por sondeo en la cola. Emisor según `REGENTA_DIAN` (por defecto `simulado`). |
| W-005 | Baja de correos (RFC 8058) | Enlace/POST de un clic | `src/app/api/correo/baja/route.ts`; página `/baja` | token firmado (`leerTokenBaja`) | `correos_bajas`, `correos`, `solicitudes_demo` | token | natural | Contrato; admin.mjs | Sin `mismoOrigen` a propósito (los clientes de correo hacen POST). |
| W-006 | Regenta IA (salida) | API de Anthropic | `src/lib/ia/claude.ts`, `factura.ts`, `herramientas.ts` | según sesión | ninguna (herramientas de solo lectura con `comoUsuario`; `SOLO_GERENCIA` filtrado por rol también al ejecutar, herramientas.ts:41-42) | — | — | ia.mjs; factura-proveedor.test.mjs | Topes: 300/día por droguería, demo por IP y total (`limiteBD`). |

## 5. Interruptores y variables de configuración (feature flags)

| Variable | Dónde | Efecto | Por defecto | Observación |
|---|---|---|---|---|
| `REGENTA_DEMO` | `src/lib/sesion.ts:19` | `=1` habilita la demo pública (`/demo`, `/api/sesion`) en producción | apagado en producción (encendido fuera de producción) | — |
| `REGENTA_DEMO_SIN_LIMITES` | `src/lib/api.ts:88` | `=1` quita la protección de la demo (precios en bloque, importar, exportar) | apagado | Solo para pruebas; peligroso si se pone en producción. |
| `REGENTA_ADMIN_DOS_PASOS` | `src/lib/totp.ts:10` | `=1` exige TOTP a la consola de superadministración | **apagado** | La consola puede entrar «como» cualquier cliente: 2FA debería ser obligatoria. |
| `REGENTA_DIAN` | `src/lib/dian/soporte.ts:54`, consola | `matias` = envío real; otro = simulado | `simulado` | — |
| `REGENTA_CRON_KEY` | `src/lib/api.ts:66`, `src/app/api/tareas/route.ts:16`, `netlify/functions/tareas.mjs:7` | clave de las tareas programadas (≥24 car.) | sin clave = cron deshabilitado (401) | — |
| `REGENTA_SESSION_SECRET` | `src/lib/sesion.ts:14`, `src/lib/admin.ts:17` | firma de sesiones (la consola usa `"admin:"+secreto`) | fuera de producción hay un secreto fijo de desarrollo | Error si <32 car. en producción. |
| `REGENTA_URL` | `src/lib/sitio.ts:4-5`, cron | URL pública | `http://localhost:4500` | Obligatoria en Netlify/Vercel. |
| `REGENTA_CABECERA_IP` | `src/lib/api.ts:43` | cabecera fiable para la IP del visitante | Netlify `x-nf-client-connection-ip`, Vercel `x-vercel-forwarded-for`, si no `local` | Fuera de esas plataformas todos los límites por IP comparten la clave `local`. |
| `REGENTA_QR_LLAVE` / `REGENTA_QR_TITULAR` / `REGENTA_QR_IMAGEN` | `src/lib/pagos.ts:36-38` | pago por QR Bre-B (`off` lo apaga) | **encendido** con llave y titular escritos en el código | Datos de cobro fijos en el código fuente. |
| `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`, `WOMPI_API_URL`, `WOMPI_CHECKOUT_URL` | `src/lib/pagos.ts`, webhook | activa Wompi | apagado si faltan | — |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_URL` | `src/lib/pagos*.ts`, webhook | activa Stripe / su webhook | apagado | — |
| `MATIAS_TOKEN`, `MATIAS_URL` | `src/lib/dian/*`, consola | proveedor tecnológico DIAN | sandbox | — |
| `ANTHROPIC_API_KEY`, `REGENTA_IA_URL`, `REGENTA_IA_MODELO`, `REGENTA_IA_MODELO_FACTURAS` | `src/lib/ia/*` | Regenta IA (`iaActiva`) | apagada sin clave | — |
| `RESEND_API_KEY`, `CORREO_REMITENTE`, `CORREO_RESPUESTA`, `CORREO_AVISOS`, `SMTP_*` | `src/lib/correo` | envío de correos | simulado | — |
| `DATABASE_URL`, `DATABASE_CA`, `DATABASE_PASSWORD` | `src/lib/db.ts`, `supabase-ca.ts` | base de datos y TLS | — | — |
| `REGENTA_SQL_TIEMPOS` | `src/lib/db.ts:56` | registra el tiempo de cada consulta | apagado | Diagnóstico. |
| `REGENTA_CLAVE_PRUEBA`, `REGENTA_TOTP_PRUEBA`, `REGENTA_CAPTURAS`, `SIN_DEMO`, `CHROME` | `scripts/` | solo pruebas y capturas | — | No afectan al servidor. |

Interruptores **por empresa** en la base (los cambia solo la consola): `empresas.modo` (`venta`/`interno`, migración 049; bloquea ventas con el trigger `ventas_modo_interno`), `empresas.dian_complementario` (envío real de documento soporte/notas), `empresas.plan` (topes de cajas y usuarios, `src/lib/planes.ts`), `empresas.demo`, `empresas.estado`/`suspension`, `empresas.exige_turno` (lo cambia el dueño/admin), `descuento_max_cajero`, `egreso_max_cajero`, `dias_mora_bloqueo`, `devolucion_destino`.

## 6. Roles y su alcance

| Rol | Definido en | Entra por | Puede (resumen leído en guardas de servidor) |
|---|---|---|---|
| `dueno` | `src/lib/sesion.ts:10` | `/api/acceso` → `/inicio` | Todo lo de la droguería; exclusivo: cajas, equipo, configuración, logo, exportar copia, cancelar renovación, recibo de suscripción. |
| `admin` | idem | `/api/acceso` | Como el dueño salvo cajas, equipo, configuración, logo, exportar, suscripción. |
| `cajero` | idem | `/api/acceso` → `/caja` | Vender, fiar dentro del cupo, recibos de caja, turno de su caja, pedidos, entregas (modo interno), clientes (buscar/crear/poner correo). |
| `bodeguero` | idem | `/api/acceso` | Inventario (recibir, ajustes, conteos, lotes, cuarentena, ubicación, códigos), compras sin dinero, proveedores (crear), etiquetas, temperatura, alertas, entregas, predicción. |
| `vendedor` | idem (`Rol`), alta solo desde `/api/equipo` | `/api/acceso` | Pedidos (armar, no cobrar). La consola no puede crearlo (`src/app/api/admin/clientes/[id]/usuarios/route.ts:9,11`). |
| Superadministrador | tabla `superadmins`; `src/lib/admin.ts` | `/api/acceso` con `consola:true` (2FA solo si `REGENTA_ADMIN_DOS_PASOS=1`) | Consola completa; «entrar como» el cliente (sesión `soporte` de 1 h, auditada con `soporte_id`). |
| Soporte | `Sesion.soporte` | `/api/admin/clientes/[id]/entrar` | Lo del miembro elegido (preferente el dueño); no cambia contraseñas (`src/app/api/cuenta/route.ts:15`). |

## 7. Resumen

### 7.1 Conteos

| Concepto | Cantidad |
|---|---|
| Páginas (`page.tsx`) | **102**: 56 de la app con sesión `(app)`, 14 de consola `/admin`, 13 imprimibles con sesión propia (`/tiquete/*`, `/recibo/[ref]`, `/informes/temperatura`, `/control-especial/informe`, `…/imprimir`), 19 públicas |
| Páginas sin ninguna prueba | **2** (`/ayuda`, `/guias/[slug]`) |
| Archivos de endpoint (`route.ts`) | **116** (114 bajo `/api` + `/demo` + `/favicon.ico`) |
| Manejadores método+ruta | **160** (POST 70 · GET 51 · PATCH 23 · DELETE 10 · PUT 6) |
| … con sesión de droguería (`conSesion` o `leerSesion`) | 121 |
| … de consola (`conAdmin`) | 19 |
| … públicos | 15 (12 bajo `/api` + `GET/POST /demo` + `/favicon.ico`) |
| … cron (`REGENTA_CRON_KEY`) | 3 (`/api/tareas`, `/api/dian`, `/api/invima`) |
| … webhooks firmados | 2 (`/api/pagos/wompi`, `/api/pagos/stripe`) |
| Manejadores de escritura (no GET) | 109 |
| … escriben sin zod | 15 (9 sin cuerpo; 6 con cuerpo validado a mano: `correo/baja`, `compras/leer-factura`, `pagos/stripe`, `pagos/wompi`, `sesion POST`, `/demo POST`) |
| … crean registros **sin** idempotencia (repetir duplica) | 10 |
| … con idempotencia por `idem_key` | 20 (4 en la app con `idempotente()`, 16 en funciones SQL) |
| Manejadores fuera del contrato `endpoints.mjs` | 4 (`PATCH /api/inventario/costos`, `GET/POST /demo`, `GET /favicon.ico`) |
| Manejadores sin ninguna prueba funcional (solo contrato o nada) | **7** |
| Manejadores probados solo a través de la interfaz | 8 |
| Manejadores que permiten **cualquier** rol con sesión | 8 (`GET /api/cajas`, `POST /api/cuenta`, `POST /api/demo/evento`, `POST /api/ia`, `GET /api/inventario/exportar`, `GET /api/maestro`, `GET /api/productos`, `GET /api/turnos`) |
| Manejadores de droguería que escriben con `sinRLS` (filtran a mano por `s.empresa`) | 13 (todos filtran por empresa: revisado) |
| Tareas programadas | 1 función Netlify (cada 15 min) que orquesta 17 pasos; 2 rutas cron sueltas |
| Variables de configuración leídas | 47 (18 `REGENTA_*`) |
| Roles | 5 de droguería + superadministrador + soporte |

### 7.2 Endpoints sin ningún test funcional

1. `POST /api/suscripcion` (el dueño cancela la renovación en Stripe; mueve dinero real) — `src/app/api/suscripcion/route.ts:7-27`. Solo el contrato (`tests/e2e/endpoints.mjs:110`).
2. `DELETE /api/cartera/[id]` (anular abono; botón en `src/app/(app)/ventas/[id]/Abonos.tsx:17`) — `src/app/api/cartera/[id]/route.ts:7-20`.
3. `POST /api/clientes/[id]/correo` (correo del cliente desde la caja; `src/app/(app)/caja/ClienteFactura.tsx:179`) — `src/app/api/clientes/[id]/correo/route.ts:10-26`.
4. `POST /api/alertas` (constancia de revisión de alertas INVIMA; `src/app/(app)/alertas/Revisar.tsx:11`) — `src/app/api/alertas/route.ts:8-16`. Solo hay prueba de RLS en `tests/db.test.mjs:233,308`.
5. `POST /api/invima` — `src/app/api/invima/route.ts:6-10`.
6. `POST /api/admin/salir` — `src/app/api/admin/salir/route.ts:6-11`.
7. `GET /favicon.ico` — `src/app/favicon.ico/route.ts:2-4` (trivial).

Probados solo a través de la interfaz (sin aserción sobre la respuesta del endpoint): `POST /api/admin/activar`, `POST /api/admin/dos-pasos` (consola-clave.mjs), `POST /api/admin/sistema` (admin.mjs:268), `PATCH /api/admin/solicitudes` (admin.mjs:264), `PUT /api/admin/clientes/[id]/logo`, `GET /api/maestro` (gestion.mjs:129), `PATCH /api/control-especial` (control-especial.mjs:189), `POST /api/ventas/[id]/reenviar` (cumplimiento.mjs:119).

Huecos del propio contrato: `tests/e2e/endpoints.mjs:275-278` solo recorre `src/app/api` (deja fuera `/demo`) y compara **rutas, no métodos**: un método nuevo en una ruta ya listada no hace fallar la prueba (así quedó fuera `PATCH /api/inventario/costos`, que solo tiene prueba funcional en `tests/e2e/reportes-costos.mjs:79`).

### 7.3 Endpoints que escriben sin zod

| Endpoint | Archivo:línea | Cómo valida | Riesgo |
|---|---|---|---|
| `POST /api/pagos/wompi` | `src/app/api/pagos/wompi/route.ts:15` | cast `as EventoWompi` + checksum + re-consulta a Wompi | Bajo |
| `POST /api/pagos/stripe` | `src/app/api/pagos/stripe/route.ts:12` | `JSON.parse` tras verificar la firma | Bajo |
| `POST /api/compras/leer-factura` | `src/app/api/compras/leer-factura/route.ts:27-33` | multipart: tamaño ≤12 MB y tipo por bytes mágicos | Bajo |
| `POST /api/correo/baja` | `src/app/api/correo/baja/route.ts:11-14` | token firmado | Bajo |
| `POST /api/sesion` | `src/app/api/sesion/route.ts:17-19` | lista blanca de 3 uid | Bajo |
| `POST /demo` | `src/app/demo/route.ts:26` | rol del formulario contra lista; si no, dueño | Bajo |
| Sin cuerpo (9): `admin/clientes/[id]/entrar`, `admin/salir`, `dian`, `documentos/[id]/reenviar`, `invima`, `sesion DELETE`, `suscripcion`, `tareas`, `ventas/[id]/reenviar` | — | parámetros de ruta con `esUuid` | Nulo |
| Rama `activo=false` de `PATCH /api/productos/[id]` | `src/app/api/productos/[id]/route.ts:16-19` | `body.activo === false` sin zod | Nulo |
| `POST /api/productos/importar` (zod parcial) | `src/app/api/productos/importar/route.ts:18,28` | `filas: record<string, unknown>` filtrado a `CAMPOS` y leído por `leerFilas` | Bajo |

### 7.4 Endpoints que escriben sin idempotencia (repetir duplica)

| Endpoint | Archivo:línea | Efecto de un doble clic o reintento |
|---|---|---|
| `POST /api/admin/clientes/[id]/pagos` | `src/app/api/admin/clientes/[id]/pagos/route.ts:20-31` | **Dos pagos aprobados y dos periodos sumados** (referencia nueva por llamada). El más grave de la lista. |
| `POST /api/pedidos` | `src/app/api/pedidos/route.ts:26-33` | Dos pedidos iguales. |
| `POST /api/productos` (sin código de barras) | `src/app/api/productos/route.ts:80-90` | Dos productos iguales (con EAN se rechaza el segundo). |
| `POST /api/control-especial/anexo13` | `src/app/api/control-especial/anexo13/route.ts:64-71` | Dos informes «presentados» encadenados como reemplazo. |
| `POST /api/alertas` | `src/app/api/alertas/route.ts:13-14` | Dos constancias en una tabla inmutable. |
| `PATCH /api/inventario/conteos/[id]` modo `sumar` | `src/app/api/inventario/conteos/[id]/route.ts:31-45` | Un reintento suma dos veces lo escaneado. |
| `POST /api/pagos` (público) | `src/app/api/pagos/route.ts:30-34` | Una orden pendiente por intento (acotado por límites). |
| `POST /api/admin/clientes/[id]/habilitacion` | `src/app/api/admin/clientes/[id]/habilitacion/route.ts:67-90` | Repite la operación en MATIAS (registro de software / set de pruebas). |
| `POST /api/demo`, `POST /api/demo/evento` | `src/app/api/demo/route.ts:40-48`; `src/app/api/demo/evento/route.ts:18` | Solicitud o evento duplicado (acotado por límites). |

`POST /api/turnos` (abrir/cerrar), compras, ventas, devoluciones, recibos, abonos, gastos, pagos a proveedores, ajustes, entradas, entregas, documentos DIAN y precios en bloque **sí** son idempotentes (por `idem_key` o por estado).

### 7.5 Endpoints públicos (sin sesión)

`POST /api/acceso`, `POST /api/activar`, `POST /api/activar/nuevo`, `POST /api/admin/activar`, `POST /api/admin/salir`, `POST /api/restablecer`, `POST /api/sesion`, `DELETE /api/sesion`, `POST /api/demo`, `POST /api/pagos`, `GET /api/pagos/estado`, `POST /api/correo/baja`, `GET/POST /demo`, `GET /favicon.ico`; más 2 webhooks firmados y 3 cron. Todos los POST públicos (salvo `correo/baja`, por diseño) verifican `mismoOrigen`; los de credenciales tienen límites en BD (`acceso`, `restablecer`, `activar/nuevo`, `pagos`, `demo`) salvo `activar` y `admin/activar`, que solo tienen el limitador en memoria por instancia (`src/app/api/activar/route.ts:9`, `src/app/api/admin/activar/route.ts:8`).

### 7.6 Huecos y sospechas (ordenados por gravedad)

| # | Gravedad | Hallazgo | Archivo:línea |
|---|---|---|---|
| 1 | Alta | **La verificación en dos pasos de la consola está apagada por defecto.** Solo se exige con `REGENTA_ADMIN_DOS_PASOS=1`; sin ella, correo y contraseña bastan para la consola, que puede «entrar como» cualquier droguería, exportar sus datos, registrar pagos y eliminar clientes. | `src/lib/totp.ts:10`; `src/app/api/acceso/route.ts:39`; `src/app/admin/layout.tsx:24-25` |
| 2 | Alta | **El cierre ciego del turno solo existe en el front.** `/turno` pasa a la cajera el estado completo con `efectivo_esperado` (va en la carga RSC de la página) y solo lo oculta en pantalla; `GET /api/turnos` lo devuelve a cualquier rol sin filtrar. La cajera puede ver cuánto «debería» haber antes de contar. (El conteo a ciegas de inventario sí está hecho en el servidor.) | `src/app/(app)/turno/page.tsx:38`; `src/app/api/turnos/route.ts:18`; `src/lib/turnos.ts:12`; `db/migrations/033_cuentas_clientes.sql:608` |
| 3 | Alta | **El pago manual de la consola no es idempotente**: un doble clic registra dos pagos aprobados y suma dos periodos de suscripción. | `src/app/api/admin/clientes/[id]/pagos/route.ts:20-31` |
| 4 | Media | **Permisos del vendedor solo en el menú.** El menú le esconde Productos, Inventario y Alertas, pero esas páginas no lo rechazan (ve existencias y precios), y `GET /api/inventario/exportar` no comprueba rol: cualquier usuario (vendedor, cajera) descarga el inventario completo en Excel. | `src/components/Navegacion.tsx:14,22,26`; `src/app/(app)/productos/page.tsx:13-17`; `src/app/(app)/inventario/page.tsx:25,110`; `src/app/(app)/alertas/page.tsx:18`; `src/app/api/inventario/exportar/route.ts:9` |
| 5 | Media | **El modo «droguería interna» solo se aplica en el menú** (salvo `/caja` y el trigger que bloquea ventas). `/pedidos`, `/turno`, `/ventas`, `/clientes`, `/cartera`, `/documentos` y `/productos/precios` y sus APIs (pedidos, turnos, precios en bloque, recibos) siguen funcionando por URL. | `src/components/Navegacion.tsx:45,53`; `src/app/(app)/caja/page.tsx:18` (única comprobación); `db/migrations/049_modo_interno.sql:121-129` |
| 6 | Media | **La consola puede dejar una droguería sin dueño activo**: `PATCH …/usuarios` con `activo:false` desactiva al único dueño; la comprobación «al menos un dueño» solo corre al cambiar el rol. La bitácora va fuera de la transacción. | `src/app/api/admin/clientes/[id]/usuarios/route.ts:43,44-49,69` |
| 7 | Media | **Entrada de mercancía por la vía antigua.** `POST /api/inventario` acepta `tipo:"compra"` (y `ajuste`) de la bodega: mete existencias como compra sin registro en Compras, sin cuenta por pagar ni documento soporte, con un motivo de texto libre. | `src/app/api/inventario/route.ts:8,31-36` |
| 8 | Media | **Desligar un pago en la consola sin controles**: la rama final de `PATCH /api/admin/pagos` acepta `empresa_id:null` sobre cualquier pago (también aprobado) sin validar su estado, y la bitácora queda fuera de la transacción. | `src/app/api/admin/pagos/route.ts:103-106` |
| 9 | Media | **El conteo a ciegas se puede eludir**: la bodega ve las existencias del sistema en `/inventario` y en `GET /api/inventario/lotes` mientras cuenta. | `src/app/api/inventario/lotes/route.ts:13-19`; `src/app/(app)/inventario/page.tsx` |
| 10 | Baja | `PUT /api/empresa/factura` no protege la demo (configuración y logo sí): un visitante cambia el formato de factura de la demo para todos. | `src/app/api/empresa/factura/route.ts:12-16` |
| 11 | Baja | `DELETE /api/ventas/[id]` no comprueba el rol en la ruta; depende solo de `anular_venta` en la BD (defensa en profundidad incompleta; el contrato tampoco prueba un rol sin permiso). | `src/app/api/ventas/[id]/route.ts:9-18`; `tests/e2e/endpoints.mjs:140` |
| 12 | Baja | `GET /api/pagos/estado` es público y **escribe** (`UPDATE pagos_suscripcion`); su límite es solo en memoria por instancia. | `src/app/api/pagos/estado/route.ts:9,24-30` |
| 13 | Baja | `GET /api/productos` no usa `conSesion`: las ramas de búsqueda y «vencen» no fijan `Cache-Control: private, no-store` (sí la de catálogo). | `src/app/api/productos/route.ts:12-65` (no-store solo en l.40) |
| 14 | Baja | Auditoría de la importación masiva fuera de la transacción, con `sinRLS` y error tragado: puede quedar una importación sin constancia. | `src/app/api/productos/importar/route.ts:145-146` |
| 15 | Baja | `/api/tareas` reimplementa `cronAutorizado` en vez de usar el de `src/lib/api.ts:66` (riesgo de divergencia). | `src/app/api/tareas/route.ts:15-21` |
| 16 | Baja | Webhook de Wompi sin ventana de tiempo sobre `timestamp` (mitigado al re-consultar la transacción en Wompi). | `src/lib/pagos-firma.ts:23-30` |
| 17 | Baja | Datos de cobro QR (llave y titular) fijos en el código y el QR encendido por defecto. | `src/lib/pagos.ts:36-38` |
| 18 | Baja | Fuera de Netlify/Vercel, sin `REGENTA_CABECERA_IP`, todos los límites por IP comparten la clave `local`. | `src/lib/api.ts:41-47` |
| 19 | Baja | Inconsistencia de roles: la consola no puede crear ni asignar `vendedor` (el dueño sí). | `src/app/api/admin/clientes/[id]/usuarios/route.ts:9,11` vs `src/app/api/equipo/route.ts:10` |
| 20 | Info | `PATCH /api/inventario/lotes/[id]` valida `vence` solo con regex (sin `fechaReal`); la BD lo rechaza con 400. | `src/app/api/inventario/lotes/[id]/route.ts:9` |

Verificado sin hallazgo: ninguna ruta de droguería confía en un id del cliente sin filtrar por empresa. Las que usan `sinRLS` filtran por `s.empresa`, las que usan `comoUsuario` comprueban `empresa_id` antes de llamar a la función, y las funciones `SECURITY DEFINER` revisadas (`registrar_devolucion_proveedor`, `registrar_pago_proveedor`, `aplicar_ajuste`, `registrar_entrada`, `registrar_recibo`, `registrar_temperatura`, `contar_conteo`, `registrar_entrega`, `registrar_informe_anexo13`) vuelven a filtrar por la empresa que pone el servidor. `alertas_revision` limita `producto_id` a la empresa por política RLS (`db/migrations/007_correcciones.sql:42-44`). Regenta IA filtra sus herramientas por rol también al ejecutarlas (`src/lib/ia/herramientas.ts:41-42`).
