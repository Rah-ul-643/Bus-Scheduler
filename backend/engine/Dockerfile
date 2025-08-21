FROM python:3.9-slim-buster
WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential libgdal-dev g++ --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all python scripts, the model, and the preprocessors
COPY . .

CMD ["python", "dispatch_algorithm_final.py"]
