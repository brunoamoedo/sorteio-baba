# Deploy em produção

Servidor com **Apache2** já instalado, **Docker** para a aplicação, domínio
`peakyblindersbaba.datadata.com.br`.

O Apache é a única porta aberta ao mundo: ele termina o TLS e repassa para os
containers, que publicam só em `127.0.0.1`. O Postgres e o Redis nem porta têm
— vivem na rede interna do compose.

```
internet ──▶ Apache :443
               ├── /            ──▶ 127.0.0.1:8080   nginx com o SPA
               ├── /api /admin  ──▶ 127.0.0.1:8000   gunicorn
               ├── /static      ──▶ 127.0.0.1:8000   whitenoise (admin e DRF)
               └── /media       ──▶ ./data/media     fotos, servidas em disco
```

## 0. O comando, e por que ele leva `-p`

O servidor usa o **`docker-compose` v1** (com hífen, o script Python). Todos os
comandos deste documento levam `-p sorteiobaba-prod`:

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml <comando>
```

O `-p` fixa o nome do projeto. Sem ele o compose deriva o nome da **pasta**, que
é a mesma do `docker-compose.yml` de desenvolvimento — os serviços têm nomes
iguais (`backend`, `postgres`, ...) e um `up` daqui destruiria e recriaria os
containers do outro, banco incluído. Num servidor que só roda produção não há
com o que colidir, mas o hábito evita a surpresa no dia em que houver.

O `docker-compose.prod.yml` declara `version: "2.4"` por causa do v1, que exige
a chave. O 2.4 é a versão mais alta do ramo 2.x e cobre `depends_on` com
`condition: service_healthy`, `start_period` no healthcheck e `target` no build
— coisas que o ramo 3.x não tem.

Se um dia você migrar para o plugin v2 (`docker compose`, com espaço), o mesmo
arquivo funciona: ele só avisa que a chave `version` é obsoleta.

## 1. Apontar o DNS

Um registro `A` de `peakyblindersbaba.datadata.com.br` para o IP do servidor.
Faça isso **primeiro**: o certbot precisa que o domínio já resolva.

## 2. Clonar e configurar

```bash
sudo git clone https://github.com/brunoamoedo/sorteio-baba.git /opt/sorteio-baba
cd /opt/sorteio-baba
cp .env.prod.example .env.prod
```

Preencha o `.env.prod`. Os dois que não têm padrão e travam a subida:

- `DJANGO_SECRET_KEY` — gere uma nova, exclusiva deste servidor. Ela assina os
  tokens de sessão; reaproveitar a do desenvolvimento entrega as sessões a
  quem tiver o repositório.
- `POSTGRES_PASSWORD` — e repita a mesma dentro da `DATABASE_URL`.

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # senha do banco
```

## 3. Subir os containers

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml up -d --build
```

O primeiro build demora alguns minutos. O `entrypoint.prod.sh` roda `migrate` e
`collectstatic` sozinho, **só no serviço web** — o worker e o beat esperam ele
ficar saudável para não subirem contra um banco sem migrar.

Confira antes de mexer no Apache:

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml ps          # todos "healthy"/"running"
curl -s localhost:8000/api/health/                    # {"status": "ok"}
curl -sI localhost:8080 | head -1                     # HTTP/1.1 200 OK
```

## 4. Apache

```bash
sudo a2enmod proxy proxy_http headers rewrite ssl
sudo cp deploy/peakyblindersbaba.datadata.com.br.conf /etc/apache2/sites-available/
sudo a2ensite peakyblindersbaba.datadata.com.br
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Se você clonou fora de `/opt/sorteio-baba`, corrija o `Alias /media/` no
arquivo antes de habilitar — é o único caminho absoluto ali.

## 5. Certificado

```bash
sudo certbot --apache -d peakyblindersbaba.datadata.com.br
```

O certbot cria o VirtualHost `:443` copiando o de `:80`, então o
`RequestHeader set X-Forwarded-Proto "https"` vai junto — e ele **precisa** ir.
Sem esse cabeçalho o Django não enxerga que a requisição era https e o
`SECURE_SSL_REDIRECT` responde 301 para https em toda requisição, inclusive nas
que já vieram por https: loop de redirecionamento, site fora do ar. Depois de
rodar o certbot, confirme que a linha está no `:443`:

```bash
grep -n "X-Forwarded-Proto" /etc/apache2/sites-available/peakyblindersbaba*
```

Enquanto o certificado não existir, o site só responde em http — e aí é preciso
`DJANGO_SECURE_SSL_REDIRECT=False` no `.env.prod`, **removido assim que o
certificado subir**.

## 6. Primeiro acesso

O banco de produção nasce vazio. Crie o Super Administrador:

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml exec backend python manage.py createsuperuser
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml exec backend python manage.py shell -c \
  "from apps.accounts.models import User; User.objects.filter(username='SEU_USUARIO').update(is_superadmin=True, is_superuser=True, is_staff=True)"
```

`is_superadmin` é o do sistema (acessa qualquer organização sem vínculo);
`is_superuser`/`is_staff` são só do admin do Django. São coisas diferentes de
propósito — ver `apps/accounts/models.py`.

Depois disso, entre no sistema e crie a organização em **Administração**.

## Levar os dados de desenvolvimento

Opcional, e só se você quiser começar com o elenco que já está na sua máquina.

Atenção à troca de comando: este primeiro roda **na sua máquina**, que usa o
`docker compose` v2 (com espaço) e o compose de desenvolvimento — por isso não
leva `-p` nem `-f`. O segundo roda no servidor, com o v1.

```bash
docker compose exec -T backend python manage.py dumpdata \
  --natural-foreign --natural-primary \
  -e contenttypes -e auth.permission -e sessions -e admin.logentry \
  -e django_celery_beat \
  --indent 2 > dados.json
```

O `-e django_celery_beat` não é detalhe: as tarefas agendadas são criadas no
servidor pelas **próprias migrations** (`draws`, `matches` e `finance`, cada uma
com a sua `0002_periodic_task.py`). Trazer as do desenvolvimento junto colide
com elas — `PeriodicTask.name` é único, e basta as chaves primárias não baterem
entre os dois bancos para o `loaddata` parar com `IntegrityError` no meio. Sem
elas o sorteio automático funciona igual: quem cria é a migration.

O `dados.json` sai na raiz do repositório e leva telefones, o financeiro e os
hashes de senha de todo mundo — está no `.gitignore` de propósito. Apague depois
de importar.

No servidor, com os containers já no ar:

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml exec -T backend \
  python manage.py loaddata /dev/stdin < dados.json
```

O `loaddata` é transacional: se algo colidir ele para sem gravar nada, e você
não fica com meio banco importado.

O banco precisa estar **recém-migrado e vazio** — se você já criou o
superusuário e a organização da seção 6, as chaves colidem. Confira antes:

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml exec -T backend python manage.py shell -c "from apps.accounts.models import User, Organization; print(User.objects.count(), Organization.objects.count())"
```

Os usuários vão no dump **com as senhas**: depois de importar você entra com o
mesmo login do desenvolvimento, e a seção 6 fica desnecessária. Por isso a ordem
é importar primeiro e criar usuário só se faltar.

As **fotos** não vão no dump: copie `backend/media/` para `data/media/` no
servidor à parte (`rsync -av backend/media/ servidor:/opt/sorteio-baba/data/media/`).

## Atualizar depois

```bash
cd /opt/sorteio-baba
git pull
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml up -d --build
```

O `--build` não é opcional: a URL da API é **assada no bundle** do frontend em
tempo de build (o Vite inlineia as `VITE_*`), então imagem velha continua
apontando para onde apontava.

O `git pull` traz o `.env.prod.example`, **nunca** o seu `.env.prod`. Quando o
exemplo ganhar uma variável nova, o deploy sobe sem ela e o erro aparece longe
da causa. Vale conferir depois de cada pull:

```bash
diff <(grep -o '^[A-Z_]*=' .env.prod.example | sort)      <(grep -o '^[A-Z_]*=' .env.prod | sort)
```

## Backup

O que importa é o Postgres e as fotos.

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U pelada pelada | gzip > backup-$(date +%F).sql.gz
tar czf media-$(date +%F).tar.gz data/media/
```

Vale um cron diário e uma cópia **fora deste servidor** — backup no mesmo disco
não protege do disco morrer.

## Quando algo quebrar

| Sintoma | Causa provável |
|---|---|
| Redirecionamento infinito | Falta `RequestHeader set X-Forwarded-Proto "https"` no VirtualHost `:443` |
| `DisallowedHost` no log | `DJANGO_ALLOWED_HOSTS` sem o domínio |
| Admin sem CSS | `collectstatic` não rodou — veja `logs backend`; ou `/static/` não está no proxy |
| "CSRF verification failed" no admin | `DJANGO_CSRF_TRUSTED_ORIGINS` faltando ou sem o `https://` |
| Fotos em 404 | `Alias /media/` apontando para o caminho errado |
| Tela branca, erro de CORS no console | Imagem do frontend construída com a URL antiga — refaça com `--build` |
| Sorteio automático não acontece | `celery-beat` fora do ar (`logs celery-beat`) |
| `Container ... is unhealthy`, worker e beat não sobem | O healthcheck do backend não passa — veja abaixo |
| `KeyError: 'ContainerConfig'` no `up` | Bug do docker-compose v1 ao recriar container: rode `down` antes do `up` |

### `Container ... is unhealthy`

O worker e o beat dependem de o backend estar saudável, então param os dois
junto. O healthcheck chama `http://localhost:8000/api/health/` **por dentro**
do container, direto no gunicorn — sem passar pelo Apache. Duas coisas quebram
esse caminho, e as duas já estão resolvidas na configuração deste repositório:

- **400 DisallowedHost** — o healthcheck manda `Host: localhost`. O
  `settings/prod.py` acrescenta `localhost` e `127.0.0.1` ao `ALLOWED_HOSTS`
  sozinho, justamente para isto não depender do `.env.prod`: o arquivo do
  servidor é uma cópia do exemplo feita no dia da instalação, e **`git pull`
  não o atualiza** — foi assim que este defeito voltou depois de "corrigido"
  só no `.env.prod.example`.
- **`SSL: WRONG_VERSION_NUMBER`** — sem o `X-Forwarded-Proto` (que só o Apache
  põe), o Django responde 301 para `https://localhost:8000`, e o gunicorn não
  fala TLS. Resolvido pelo `SECURE_REDIRECT_EXEMPT` em `settings/prod.py`, que
  tira **só** `/api/health/` do redirecionamento.

Para ver o que o healthcheck respondeu:

```bash
docker inspect -f '{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{println}}{{end}}'   sorteiobaba-prod_backend_1 | tail -3
```

```bash
docker-compose -p sorteiobaba-prod -f docker-compose.prod.yml logs -f backend
sudo tail -f /var/log/apache2/peakyblindersbaba-error.log
```
