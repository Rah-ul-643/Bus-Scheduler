# Use a newer, supported Debian version ("bullseye") instead of the outdated "buster"
FROM python:3.9-slim-bullseye

# Set the working directory inside the container.
WORKDIR /app

# Install system dependencies required by GeoPandas and Psycopg2.
RUN apt-get update && apt-get install -y \
    build-essential \
    libgdal-dev \
    g++ \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Copy the requirements file first to leverage Docker's layer caching.
COPY requirement_list.txt .

# Install Python dependencies.
RUN pip install --no-cache-dir -r requirement_list.txt

# Copy all python scripts, the model, and the preprocessors
COPY . .

# The command to run when the container starts.
CMD ["python", "dispatch_algorithm_final.py"]
