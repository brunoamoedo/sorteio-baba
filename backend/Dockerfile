FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements/ requirements/
ARG REQUIREMENTS_FILE=requirements/prod.txt
RUN pip install --no-cache-dir --user -r ${REQUIREMENTS_FILE}

FROM base
COPY --from=build-deps /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

COPY . .

RUN chmod +x entrypoint.prod.sh

EXPOSE 8000
# O entrypoint roda migrate e collectstatic antes de entregar o processo ao
# comando. O worker e o beat do Celery usam a mesma imagem e **passam por
# aqui também**: são idempotentes, e é o que garante que nenhum deles suba
# contra um banco sem migrar.
ENTRYPOINT ["./entrypoint.prod.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
