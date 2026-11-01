# Lecciones Regenta

- (1/11/2026) Postgres devuelve los date como Date de JS y al serializar se corren de día por la zona horaria: en las API, castear a ::text las fechas que viajan al navegador.
- (1/11/2026) Un proceso lanzado con pg_ctl/& desde la shell muere al terminar la orden: el Postgres y el servidor de pruebas se lanzan como tarea en segundo plano.
