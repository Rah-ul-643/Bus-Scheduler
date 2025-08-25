import requests
import zipfile
import io
import pandas as pd
import numpy as np
import os

# --- Configuration ---

# The specific list of routes the model was trained on.
TRAINED_ROUTES = [
    'B1', 'B100', 'B101', 'B103', 'B106', 'B11', 'B111', 
    'B12', 'B13', 'B14', 'B15', 'B16', 'B17'
]

# GTFS URL for Brooklyn, since all trained routes are in Brooklyn.
GTFS_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip'

# Hardcoded Brooklyn depots relevant to the trained routes.
DEPOTS = [
    {'depot_name': 'East New York Depot', 'depot_id': 'east_new_york', 'lon': -73.899747, 'lat': 40.678063, 'capacity': 280},
    {'depot_name': 'Flatbush Depot', 'depot_id': 'flatbush', 'lon': -73.927059, 'lat': 40.615736, 'capacity': 250}, # Assumed capacity
    {'depot_name': 'Jackie Gleason Depot', 'depot_id': 'jackie_gleason', 'lon': -74.001923, 'lat': 40.651932, 'capacity': 270} # Assumed capacity
]

def fetch_gtfs_data():
    """
    Fetches and processes GTFS data specifically for the TRAINED_ROUTES list.
    """
    all_routes = []
    all_stops = {}
    route_start_end = {}

    print(f"Fetching GTFS for Brooklyn...")
    try:
        response = requests.get(GTFS_URL, timeout=30)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"  -> Failed to fetch Brooklyn GTFS: {e}")
        return [], {}, {}
    
    try:
        zip_file = zipfile.ZipFile(io.BytesIO(response.content))
        
        # Read all necessary files from the zip archive
        with zip_file.open('routes.txt') as f:
            routes_df = pd.read_csv(f, dtype={'route_id': str, 'route_short_name': str})
        with zip_file.open('trips.txt') as f:
            trips_df = pd.read_csv(f, dtype={'route_id': str, 'trip_id': str})
        with zip_file.open('stop_times.txt') as f:
            stop_times_df = pd.read_csv(f, dtype={'trip_id': str, 'stop_id': str})
        with zip_file.open('stops.txt') as f:
            stops_df = pd.read_csv(f, dtype={'stop_id': str})
        
        # *** MODIFIED: Filter routes to only include the ones we trained on ***
        routes_df = routes_df[routes_df['route_short_name'].isin(TRAINED_ROUTES)]
        print(f"  -> Found {len(routes_df)} of the target routes in the GTFS data.")

        # Process stops into a dictionary for quick lookups
        all_stops = stops_df.set_index('stop_id')[['stop_name', 'stop_lat', 'stop_lon']].to_dict('index')

        # Process the filtered routes to find their start and end stops
        for _, route in routes_df.iterrows():
            route_id = route['route_id']
            route_trips = trips_df[trips_df['route_id'] == route_id]
            if route_trips.empty:
                continue
            
            # Use the first trip as a representative example for the route's path
            trip_id = route_trips.iloc[0]['trip_id']
            
            trip_stops = stop_times_df[stop_times_df['trip_id'] == trip_id].sort_values('stop_sequence')
            if len(trip_stops) < 2:
                continue
                
            start_stop_id = trip_stops.iloc[0]['stop_id']
            end_stop_id = trip_stops.iloc[-1]['stop_id']
            
            all_routes.append({
                'route_id': route_id, 
                'route_short_name': str(route['route_short_name'])
            })
            route_start_end[route_id] = (start_stop_id, end_stop_id)
        
    except (KeyError, pd.errors.EmptyDataError, zipfile.BadZipFile) as e:
        print(f"  -> Error processing GTFS data: {e}")

    # Filter the master stop list to only include stops that are actually used
    used_stops = {stop for start, end in route_start_end.values() for stop in (start, end)}
    filtered_stops = {sid: all_stops[sid] for sid in used_stops if sid in all_stops}
    
    print(f"\nTotal routes to process: {len(all_routes)}")
    print(f"Total unique start/end stops: {len(filtered_stops)}")
    
    return all_routes, filtered_stops, route_start_end

def generate_sql(all_routes, filtered_stops, route_start_end):
    """
    Generates the SQL INSERT statements for the filtered data.
    """
    sql_lines = ["BEGIN;"]
    
    # Depots
    print("Generating SQL for depots...")
    for depot in DEPOTS:
        geom = f"ST_MakePoint({depot['lon']}, {depot['lat']})"
        sql_lines.append(
            f"INSERT INTO depots (depot_id, depot_name, geom) VALUES ('{depot['depot_id']}', '{depot['depot_name'].replace("'", "''")}', {geom});"
        )
    
    # Stops
    print(f"Generating SQL for {len(filtered_stops)} stops...")
    for stop_id, stop in filtered_stops.items():
        stop_name = str(stop.get('stop_name', 'Unknown Stop')).replace("'", "''")
        stop_lon = stop.get('stop_lon', 0)
        stop_lat = stop.get('stop_lat', 0)
        geom = f"ST_MakePoint({stop_lon}, {stop_lat})"
        sql_lines.append(
            f"INSERT INTO stops (stop_id, stop_name, stop_lat, stop_lon, geom) VALUES ('{stop_id}', '{stop_name}', {stop_lat}, {stop_lon}, {geom});"
        )
    
    # Routes
    print(f"Generating SQL for {len(all_routes)} routes...")
    for route in all_routes:
        route_id = route['route_id']
        short_name = route['route_short_name'].replace("'", "''")
        start, end = route_start_end.get(route_id, (None, None))
        if start and end:
            sql_lines.append(
                f"INSERT INTO routes (route_id, route_short_name, start_stop_id, end_stop_id) VALUES ('{route_id}', '{short_name}', '{start}', '{end}');"
            )
    
    # Vehicles - simulate for the relevant Brooklyn depots
    print("Generating SQL for simulated vehicles...")
    for depot in DEPOTS:
        capacity = depot['capacity'] or 150  # Default to 150 if capacity is not known
        for i in range(1, capacity + 1):
            vehicle_id = f"BUS-{depot['depot_id'].upper()}-{i:03d}"
            sql_lines.append(
                f"INSERT INTO vehicles_realtime (vehicle_id, status, home_depot_id) VALUES ('{vehicle_id}', 'available', '{depot['depot_id']}');"
            )
    
    sql_lines.append("COMMIT;")
    return sql_lines

if __name__ == '__main__':
    output_dir = 'generated_sql'
    os.makedirs(output_dir, exist_ok=True)
    
    all_routes, filtered_stops, route_start_end = fetch_gtfs_data()
    
    if not all_routes or not filtered_stops:
        print("\nNo data fetched. Aborting SQL generation.")
    else:
        sql_lines = generate_sql(all_routes, filtered_stops, route_start_end)
        
        output_file = os.path.join(output_dir, 'static_data_trained_routes.sql')
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(sql_lines))
        
        print(f"\nGenerated SQL file: {output_file} with {len(sql_lines)} lines.")
