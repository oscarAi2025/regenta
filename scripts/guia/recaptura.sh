cd /home/claude/rg3-int
export LANGUAGE=es LANG=es_CO.UTF-8
S=/tmp/claude-0/-home-claude/cc809211-d237-5d8a-8dcb-ec68bc3fe822/scratchpad; P="postgresql://postgres@/regenta_3int?host=/tmp&port=5433"
ENVV="DATABASE_URL=postgres://postgres@localhost:5433/regenta_3int?host=/tmp REGENTA_SESSION_SECRET=prueba-local-0123456789abcdef0123456789abcdef REGENTA_CRON_KEY=cron-prueba-0123456789abcdef0123456789 REGENTA_URL=http://localhost:4540 ANTHROPIC_API_KEY=prueba-local"
arr() { fuser -k 4540/tcp >/dev/null 2>&1; sleep 1; (env $ENVV $1 setsid npx next start -p 4540 > $S/guia-server.log 2>&1 &); for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://localhost:4540/ | grep -q 200 && break; sleep 1; done; }
rm -rf $S/guia/pasos
DATABASE_URL='postgres://postgres@localhost:5433/regenta_3int?host=/tmp' node scripts/db-reset.mjs >/dev/null 2>&1
T=GuiaRegentaPrimerAcceso2026abcdeg; H=$(printf %s "$T" | sha256sum | cut -d' ' -f1)
psql "$P" -tAc "insert into cuentas (email,nombre) values ('maria@drogueriasanrafael.co','María Gómez') on conflict ((lower(email))) do update set clave_hash=null; insert into invitaciones (token_hash,cuenta_id,expira) select '$H', id, now()+interval '7 days' from cuentas where email='maria@drogueriasanrafael.co';" >/dev/null
arr ""; SIN_DEMO=1 CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/e2e/_guia-pasos.mjs $S/guia/pasos > $S/guia/cap1.log 2>&1
DATABASE_URL='postgres://postgres@localhost:5433/regenta_3int?host=/tmp' node scripts/db-reset.mjs >/dev/null 2>&1
psql "$P" -tAc "update empresas set nombre_comercial='Droguería San Rafael', razon_social='DROGUERÍA SAN RAFAEL S.A.S.' where demo" >/dev/null
arr "REGENTA_DEMO=1 REGENTA_DEMO_SIN_LIMITES=1"; CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome timeout 1200 node tests/e2e/_guia-pasos.mjs $S/guia/pasos > $S/guia/cap2.log 2>&1
grep -i fallo $S/guia/cap*.log; ls $S/guia/pasos | wc -l
