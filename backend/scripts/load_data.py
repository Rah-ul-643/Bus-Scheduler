import pandas as pd
from sqlalchemy import create_engine
import os

# --- Configuration ---
DB_USER = 'postgres'
DB_PASSWORD = 'my_secure_password' # Use the password from your docker-compose.yml
DB_HOST = 'localhost'
DB_PORT = '5432'
DB_NAME = 'best_transit'
DATASET_PATH = 'database_data.csv' # Make sure this file is in the same folder

# Create a database connection engine
engine = create_engine(f'postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}')

print(f"Loading dataset from {DATASET_PATH}...")
if not os.path.exists(DATASET_PATH):
    print(f"FATAL ERROR: Dataset not found at '{DATASET_PATH}'")
else:
    df = pd.read_csv(DATASET_PATH)
    # The column names in the CSV and DB table must match exactly.
    # Your data prep script uses 'transit_timestamp', which matches the DB.
    print(f"Found {len(df)} rows. Inserting into 'historical_bus_data' table...")

    # This will insert the data. 'if_exists='append'' adds the data without dropping the table.
    df.to_sql('historical_bus_data', engine, if_exists='append', index=False, chunksize=10000)

    print("✅ Data loading complete.")