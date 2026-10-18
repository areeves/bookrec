FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/data/hf \
    BOOKREC_DB=/data/bookrec.sqlite

WORKDIR /app

# CPU-only PyTorch keeps the image far smaller than the default CUDA build.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src ./src
ENV PYTHONPATH=/app/src

ENTRYPOINT ["python", "-m", "bookrec"]
CMD ["--help"]
