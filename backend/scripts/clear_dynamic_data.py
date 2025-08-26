# clear_dynamic_data.py
# This script connects to the PostgreSQL database and clears all records from
# the tables that store dynamic, generated data (history, predictions, and schedules).

import sys
import psycopg2
from psycopg2 import sql

# --- DATABASE CONFIGURATION ---
# Replace with your actual PostgreSQL connection details
DB_CONFIG = {
    "host": "localhost",
    "database": "best_transit",
    "user": "postgres",
    "password": "my_secure_password",
    "port": "5432"
}

# --- TABLES TO CLEAR ---
# Add or remove table names here as needed.
TABLES_TO_CLEAR = [
    'historical_bus_data',
    'route_demand_predictions',
    'hourly_dispatch_schedule'
]

def clear_tables():
    """
    Connects to the database and truncates the specified tables.
    """
    conn = None
    print("--- Starting Table Cleanup Script ---")
    try:
        # Establish a connection to the database
        conn = psycopg2.connect(**DB_CONFIG)
        print("✅ Successfully connected to the database.")

        # A cursor allows us to execute commands
        with conn.cursor() as cur:
            for table_name in TABLES_TO_CLEAR:
                print(f"  -> Clearing table: {table_name}...")
                
                # Safely construct the SQL command to prevent SQL injection
                # TRUNCATE is faster than DELETE for clearing entire tables.
                # RESTART IDENTITY resets the auto-incrementing primary key counter.
                truncate_command = sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
                    sql.Identifier(table_name)
                )
                
                cur.execute(truncate_command)
        
        # Commit the transaction to make the changes permanent
        conn.commit()
        print("\n✅ All specified tables have been successfully cleared.")

    except psycopg2.Error as e:
        print(f"\n❌ An error occurred: {e}")
        print("   Rolling back transaction.")
        if conn:
            conn.rollback()
        sys.exit(1) # Exit with an error code
        
    finally:
        # Ensure the connection is always closed
        if conn:
            conn.close()
            print("--- Database connection closed. ---")

if __name__ == '__main__':
    clear_tables()