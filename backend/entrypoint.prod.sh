#!/bin/sh
# Entrypoint de produção — compartilhado pelo web, pelo worker e pelo beat.
#
# `migrate` e `collectstatic` rodam **num serviço só**, o web, indicado por
# `RUN_MIGRATIONS=1`. Se os três rodassem (é a mesma imagem), eles disputariam:
# o `collectstatic --clear` de um apagaria os arquivos que o outro acabou de
# escrever, e três `migrate` simultâneos ficariam esperando o mesmo lock do
# Postgres para nada. O worker e o beat sobem depois do web ficar saudável
# (`depends_on` no compose), então encontram o banco já migrado.
#
# Fazer isso aqui, e não num passo manual do deploy, é proposital: esquecer um
# dos dois é a falha mais fácil de cometer e a mais chata de diagnosticar — sem
# migrate o app sobe e quebra na primeira consulta; sem collectstatic o admin
# do Django aparece sem CSS e parece "site quebrado".
set -e

if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
    echo "==> Aplicando migrações"
    python manage.py migrate --noinput

    echo "==> Coletando estáticos"
    python manage.py collectstatic --noinput --clear
fi

# `exec` para o processo virar o PID 1: sem isso o sinal de parada do Docker
# chega no shell e os workers são mortos no prazo, não encerrados com jeito —
# o que, num worker do Celery, significa tarefa interrompida no meio.
exec "$@"
