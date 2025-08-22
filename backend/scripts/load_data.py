import pandas as pd
from sqlalchemy import create_engine, text
import os
import time
from datetime import datetime, timedelta
import numpy as np

# --- Configuration for LOCAL script ---
DB_USER = 'postgres'
DB_PASSWORD = 'my_secure_password' # Use the password from your docker-compose.yml
DB_HOST = 'localhost'
DB_PORT = '5432'
DB_NAME = 'best_transit'

db_url = f'postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}'
engine = create_engine(db_url)

def clear_existing_data(conn):
    """ Clears operational tables to ensure a fresh start. """
    print("\n--- Clearing existing operational data ---")
    tables_to_clear = [
        'hourly_dispatch_schedule', 'route_demand_predictions', 'vehicles_realtime',
        'routes', 'stops', 'depots', 'historical_bus_data'
    ]
    with conn.begin(): # Start a transaction
        for table in tables_to_clear:
            try:
                conn.execute(text(f'TRUNCATE TABLE {table} RESTART IDENTITY CASCADE;'))
                print(f"Cleared table: {table}")
            except Exception as e:
                print(f"Could not clear table {table}: {e}")

def populate_static_data(conn):
    """ Populates depots, stops, and routes with sample NYC data. """
    print("\n--- Populating static infrastructure data ---")
    
    # 1. Depots
    depots_df = pd.DataFrame({
        'depot_id': ['QUILL', 'KING', 'STENGEL', 'FLAT', 'YUKON'],
        'depot_name': ['Michael J. Quill Depot (Manhattan)', 'Kingsbridge Depot (Bronx)', 'Casey Stengel Depot (Queens)', 'Flatbush Depot (Brooklyn)', 'Yukon Depot (Staten Island)'],
        'latitude': [40.7608, 40.8845, 40.7538, 40.6418, 40.5736], 
        'longitude': [-73.9937, -73.9039, -73.8491, -73.9515, -74.1783]
    })
    depots_df['geom'] = 'POINT(' + depots_df['longitude'].astype(str) + ' ' + depots_df['latitude'].astype(str) + ')'
    depots_to_insert = depots_df[['depot_id', 'depot_name', 'geom']]
    depots_to_insert.to_sql('depots', conn, if_exists='append', index=False)
    print("✅ Populated 5 depots.")

    # 2. Stops
    stops_df = pd.DataFrame({
        'stop_id': ['MTA_401821', 'MTA_202322', 'MTA_502084', 'MTA_303118', 'MTA_803022'],
        'stop_name': ['State St/Whitehall St', 'Pelham Bay Park Station', 'Jamaica Center - Parsons/Archer', 'Kings Plaza', 'Staten Island Mall'],
        'stop_lat': [40.7022, 40.8523, 40.7022, 40.6094, 40.5794], 
        'stop_lon': [-74.013, -73.828, -73.794, -73.921, -74.168]
    })
    stops_df['geom'] = 'POINT(' + stops_df['stop_lon'].astype(str) + ' ' + stops_df['stop_lat'].astype(str) + ')'
    stops_df.to_sql('stops', conn, if_exists='append', index=False)
    print("✅ Populated 5 route starting stops.")

    # 3. Routes
    routes_df = pd.DataFrame({
        'route_id': ['MTA NYCT_M15-SBS', 'MTA NYCT_BX12-SBS', 'MTA NYCT_Q44-SBS', 'MTA NYCT_B46-SBS', 'MTA NYCT_S79-SBS'],
        'route_short_name': ['M15-SBS', 'BX12-SBS', 'Q44-SBS', 'B46-SBS', 'S79-SBS'],
        'route_long_name': ['Select Bus Service - East Side', 'Select Bus Service - Fordham Rd', 'Select Bus Service - Flushing/Jamaica', 'Select Bus Service - Utica Av', 'Select Bus Service - Hylan Blvd'],
        'route_type': [3, 3, 3, 3, 3],
        'start_stop_id': ['MTA_401821', 'MTA_202322', 'MTA_502084', 'MTA_303118', 'MTA_803022']
    })
    routes_df.to_sql('routes', conn, if_exists='append', index=False)
    print("✅ Populated 5 major routes.")

def populate_vehicle_fleet(conn):
    """ Creates a sample fleet of buses and assigns them to depots. """
    print("\n--- Populating vehicle fleet ---")
    depots_df = pd.read_sql("SELECT depot_id, ST_X(geom) as lon, ST_Y(geom) as lat FROM depots", conn)
    vehicles = []
    bus_count = 0
    for _, depot in depots_df.iterrows():
        for i in range(5): # Add 5 buses to each depot for a total of 25
            bus_count += 1
            vehicles.append({
                'vehicle_id': f'BUS-{bus_count:03d}',
                'current_lat': depot['lat'], 'current_lon': depot['lon'],
                'current_occupancy': 0, 'total_capacity': 60,
                'status': 'available', 'home_depot_id': depot['depot_id']
            })
    vehicles_df = pd.DataFrame(vehicles)
    vehicles_df.to_sql('vehicles_realtime', conn, if_exists='append', index=False)
    print(f"✅ Populated {len(vehicles_df)} vehicles and stationed them at their home depots.")

def generate_synthetic_historical_data(conn):
    """
    Generates a plausible 24-hour historical dataset to bootstrap the model.
    """
    print("\n--- Generating synthetic historical data for the last 24 hours ---")
    
    routes_df = pd.read_sql("SELECT route_short_name FROM routes", conn)
    routes = routes_df['route_short_name'].tolist()
    
    end_time = datetime.now().replace(minute=0, second=0, microsecond=0)
    start_time = end_time - timedelta(hours=24)
    
    timestamps = pd.to_datetime(pd.date_range(start=start_time, end=end_time, freq='H'))
    
    all_data = []
    for route in routes:
        for ts in timestamps:
            hour = ts.hour
            # Create a plausible ridership pattern (low at night, peaks in morning/evening)
            if 4 <= hour <= 6: ridership = np.random.randint(20, 50)
            elif 7 <= hour <= 9: ridership = np.random.randint(150, 250)
            elif 16 <= hour <= 18: ridership = np.random.randint(180, 280)
            else: ridership = np.random.randint(50, 150)
            
            data_point = {
                'transit_timestamp': ts,
                'route': route,
                'ridership': ridership,
                'hour_of_day': hour,
                'day_of_week': ts.dayofweek,
                'day_of_year': ts.dayofyear,
                'month': ts.month,
                'is_weekend': 1 if ts.dayofweek >= 5 else 0,
                'hour_sin': np.sin(2 * np.pi * hour / 24),
                'hour_cos': np.cos(2 * np.pi * hour / 24),
                'day_of_week_sin': np.sin(2 * np.pi * ts.dayofweek / 7),
                'day_of_week_cos': np.cos(2 * np.pi * ts.dayofweek / 7),
                'is_public_holiday': 0, 'is_local_event': 0,
                'ridership_lag_1hr': ridership * 0.9, 'ridership_lag_24hr': ridership * 1.1,
                'ridership_lag_168hr': ridership * 1.0,
                'temperature': np.random.uniform(15, 25), 'precipitation': np.random.uniform(0, 1),
                'wind_speed': np.random.uniform(5, 15), 'snowfall': 0,
                'avg_route_volume': np.random.randint(500, 1500)
            }
            all_data.append(data_point)
            
    df = pd.DataFrame(all_data)
    print(f"Generated {len(df)} rows of synthetic data. Inserting into 'historical_bus_data' table...")
    df.to_sql('historical_bus_data', conn, if_exists='append', index=False, chunksize=10000)
    print("✅ Synthetic historical data loading complete.")


if __name__ == "__main__":
    print("Attempting to connect to the database...")
    retries = 10
    connection = None
    while retries > 0:
        try:
            connection = engine.connect()
            print("✅ Database connection successful.")
            break
        except Exception as e:
            print(f"⏳ Database not ready yet, retrying in 5 seconds...")
            retries -= 1
            time.sleep(5)
            if retries == 0:
                print("❌ Could not connect to the database. Aborting.")
                exit(1)

    if connection:
        clear_existing_data(connection)
        populate_static_data(connection)
        populate_vehicle_fleet(connection)
        generate_synthetic_historical_data(connection) # Call the new generator function
        connection.close()
        print("\n🎉 Database setup and population finished successfully!")
