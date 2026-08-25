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

## 0. Pré-requisito: Docker Compose v2

Todos os comandos daqui usam **`docker compose`** (com espaço), o plugin v2 —
não `docker-compose` (com hífen), que é o script Python v1, descontinuado em
2023. Os dois são programas diferentes e **não** são intercambiáveis.

```bash
docker compose version
```

Se o comando não existir, instale o plugin:

```bash
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
```

Se o `apt` não achar o pacote — acontece quando o Docker veio do repositório da
distribuição em vez do oficial — instale o binário direto:

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64   -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

Rodar o `docker-compose.prod.yml` com o v1 falha com
`'name' does not match any of the regexes: '^x-'`, e a mensagem sugere
(erradamente) que falta uma chave `version:`. Não falta — o arquivo usa três
coisas que o v1 não tem: a chave `name:` de projeto, `depends_on` com
`condition: service_healthy` e `start_period` no healthcheck.

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
docker compose -f docker-compose.prod.yml up -d --build
```

O primeiro build demora alguns minutos. O `entrypoint.prod.sh` roda `migrate` e
`collectstatic` sozinho, **só no serviço web** — o worker e o beat esperam ele
ficar saudável para não subirem contra um banco sem migrar.

Confira antes de mexer no Apache:

```bash
docker compose -f docker-compose.prod.yml ps          # todos "healthy"/"running"
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
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
docker compose -f docker-compose.prod.yml exec backend python manage.py shell -c \
  "from apps.accounts.models import User; User.objects.filter(username='SEU_USUARIO').update(is_superadmin=True, is_superuser=True, is_staff=True)"
```

`is_superadmin` é o do sistema (acessa qualquer organização sem vínculo);
`is_superuser`/`is_staff` são só do admin do Django. São coisas diferentes de
propósito — ver `apps/accounts/models.py`.

Depois disso, entre no sistema e crie a organização em **Administração**.

## Levar os dados de desenvolvimento

Opcional, e só se você quiser começar com o elenco que já está na sua máquina.
Na máquina de desenvolvimento:

```bash
docker compose exec -T backend python manage.py dumpdata \
  --natural-foreign --natural-primary \
  -e contenttypes -e auth.permission -e sessions -e admin.logentry \
  --indent 2 > dados.json
```

No servidor, com os containers já no ar:

```bash
docker compose -f docker-compose.prod.yml exec -T backend \
  python manage.py loaddata /dev/stdin < dados.json
```

As **fotos** não vão no dump: copie `backend/media/` para `data/media/` no
servidor à parte (`rsync -av backend/media/ servidor:/opt/sorteio-baba/data/media/`).

## Atualizar depois

```bash
cd /opt/sorteio-baba
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

O `--build` não é opcional: a URL da API é **assada no bundle** do frontend em
tempo de build (o Vite inlineia as `VITE_*`), então imagem velha continua
apontando para onde apontava.

## Backup

O que importa é o Postgres e as fotos.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
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

```bash
docker compose -f docker-compose.prod.yml logs -f backend
sudo tail -f /var/log/apache2/peakyblindersbaba-error.log
```
