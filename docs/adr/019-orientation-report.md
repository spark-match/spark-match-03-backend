# ADR-019: Reporte de orientación — motor de afinidad, generación y almacenamiento

**Estado**: Propuesto · **Fecha**: 2026-08-09

Atraviesa cuatro repos: `02-infrastructure`, `03-backend`, `04-frontend`, `08-deep-agent`.
Extiende [ADR-003](003-5-bounded-contexts.md) (contextos) y el contrato de
[ADR-0002 de infraestructura](../../../spark-match-02-infrastructure/docs/adr/0002-cross-repo-config-contract-ssm-secrets.md)
(parámetros SSM bajo `/spark-match/{env}/config/`).

---

## 1. Contexto: qué existe hoy

El producto promete un informe de orientación vocacional. Lo que hay:

**Frontend** — `features/reports/` está construido y desplegado. `ReportsComponent.ngOnInit`
llama a `ReportsService.getReport()` y pone `loading = false` **solo en el callback de
éxito**; no hay rama de error. `environment.ts` (local) tiene `useMocks: true`, pero
`environment.cloud-dev.ts` y `environment.production.ts` lo tienen en `false`, así que el
build desplegado pega a `GET {apiUrl}/reports/latest`, recibe 404 y **la pantalla se queda
en "Generando tu reporte de orientación…" indefinidamente**. `exportPdf()` es
`window.print()`.

**Backend** — de los 5 contextos que decidió ADR-003 (Identity, Assessment, Career,
Matching, AI Advisor) **solo está implementado `identity`**. No existe ningún endpoint de
reports, careers ni matching. El 404 no es una ruta mal escrita: falta el dominio entero.

**Agente** — `StudentProfile` (`src/models/profile.py`) con `riasec_code`,
`has_riasec_profile` y `profile_completeness`, ambas *properties*. No hay generación de
informes ni persistencia de los mismos.

**Motor de afinidad** — existe uno, y conviene ser exacto sobre su alcance, porque el
comentario de `reports.service.ts` dice que "no existe conectado en ningún repositorio" y
eso es solo medio cierto. `src/tools/matching/handler.py` implementa
`calculate_affinity_handler`: similitud RIASEC con peso posicional (primera letra ×3,
segunda ×2, tercera ×1; coincidencia en la misma posición vale 10× el peso, cruzada 5×),
normalizada contra el auto-match del propio perfil. Es correcto y está bien probado.

**El crosswalk ya existe** (verificado el 2026-08-09 sobre el CSV, no sobre la
documentación). `data/programs/programs.csv` — 6.208 filas, 894 KB, ya dentro del repo del
agente — trae la columna `riasec_profile` **poblada en las 6.208 filas, cero vacíos**, con
52 códigos Holland distintos. Lo produce `src/riasec_tagging.py` de `05-data-pipeline`:
etiqueta **una vez cada una de las 554 carreras únicas** con ChatBedrock (Sonnet 4,
few-shot de 10 ejemplos tomados justamente del catálogo `.md`), valida la respuesta contra
los 120 códigos Holland legales antes de aceptarla, y propaga con un `merge(on="career")` a
las filas carrera × institución. Comprobado: **0 de 554 carreras tienen más de un código**.
`riasec_tags.csv` dice que las 554 salieron `llm_tagged`; el fallback por familia nunca hizo
falta.

Hay entonces **tres** fuentes de carreras, no dos, y el problema real es otro:

| | Fuente | Volumen | RIASEC | Métricas | Quién la usa |
|---|---|---|---|---|---|
| Catálogo curado | `data/careers/*.md` | 20 genéricas | Sí | No | `catalog` y `matching` |
| Programas reales | `data/programs/programs.csv` | 6.208 filas / 554 carreras | **Sí** | Sí | solo `programs` |
| Pipeline | `features.csv` (`05-data-pipeline`) | idéntico, antes de empaquetar | Sí | Sí | — |

**El defecto es de cableado, no de datos**: `calculate_affinity_handler` y
`search_careers_handler` puntúan contra las 20 fichas curadas, mientras las 6.208 filas
reales con su RIASEC ya están en disco y solo las lee la herramienta `programs`. El informe
no puede construirse desde las 20 porque no tienen institución ni métricas.

Lo que sí falta de verdad: **el multicriterio**. El score mira exclusivamente
`riasec_profile`. Duración, ingreso, costo, tasa de admisión, región y tipo de institución
no entran, así que los cuatro filtros que el usuario configura en `/filters` (`region`,
`institutionType`, `academicType`, `budget`) hoy **no influyen en nada**.

Y una brecha de trazabilidad: `programs.csv` lleva las cuatro banderas `*_measured` para
distinguir una cifra medida de una imputada, pero **no lleva `riasec_source` ni la
`confidence`** que `riasec_tagging.py` sí calcula. Además `validate_sample()` existe y
exporta 300 carreras para revisión humana, pero `data/riasec_validation_sample.csv` **no
está en el repo**: el etiquetado RIASEC que sostiene toda la afinidad es 100 % generado por
un LLM y **nunca se validó a mano**.

---

## 2. Decisiones

### D1 — El informe vive en los contextos `career` + `matching`

No se crea un contexto nuevo: ADR-003 ya los reservó. `career` posee el catálogo y el
crosswalk; `matching` posee el score, el ciclo de vida del informe y su registro.

### D2 — Informes inmutables + puntero a la última versión

Un informe es la foto de **dos cosas que se mueven**: el perfil del estudiante (cambia
según avanza el assessment) y el snapshot de datos (`Ponte en Carrera (MINEDU) · datos del
13/06/2026`; la etapa `ingest` del `dvc.yaml` está congelada porque el portal del MINEDU
devuelve 500 desde el 2026-07-12). Mutar el informe in situ destruye el registro de lo que
al estudiante se le dijo y hace incontestable la pregunta "¿por qué hoy dice otra cosa?".

Cada generación crea una fila nueva. `GET /v1/reports/latest` es
`ORDER BY created_at DESC LIMIT 1` — **sin columna `is_latest`**, para no mantener un
invariante de dos escrituras. `GET /v1/reports` da el listado histórico. Así se obtienen
las dos UX (informe único que se actualiza / listado por fechas) sin elegir ahora.

### D3 — El objeto en S3, la referencia en la BD

El backend es registro y proxy: **no guarda una URL, guarda `bucket + key + version_id`**.
Una URL prefirmada caduca (fila rota) y una que no caduca es una capacidad permanente que
expone el perfil psicométrico de un menor a cualquiera con el enlace.

Bucket privado, `block_public_access`, SSE-KMS con la CMK del proyecto, versioning activado
(la inmutabilidad de D2 sale gratis), **sin CloudFront**. Su valor es caché en el borde y
aquí no hay nada que cachear; ponerlo delante de contenido privado obliga a signed
URLs/cookies, o sea key pair en Secrets Manager, trusted key group y rotación. Cuidado con
copiar el módulo `frontend-hosting`: sirve un sitio estático que lee todo el mundo, el
patrón de acceso opuesto.

Camino de lectura: mientras el artefacto sea JSON (10–30 KB), **lo sirve el backend** en
`GET /v1/reports/{id}/content` reutilizando el JWT. Nada que firmar, ninguna credencial en
la URL. Las prefirmadas se dejan para cuando exista el PDF. Como se guarda la key y no la
URL, ese cambio no toca la BD.

Key: `reports/{user_id}/{report_id}.json` — UUIDs opacos, nunca correo ni DNI.
El JSON lleva `schema_version` para que los informes viejos sigan siendo legibles cuando la
forma evolucione.

**Esquema de la tabla `orientation_report`:**

```
id                     uuid PK
user_id                uuid FK -> users
created_at             timestamptz
status                 pending | ready | failed
s3_bucket, s3_key, s3_version_id
size_bytes, checksum_sha256
riasec_code            varchar(3)        -- resumen para listar sin abrir el objeto
profile_completeness   numeric
top_career_ids         jsonb
dataset_source         text              -- "Ponte en Carrera (MINEDU)"
dataset_snapshot_date  date              -- 2026-06-13
model_id               text
langsmith_run_id       uuid              -- la traza (ver D10)
generation_ms          int
failure_reason         text null
```

`dataset_snapshot_date` cierra el argumento de D2: cada informe queda atado a la versión de
datos con la que se generó.

### D4 — Generación asíncrona: `202` + polling

`POST /v1/reports` crea la fila en `pending` y devuelve `202` con el id. El frontend consulta
`GET /v1/reports/{id}` hasta `ready` o `failed`. La pantalla "Generando tu reporte…" pasa a
ser verdad en lugar de una mentira piadosa.

Motivo técnico: la generación son 10–20 s de LLM más el render y el upload, contra el techo
de `origin_read_timeout = 60` del CloudFront delante del ALB, que es el máximo que AWS
concede sin ampliación de cuota (documentado en `08-deep-agent/src/api/sse.py`).

MVP con `BackgroundTasks` de FastAPI, **con la salvedad explícita de que un reinicio del
contenedor deja informes huérfanos en `pending`**. Mitigación mínima: un barrido que marque
`failed` lo que lleve más de N minutos en `pending`. La solución correcta es SQS y queda
fuera del alcance de este ADR.

#### Enmienda del 2026-08-09 — quién dispara la generación

Al implementar la fase 4 apareció un hueco que este ADR no cerraba: D4 describe qué pasa
**después** de `POST /v1/reports`, pero no quién lo llama ni cómo se entera el backend de
que el agente terminó. Se cierra así:

**El informe lo genera siempre el agente, dentro de un turno de chat. No hay un camino
donde el backend lo dispare y espere.**

Hay dos formas de pedirlo y las dos acaban en el mismo sitio:

1. El estudiante lo pide hablando → el coordinador delega en el subagente `report`.
2. El estudiante pulsa el botón → **el frontend envía un mensaje al chat**, y a partir de
   ahí es el caso 1.

El botón es azúcar sobre la conversación, no una segunda entrada al sistema. Se descartaron
las alternativas por este orden:

- **Que el backend llame al agente y espere**: la generación son 10–20 s de LLM más el
  render del PDF, contra el techo de 29 s de API Gateway. Funcionaría hasta que dejara de
  hacerlo, y fallaría justo en los informes más largos.
- **EventBridge** (el backend emite, el agente consume y avisa): correcto para escalar, y el
  bus ya existe, pero añade un camino asíncrono que hay que poder depurar para resolver un
  problema que el camino único no tiene.

Y hay una razón de producto que pesa más que las dos técnicas: generar el informe es lo más
lento que hace el producto, y **la conversación ya sabe contar lo que está pasando** — los
chips de actividad muestran cada herramienta y cada delegación. Un spinner de veinte
segundos en una pantalla aparte es exactamente la misma espera, contada peor.

Consecuencia para el backend: `POST /v1/reports` deja de ser el disparador para el
estudiante y pasa a ser **el registro de un informe que el agente ya está produciendo**. La
fila sigue naciendo en `pending` y sigue haciendo falta el barrido, porque un turno cortado
a mitad —cerrar la pestaña, caerse el SSE— la deja igual de huérfana que un reinicio.

### D5 — Subagente especializado, con salida estructurada

Se añade un cuarto subagente `report` junto a `assessment`, `matching` y `planning`. Motivo:
los tres existentes están afinados para conversar; este no conversa, produce un documento
con esquema fijo, y mezclar los dos objetivos en un prompt degrada ambos.

Atención a un detalle ya aprendido en `src/agent/factory.py`: el middleware del padre **no**
se propaga a los subagentes (`deepagents/middleware/subagents.py` construye cada uno con
`list(spec.get("middleware", []))` de su propio spec). El subagente `report` necesita su
propia instancia de `ToolCallRepairMiddleware`, igual que los otros tres.

> **Resuelto el 2026-08-09 (fase 2).** Este aviso ya no requiere trabajo específico: la
> fase 2 arregló el problema de forma genérica en `factory.py`, que inyecta una instancia
> nueva de `ToolCallRepairMiddleware` a **cada** spec de la tupla de subagentes. Añadir
> `REPORT_SUBAGENT` a esa tupla basta, y los dos tests de `tests/agent/factory.py` que
> iteran sobre todos los subagentes lo cubren sin tocarlos.

### D6 — Los números salen del dato, la prosa sale del modelo

El modelo escribe `profileSummary` e `insight`. `durationYears`, `admissionRatePct`,
`monthlyIncomeAvg`, `annualCostAvg` y `matchPct` los ensambla el motor desde el dataset y
**el subagente los recibe ya calculados, no los produce**.

Esto no es purismo: hasta el 2026-08-08 el mock del frontend atribuía al MINEDU cifras que
el MINEDU nunca publicó — de las tres carreras mostradas, dos no existían en el dataset (0
filas) y la tercera tenía otros números. La separación es la garantía de que no vuelva a
pasar por otra vía.

### D7 — `programs.csv` es el catálogo único; `data/careers/*.md` se retira

Decisión del usuario, y es la correcta: **una sola fuente de carreras**, la real. Mantener
20 fichas curadas en paralelo a 554 carreras etiquetadas es garantizar que diverjan.

**Fase A — recablear, no construir.** `calculate_affinity_handler` y
`search_careers_handler` pasan de `load_career_catalog()` a `load_programs()`. Se borran
`data/careers/`, `src/tools/catalog/loader.py` y sus tests. `_riasec_similarity` no se toca:
opera sobre cualquier código de 3 letras y funciona igual sobre las 6.208 filas.

Consecuencias de la retirada, explícitas:

- `Career.field` (~10 valores curados) lo sustituye `career_family` (81 valores reales).
  `search_careers` cambia de vocabulario de filtrado.
- **Los recursos de aprendizaje pasan a `web_search`.** El cuerpo markdown de cada `.md`
  (enlaces a CS50, The Odin Project…) llega hoy al modelo, porque `search_careers_handler`
  devuelve el `Career` entero con su `body`. `programs.csv` no tiene equivalente. Decidido:
  los busca el subagente de planificación con Tavily. Además de evitar un fichero curado a
  mano, la información va más actualizada — los enlaces fijos envejecen sin avisar.
- La afinidad pasa a puntuar 6.208 filas en vez de 20, así que `calculate_affinity_handler`
  necesita deduplicar por carrera antes del top-N: si no, el top-5 se llena con cinco
  instituciones de la misma carrera.

**Riesgo aceptado — el etiquetado RIASEC no está validado a mano.** Los 554 códigos que
sostienen toda la afinidad los puso un LLM y nadie los ha revisado: `validate_sample()`
existe y exporta 300 carreras para revisión humana, pero `data/riasec_validation_sample.csv`
no está en el repo. Se deja así **a decisión explícita del usuario** (2026-08-09) para no
retrasar la feature. Queda anotado como limitación conocida: si en la defensa se pregunta de
dónde sale el `matchPct`, la respuesta honesta es "de un etiquetado LLM sin validación
humana". Correr la muestra sigue siendo el artefacto de MLOps más rentable del backlog.

**Fase B — score multicriterio.** Implementado en `src/tools/recommendation/`
(`scoring.py` los pesos, `handler.py` los filtros y el ranking). Determinista, explicable,
sin LLM. Es **el único sitio donde se define «encaja»**, recogiendo la advertencia que ya
llevaba `programs/handler.py`: repartir esa definición entre la recuperación y la afinidad
las dejaría separarse.

- **Filtros duros** (`budget`, `region`, `institutionType`, `academicType`): excluyen, no
  puntúan. Un usuario que pide Lima pública no debe ver Piura privada con menos puntos.
  Cuando la combinación no deja nada, el error dice **qué filtro soltar y cuántos programas
  aparecerían** — «no encontré nada» a secas deja al estudiante tocando controles a ciegas.
- **Afinidad RIASEC**: `_riasec_similarity` tal cual, peso 0.50. Domina porque el producto
  es orientación *vocacional*: su premisa es que encajar pesa más que cobrar.
- **Señales de resultado**: ingreso 0.20, accesibilidad (tasa de admisión) 0.20,
  asequibilidad (costo) 0.10. `duration_years` se informa pero **no puntúa**: hacerlo
  exigiría decidir que menos años es mejor, y eso no es cierto en general.
- **Rangos de referencia fijos**, percentiles 5 y 95 del dataset calculados sobre las filas
  medidas, no min-max del subconjunto filtrado. Con min-max, añadir un candidato cambiaría
  la nota de todos y un 0.8 significaría algo distinto en cada búsqueda.
- **Una cifra imputada no puntúa**: vale el neutro 0.5 en vez de su valor normalizado. El
  pipeline rellena lo que falta con la mediana de la familia (73% de los ingresos, 65% de
  las tasas de admisión) y dejar que eso puntúe sería rankear sobre medianas de familia
  presentadas como datos del programa.
- **Una carrera por resultado**: el ranking es de programas —la ficha necesita institución y
  cifras— pero se queda el mejor de cada carrera. Sin eso un top-3 sale con la misma carrera
  en tres universidades y el estudiante ve una opción creyendo que ve tres.

Una propiedad que conviene tener escrita: como lo imputado vale 0.5, **un programa del que
no sabemos nada puede quedar por delante de otro cuyas cifras reales son flojas**. Es la
postura honesta —sin información, el punto medio— y por eso el desempate pone delante al que
sí se midió cuando la puntuación empata; pero hay que conocerla al leer un ranking, y el
prompt del subagente le pide al modelo que lo diga cuando venga al caso.

`match_score` viaja con `score_breakdown` y `scoring_version`. Lo primero permite explicar
por qué una carrera va delante; lo segundo, que un informe emitido hoy siga siendo
interpretable cuando mañana cambien los pesos.

`matchPct` solo aparece en el informe **cuando A y B existen**. Hasta entonces el informe
sale con ranking justificado en prosa y sin porcentaje: es preferible a firmar una cifra
inventada en el entregable central del TFP.

### D8 — Puerta de completitud

- **Dura**: `StudentProfile.has_riasec_profile` debe ser `True`. Sin las seis puntuaciones no
  hay `riasec_code`, y sin `riasec_code` el motor no tiene entrada.
- **Blanda**: `profile_completeness >= 0.6` (configurable). La property reparte 12 puntos: 9
  campos más hasta 3 intereses; solo RIASEC da 0.50, y 0.60 exige RIASEC más dos campos de
  contexto.

Si no se cumple, `POST /v1/reports` devuelve `409` con qué falta, y el agente lo convierte en
una pregunta al estudiante en vez de un error. Justificación: `riasec_accuracy` se queda
entre 0.45 y 0.52 en los tres modelos evaluados (Sonnet 4.5, Sonnet 4.6, Opus 4.6); emitir
una recomendación vocacional sobre un RIASEC flojo es firmar con la parte menos fiable del
sistema.

### D9 — Límite de regeneración configurable vía SSM

Cada regeneración es una llamada al LLM. Tres parámetros nuevos bajo el prefijo de ADR-0002,
en el módulo `ssm-bootstrap` (que es el que materializa el contrato entre repos):

Se crean **en `dev` y en `prod`**, con los mismos nombres y valores distintos por ambiente —
el módulo ya se instancia una vez por `live/{env}`, así que salen del mismo `for_each` que
los ocho existentes.

| Parámetro | Tipo | dev | prod |
|---|---|---|---|
| `/spark-match/{env}/config/reports-bucket` | String | `spark-match-dev-reports` | `spark-match-prod-reports` |
| `/spark-match/{env}/config/reports-max-per-user-per-day` | String | `10` | `3` |
| `/spark-match/{env}/config/reports-min-profile-completeness` | String | `0.6` | `0.6` |

En dev el tope va más alto a propósito: es el ambiente donde se prueba la regeneración.

Ninguno es secreto: van como `String` con los mismos `checkov:skip` que el resto del módulo.
Se cachean en proceso igual que `jwt_secret_cache_seconds`, para no pagar una llamada a SSM
por request. El tope es **independiente** de
`budget_max_requests_per_user_per_day` (hoy 200): son unidades distintas y un informe cuesta
mucho más que un turno de chat.

### D10 — Trazas: `langsmith_run_id`, con una fecha de caducidad conocida

Cada fila guarda el `langsmith_run_id` de la generación, de modo que desde un informe en la
UI se salte a la traza exacta que lo produjo.

**Verificado por CLI el 2026-08-09** (`langsmith api ttl-settings`, y `trace_tier` por
proyecto en `langsmith api sessions`):

```json
{ "default_trace_tier": "shortlived", "apply_to_all_projects": false,
  "configured_by": "system", "longlived_ttl_days": null }
```

Todos los proyectos están en `shortlived`, o sea **14 días de retención**, valor por defecto
de LangSmith que nadie configuró. Dos consecuencias opuestas:

- **A favor**: el contenido conversacional de estudiantes en un SaaS de terceros se
  autoborra en 14 días. Eso suaviza materialmente la salvedad de privacidad del runbook.
- **En contra**: `langsmith_run_id` se convierte en un puntero colgado a los 14 días. La UI
  debe degradar a "traza expirada" en vez de romperse, y por eso D3 copia `model_id` y
  `generation_ms` a la fila: lo mínimo para auditar un informe viejo sin la traza.

Si el TFP necesita enseñar trazas en la defensa, hay que **exportarlas o subirlas a
`longlived` antes de que caduquen** — las de la comparación de modelos del 2026-08-09
desaparecen alrededor del **2026-08-23**.

### D11 — PDF por Markdown → HTML → WeasyPrint, con la identidad de la web

El informe se entrega en PDF. La cadena es **Markdown → HTML → PDF**, y hay precedente en el
propio producto: el agente ya escribe en markdown y la app lo convierte con `MarkdownPipe`
sobre la clase `.prose` de `styles.scss`. La hoja del PDF es una hermana de `.prose`, no una
invención nueva.

**Quién escribe qué.** El modelo escribe **solo prosa** en markdown (`profileSummary`,
`insight` por carrera); el **esqueleto** del documento —encabezados, fichas, tabla de
métricas— lo compone una plantilla que inyecta las cifras del dataset. Es D6 aplicado al
PDF: si el modelo emitiera el markdown entero, los números volverían a salir del modelo, que
es justo lo que se quiere evitar. Se guardan **dos objetos** por informe:

| Objeto | Key | Para qué |
|---|---|---|
| JSON estructurado | `reports/{user_id}/{report_id}.json` | La vista web, y poder re-renderizar el PDF sin volver a llamar al LLM |
| PDF | `reports/{user_id}/{report_id}.pdf` | Descarga y adjunto en el chat |

Ambos los sirve el backend por `GET /v1/reports/{id}/content?format=json|pdf`, con el mismo
JWT. Una sola vía de autorización, sin firmar nada y sin capacidades viajando en una URL. Si
los PDF crecen hasta molestar en la respuesta de Lambda, se pasa ese camino a URL prefirmada
con TTL corto — y la BD no cambia, porque guarda la key (D3).

**Dónde se renderiza: en el agente, no en el backend.** WeasyPrint necesita pango, cairo y
gdk-pixbuf. El agente ya es un contenedor sobre Fargate (un `apt-get` en su Dockerfile); el
backend es Lambda (ADR-001), donde eso exige imagen de contenedor o layer. El agente genera,
renderiza, sube a S3 y devuelve las keys; el backend escribe la fila. El backend sigue siendo
registro y proxy, que es su papel en D3.

**Markdown → HTML** con `markdown-it-py` (`tables` y `strikethrough` activados). No se admite
HTML embebido en el markdown del modelo: el `insight` va a un renderizador, y permitir HTML
crudo ahí es una inyección esperando a ocurrir.

**Tipografías empaquetadas, no traídas de Google.** `styles.scss` importa Fraunces e Inter
por `@import url(fonts.googleapis.com)`. En el PDF eso sería una llamada de red en cada
render: lenta, y rota en cualquier entorno sin salida a internet — incluida la máquina del
evaluador del TFP, donde por regla dura #7 todo tiene que funcionar sin credenciales ni red.
Los `.woff2` se versionan en el repo y se referencian con `@font-face` y ruta local.

**Colores en sRGB, no en OKLCH.** El tema está escrito en `oklch()`, que depende de la versión
de WeasyPrint. Se precomputan una vez y se comitean con el OKLCH original en comentario, para
que la conversión sea auditable:

| Token | OKLCH (fuente) | sRGB (PDF) | Uso |
|---|---|---|---|
| `--teal-deep` | `oklch(0.42 0.09 195)` | `#005B5C` | Primario, enlaces, títulos de ficha |
| `--teal-glow` | `oklch(0.62 0.13 175)` | `#009F82` | Acento, marca de mejor coincidencia |
| `--cream` | `oklch(0.97 0.012 85)` | `#F9F5EC` | Fondo de página |
| `--ink` | `oklch(0.22 0.04 240)` | `#061D2B` | Texto |
| `--border` | `oklch(0.88 0.015 85)` | `#DCD7CD` | Bordes de ficha y tabla |
| — | `oklch(0.5 0.02 240)` | `#59656E` | Texto secundario, pie de fuente |
| — | `oklch(0.95 0.01 240)` | `#E9F0F5` | Cabecera de tabla |

Tipografía: **Fraunces** (serif) en `h1`–`h3` con `letter-spacing: -0.02em`, **Inter** en el
cuerpo; radio de esquina `0.875rem`. Se añade lo que la web no necesita y un PDF sí: `@page`
con márgenes y numeración, y `break-inside: avoid` en cada ficha de carrera para que no se
parta entre páginas.

**`exportPdf()` deja de ser `window.print()`** y pasa a descargar el PDF del servidor. El
`window.print()` actual imprime el DOM con la barra lateral y sin control de saltos de
página; además solo existe estando en la pantalla, así que nunca podría ser el adjunto del
chat.

### D12 — Los filtros son parte del perfil, no una pantalla previa

Los cuatro filtros de `/filters` (región, gestión, tipo de institución, presupuesto) pasan a
ser campos de `StudentProfile` y se actualizan conversando, igual que el código RIASEC.
Cambian a mitad de charla —«uy, eso es carísimo», «prefiero quedarme en Arequipa»— y un
formulario no puede recogerlos ahí.

**Pero se extraen con un listón más alto que el resto del perfil**, y el motivo es una
asimetría que conviene tener escrita:

| | Cómo se obtiene | Cómo falla |
|---|---|---|
| RIASEC | Hay que inferirlo: el estudiante no sabe su código Holland | Recomendación rara que el estudiante puede discutir — **error visible** |
| Filtros | El estudiante los sabe y puede decirlos exactos | Opciones que nunca se muestran — **error invisible** |

Y el dato pesa: `riasec_accuracy` va entre 0.45 y 0.52 en los tres modelos evaluados, o sea
que la extracción conversacional es la pieza menos fiable que hemos medido, y corre con
Haiku. Poner filtros duros detrás de eso deja que el componente más flojo decida qué no
llega a ver el estudiante.

Tres medidas, en orden de importancia:

1. **El impacto de cada filtro se reporta siempre.** `recommend_programs` devuelve
   `candidates_without_each_filter`: cuántos programas habría soltando cada uno. Así el
   agente puede decir «con tu presupuesto quedan 43 de los 411 de Arequipa» y el estudiante
   corrige si no era eso. Convierte el error invisible en uno visible, que es lo único que
   se puede corregir. Antes esto solo se calculaba al quedarse sin resultados.
2. **Las instrucciones de extracción son más estrictas para estos cuatro campos**: solo
   desde una afirmación explícita, nunca inferidos («vivo en Puno» no es «quiero estudiar en
   Puno»), y **jamás convertir una frase vaga en un número** — «no tengo mucha plata» es
   `None`, no 3000.
3. **`None` significa «no lo sabemos», no «sin filtro»**, y por eso el `budget: 8000` que
   traía por defecto el formulario era un dato inventado: quien no tocaba el deslizador
   acababa con una restricción que nunca pidió.

**La pantalla no se borra: se degrada a espejo editable.** Deja de ser obligatoria —se puede
ir directo al chat— y pasa a ser el sitio donde el estudiante ve y corrige lo que el sistema
cree saber de él. Con extracción automática de por medio, eso deja de ser un formulario y
pasa a ser el control de calidad.

Las cuatro restricciones **no cuentan** para `profile_completeness`. Esa medida es lo bien
que conocemos al estudiante en lo vocacional y es la que gobierna la puerta de D8: quien no
ha dicho presupuesto merece su informe igual.

---

## 3. Consecuencias

**Positivas** — el informe queda trazable a sus entradas (versión de perfil + snapshot de
datos + traza + modelo); los filtros de `/filters` por fin sirven para algo; se cierra el
404 que hoy cuelga la pantalla; se implementan dos de los cinco contextos de ADR-003.

**Negativas** — es la feature más grande pendiente y toca los cuatro repos; el crosswalk
(D7-A) puede resultar más caro que todo lo demás junto; `BackgroundTasks` es una solución
provisional con un modo de fallo conocido.

**Riesgos aceptados** — informes en `pending` si el contenedor reinicia (D4); pérdida de
trazas a los 14 días (D10); `matchPct` ausente en la primera versión si D7-B no llega
(preferido a inventarlo).

---

## 4. Plan por fases

| Fase | Repo | Contenido | Depende de |
|---|---|---|---|
| 0 | 04-frontend | Manejo de error en `ReportsComponent` (hoy cualquier fallo = spinner infinito) | — |
| 1 | 08-deep-agent | Recablear `catalog`/`matching` a `load_programs()`, deduplicar por carrera, borrar `data/careers/` y su loader | — |
| 2 | 08-deep-agent | Motor multicriterio; filtros de `/filters` como exclusión dura | 1 |
| 3 | 02-infrastructure | Bucket privado + KMS + versioning; 3 parámetros SSM; políticas OIDC | — |
| 4 | 08-deep-agent | Subagente `report` con salida estructurada + su `ToolCallRepairMiddleware` | 2 |
| 4′ | 08-deep-agent | Renderizador Markdown → HTML → PDF: WeasyPrint, fuentes empaquetadas, hoja hermana de `.prose`, subida a S3 | 3 |
| 5 | 03-backend | Contextos `career`/`matching`: tabla, `POST /v1/reports`, `GET /latest`, `/{id}`, `/{id}/content`; puerta D8; tope D9 | 3, 4 |
| 6 | 04-frontend | Polling, listado histórico, tarjeta adjunta en el chat | 5 |

La fase 0 se hace ya y es independiente de todo lo demás: el spinner infinito volverá a
aparecer en cualquier fallo del backend aunque la feature exista.

---

## 5. Pendientes de decisión

Ninguno. El último que quedaba —la retención del bucket— se cerró el 2026-08-09.

### D13 — Los informes no se borran (2026-08-09)

**El bucket no lleva regla de expiración, y esa ausencia es una decisión, no un olvido.**
Se escribe aquí precisamente para que nadie "arregle" dentro de seis meses lo que parece un
lifecycle que falta.

Un informe no se genera solo ni al final de cada conversación: se emite **cuando el
estudiante lo pide** (ver la enmienda de D4). Eso cambia lo que significa guardarlo. No es
un subproducto que se acumula, es algo que alguien decidió tener, y borrárselo por una
regla de antigüedad sería retirarle una decisión que tomó él.

Lo que sí acota el crecimiento es el tope de D9: **3 generaciones o actualizaciones al día
por usuario**, ya en SSM (`reports-max-per-user-per-day`). Cada petición produce un informe
nuevo con su propio id y su propia clave; el listado los ordena por fecha y el estudiante
ve su historial. "Actualizar" es emitir otro, no pisar el anterior — coherente con no
borrar, y además deja ver cómo evolucionó su perfil.

Dos cosas que esta decisión **no** dice, y que habrá que decidir cuando toque:

- **Borrado a petición del estudiante.** Sigue siendo lo correcto y sigue sin implementarse.
  No borrar por antigüedad no es lo mismo que no borrar nunca a quien lo pide. El bucket
  tiene versionado, así que un borrado real tendrá que retirar también las versiones
  anteriores.
- **Qué pasa al cerrar una cuenta.** Fuera del alcance de este ADR.

Decidido y anotado aquí para que no se reabra: los recursos de aprendizaje salen de Tavily y
no de un fichero curado (D7); el informe se entrega en PDF renderizado en servidor (D11); el
adjunto del chat es una **referencia** (id + enlace) y nunca el informe en línea, porque
inline viajaría en el contexto de todos los turnos siguientes y se pagaría en cada uno; y el
etiquetado RIASEC se acepta sin validación humana (D7).
