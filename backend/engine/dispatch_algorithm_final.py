import os
import time
import requests
import numpy as np
import pandas as pd
import psycopg2
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from demand_model import DemandPredictionModel

# --- Configuration ---
DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "best_transit"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "my_secure_password"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432")
}
db_url = f'postgresql://{DB_CONFIG["user"]}:{DB_CONFIG["password"]}@{DB_CONFIG["host"]}:{DB_CONFIG["port"]}/{DB_CONFIG["dbname"]}'

MODEL_PATH = 'nyc_bus_demand_transformer.keras'
PREPROCESSOR_PATH = 'nyc_preprocessor_transformer.pkl'
ROUTE_ENCODER_PATH = 'nyc_route_encoder_transformer.pkl'

EFFECTIVE_BUS_CAPACITY = 50
TRIP_DURATION_MINUTES = 55
NYC_LAT, NYC_LON = 40.71, -74.01

# --- Placeholder External API Functions ---
# These functions should be implemented to call real-world data sources.

def fetch_holiday_and_event_data(target_date):
    """
    Placeholder: Fetches public holiday and local event data for a given date.
    Should return a dictionary, e.g., {'is_public_holiday': 0, 'is_local_event': 1}
    APIs to consider: Abstract API, Calendarific, Nager.Date
    """
    print("ℹ️ Placeholder: Fetching holiday/event data.")
    return {'is_public_holiday': 0, 'is_local_event': 0}

def fetch_lagged_ridership(db_conn, route_id, target_hour):
    """
    Placeholder: Fetches historical ridership for lag features from the database.
    This is a more complex query that would look back 1, 24, and 168 hours.
    """
    print(f"ℹ️ Placeholder: Fetching lagged ridership for route {route_id}.")
    # For simplicity, we'll query the last known ridership as a stand-in.
    with db_conn.cursor() as cur:
        query = "SELECT ridership FROM historical_bus_data WHERE route = %s ORDER BY transit_timestamp DESC LIMIT 1;"
        cur.execute(query, (route_id,))
        last_ridership = cur.fetchone()
        if last_ridership:
            return {
                'lag_1hr': last_ridership[0],
                'lag_24hr': last_ridership[0],
                'lag_168hr': last_ridership[0]
            }
    return {'lag_1hr': 50, 'lag_24hr': 50, 'lag_168hr': 50} # Default fallback

def fetch_avg_route_volume(db_conn, route_id):
    """
    Placeholder: Calculates the average route volume.
    This could be a rolling average from the historical data table.
    """
    print(f"ℹ️ Placeholder: Fetching average route volume for {route_id}.")
    # Simple average of the last 24 hours for this route as an example.
    with db_conn.cursor() as cur:
        query = "SELECT AVG(ridership) FROM (SELECT ridership FROM historical_bus_data WHERE route = %s ORDER BY transit_timestamp DESC LIMIT 24) as last24;"
        cur.execute(query, (route_id,))
        avg_volume = cur.fetchone()
        if avg_volume and avg_volume[0] is not None:
            return avg_volume[0]
    return 400 # Default fallback


class DispatchScheduler:
    def __init__(self):
        """Initializes the scheduler, connects to the DB, and loads the ML model."""
        self.db_connection = None
        self.connect_to_db()
        self.prediction_model = DemandPredictionModel(MODEL_PATH, PREPROCESSOR_PATH, ROUTE_ENCODER_PATH)

    def connect_to_db(self):
        """Establishes a persistent connection to the database with retry logic."""
        retries = 10
        while retries > 0:
            try:
                self.db_connection = psycopg2.connect(**DB_CONFIG)
                print("✅ Successfully connected to PostgreSQL database.")
                return
            except psycopg2.OperationalError as e:
                print(f"❌ DB connection error: {e}. Retrying in 5s...")
                retries -= 1
                time.sleep(5)
        raise Exception("Could not connect to the database.")

    def run_cleanup_phase(self, current_time):
        """Marks old trips as 'completed' and makes their buses 'available' again."""
        print(f"\n--- Cleanup Phase: Checking for trips completed before {current_time.strftime('%Y-%m-%d %H:%M')} ---")
        completion_threshold = current_time - timedelta(minutes=TRIP_DURATION_MINUTES)
        
        with self.db_connection.cursor() as cur:
            find_completed_query = """
                SELECT vehicle_id FROM hourly_dispatch_schedule
                WHERE status = 'in_progress' AND scheduled_departure_time < %s;
            """
            cur.execute(find_completed_query, (completion_threshold,))
            vehicles_to_free = [row[0] for row in cur.fetchall()]

            if not vehicles_to_free:
                print("No vehicles to free up in this cycle.")
                return

            print(f"Found {len(vehicles_to_free)} vehicles from completed trips to make available.")
            
            update_schedule_query = "UPDATE hourly_dispatch_schedule SET status = 'completed' WHERE vehicle_id = ANY(%s) AND status = 'in_progress';"
            cur.execute(update_schedule_query, (vehicles_to_free,))

            update_vehicles_query = "UPDATE vehicles_realtime SET status = 'available' WHERE vehicle_id = ANY(%s);"
            cur.execute(update_vehicles_query, (vehicles_to_free,))
            
            self.db_connection.commit()
            print(f"✅ Freed {len(vehicles_to_free)} buses back into the available pool.")

    def fetch_weather_data(self, target_hour):
        """Fetches weather data for a specific hour from Open-Meteo API."""
        print("Fetching weather data from Open-Meteo API...")
        try:
            api_url = (
                f"https://api.open-meteo.com/v1/forecast?latitude={NYC_LAT}&longitude={NYC_LON}"
                f"&hourly=temperature_2m,precipitation,wind_speed_10m,snowfall&timezone=America/New_York"
            )
            response = requests.get(api_url)
            response.raise_for_status()
            data = response.json()
            
            hourly_data = pd.DataFrame(data['hourly'])
            hourly_data['time'] = pd.to_datetime(hourly_data['time'])
            
            weather_at_hour = hourly_data[hourly_data['time'] == target_hour]
            if not weather_at_hour.empty:
                return weather_at_hour.iloc[0].to_dict()
        except Exception as e:
            print(f"⚠️ Weather API call failed: {e}. Using default values.")
        return {'temperature_2m': 15.0, 'precipitation': 0.0, 'wind_speed_10m': 10.0, 'snowfall': 0.0}

    def run_prediction_phase(self, target_hour):
        """Predicts demand for the next hour based on the last 24 hours of historical data."""
        print(f"\n--- Phase A: Running Predictions for Hour Starting {target_hour.strftime('%Y-%m-%d %H:%00')} ---")
        routes_df = pd.read_sql("SELECT DISTINCT route FROM historical_bus_data;", self.db_connection)
        
        predictions = []
        for route_id in routes_df['route']:
            query = f"SELECT * FROM historical_bus_data WHERE route = '{route_id}' ORDER BY transit_timestamp DESC LIMIT 24;"
            historical_df = pd.read_sql(query, self.db_connection)
            
            if len(historical_df) < 24:
                print(f"⚠️ Skipping prediction for route {route_id}: not enough data.")
                continue

            historical_df = historical_df.sort_values('transit_timestamp').reset_index(drop=True)
            historical_df.rename(columns={'ridership': 'passengers'}, inplace=True)

            try:
                predicted_passengers = self.prediction_model.predict(historical_df)
                predictions.append({'prediction_timestamp': target_hour, 'route_id': route_id, 'predicted_passengers': int(predicted_passengers)})
                print(f"✅ Predicted {int(predicted_passengers)} passengers for route {route_id}.")
            except Exception as e:
                print(f"❌ Prediction failed for route {route_id}: {e}")

        if predictions:
            predictions_df = pd.DataFrame(predictions)
            predictions_df.to_sql('route_demand_predictions', create_engine(db_url), if_exists='append', index=False)
            print(f"✅ Saved {len(predictions)} new predictions to the database.")
        
        return predictions

    def run_history_update_phase(self, new_predictions):
        """Takes newly generated predictions and inserts them into the historical data table."""
        print(f"\n--- Phase B: Updating History with {len(new_predictions)} New Records ---")
        if not new_predictions:
            print("No new predictions to add to history.")
            return

        target_hour = new_predictions[0]['prediction_timestamp']
        weather_data = self.fetch_weather_data(target_hour)
        event_data = fetch_holiday_and_event_data(target_hour)
        new_history_rows = []

        for pred in new_predictions:
            ts = pred['prediction_timestamp']
            route_id = pred['route_id']
            
            # Fetch placeholder data using the new functions
            lag_data = fetch_lagged_ridership(self.db_connection, route_id, ts)
            avg_volume = fetch_avg_route_volume(self.db_connection, route_id)

            new_row = {
                'transit_timestamp': ts, 'route': route_id, 'ridership': pred['predicted_passengers'],
                'hour_of_day': ts.hour, 'day_of_week': ts.dayofweek, 'day_of_year': ts.dayofyear,
                'month': ts.month, 'is_weekend': 1 if ts.dayofweek >= 5 else 0,
                'hour_sin': np.sin(2 * np.pi * ts.hour / 24), 'hour_cos': np.cos(2 * np.pi * ts.hour / 24),
                'day_of_week_sin': np.sin(2 * np.pi * ts.dayofweek / 7), 'day_of_week_cos': np.cos(2 * np.pi * ts.dayofweek / 7),
                'is_public_holiday': event_data['is_public_holiday'],
                'is_local_event': event_data['is_local_event'],
                'temperature': weather_data['temperature_2m'],
                'precipitation': weather_data['precipitation'],
                'wind_speed': weather_data['wind_speed_10m'],
                'snowfall': weather_data['snowfall'],
                'ridership_lag_1hr': lag_data['lag_1hr'],
                'ridership_lag_24hr': lag_data['lag_24hr'],
                'ridership_lag_168hr': lag_data['lag_168hr'],
                'avg_route_volume': avg_volume
            }
            new_history_rows.append(new_row)
        
        new_history_df = pd.DataFrame(new_history_rows)
        new_history_df.to_sql('historical_bus_data', create_engine(db_url), if_exists='append', index=False)
        print(f"✅ Updated historical_bus_data with {len(new_history_df)} new rows for {target_hour.strftime('%H:%M')}.")

    def run_scheduling_phase(self, target_hour):
        """Generates the dispatch schedule for the next hour based on predictions."""
        print(f"\n--- Phase C: Generating Schedule for Hour Starting {target_hour.strftime('%Y-%m-%d %H:%00')} ---")
        
        preds_query = f"""
            SELECT p.route_id, p.predicted_passengers, r.start_stop_id 
            FROM route_demand_predictions p
            JOIN routes r ON p.route_id = r.route_short_name
            WHERE prediction_timestamp = '{target_hour.strftime('%Y-%m-%d %H:%00:00')}';
        """
        predictions_df = pd.read_sql(preds_query, self.db_connection)
        if predictions_df.empty:
            print("No predictions found for the target hour. Skipping scheduling.")
            return
            
        predictions_df['required_buses'] = (predictions_df['predicted_passengers'] / EFFECTIVE_BUS_CAPACITY).apply(lambda x: max(1, round(x)))
        predictions_df['priority_score'] = predictions_df['predicted_passengers']
        predictions_df.sort_values('priority_score', ascending=False, inplace=True)

        available_buses = pd.read_sql("SELECT vehicle_id, home_depot_id FROM vehicles_realtime WHERE status = 'available';", self.db_connection).to_dict('records')
        
        new_schedule = []
        with self.db_connection.cursor() as cur:
            for _, route_info in predictions_df.iterrows():
                if not available_buses:
                    print("⚠️ Ran out of available buses. Cannot schedule remaining routes.")
                    break

                buses_needed = int(route_info['required_buses'])
                
                find_closest_buses_query = """
                    SELECT v.vehicle_id, v.home_depot_id
                    FROM vehicles_realtime v JOIN depots d ON v.home_depot_id = d.depot_id
                    WHERE v.status = 'available'
                    ORDER BY d.geom <-> (SELECT geom FROM stops WHERE stop_id = %s)
                    LIMIT %s;
                """
                cur.execute(find_closest_buses_query, (route_info['start_stop_id'], buses_needed))
                assigned_buses = [{'vehicle_id': row[0], 'home_depot_id': row[1]} for row in cur.fetchall()]

                if len(assigned_buses) < buses_needed:
                    print(f"⚠️ Could only find {len(assigned_buses)}/{buses_needed} buses for route {route_info['route_id']}.")
                
                if not assigned_buses: continue

                assigned_ids = {bus['vehicle_id'] for bus in assigned_buses}
                available_buses = [bus for bus in available_buses if bus['vehicle_id'] not in assigned_ids]
                
                headway_minutes = 60 / len(assigned_buses)
                for i, bus in enumerate(assigned_buses):
                    departure_time = target_hour + timedelta(minutes=i * headway_minutes)
                    trip_id = f"SCHED-{route_info['route_id']}-{departure_time.strftime('%Y%m%d%H%M%S')}-{i}"
                    new_schedule.append((route_info['route_id'], trip_id, bus['vehicle_id'], departure_time))

            if new_schedule:
                schedule_insert_query = "INSERT INTO hourly_dispatch_schedule (route_id, trip_id, vehicle_id, scheduled_departure_time, status) VALUES (%s, %s, %s, %s, 'in_progress');"
                cur.executemany(schedule_insert_query, new_schedule)
                
                assigned_vehicle_ids = [s[2] for s in new_schedule]
                update_status_query = "UPDATE vehicles_realtime SET status = 'in_service' WHERE vehicle_id = ANY(%s);"
                cur.execute(update_status_query, (assigned_vehicle_ids,))
                
                self.db_connection.commit()
                print(f"✅ Generated and saved a new schedule with {len(new_schedule)} trips.")

    def run_hourly_cycle(self):
        """The main loop that runs once per hour."""
        while True:
            now = datetime.now()
            next_hour = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
            
            self.run_cleanup_phase(now)
            new_predictions = self.run_prediction_phase(next_hour)
            self.run_history_update_phase(new_predictions)
            self.run_scheduling_phase(next_hour)
            
            next_run_time = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            wait_seconds = (next_run_time - datetime.now()).total_seconds()
            print(f"\n--- Cycle complete. Waiting {wait_seconds / 60:.2f} minutes for the next cycle. ---")
            time.sleep(max(1, wait_seconds))


if __name__ == '__main__':
    scheduler = DispatchScheduler()
    scheduler.run_hourly_cycle()
