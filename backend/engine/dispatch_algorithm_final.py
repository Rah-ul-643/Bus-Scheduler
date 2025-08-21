import time
import os
import psycopg2
import pandas as pd
from datetime import datetime, timedelta
from demand_model import DemandPredictionModel

# --- Configuration ---
DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "best_transit"), "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "your_password"), "host": os.getenv("DB_HOST", "db"),
    "port": os.getenv("DB_PORT", "5432")
}
MODEL_PATH = 'nyc_bus_demand_transformer.h5'
PREPROCESSOR_PATH = 'nyc_preprocessor_transformer.pkl'
ROUTE_ENCODER_PATH = 'nyc_route_encoder_transformer.pkl'
EFFECTIVE_BUS_CAPACITY = 50 # Avg passengers a bus can comfortably serve per hour
TRIP_DURATION_MINUTES = 55 # An assumption for how long a trip takes

class DispatchScheduler:
    def __init__(self):
        self.db_connection = None
        self.connect_to_db()
        self.prediction_model = DemandPredictionModel(MODEL_PATH, PREPROCESSOR_PATH, ROUTE_ENCODER_PATH)

    def connect_to_db(self):
        # Connect to the database with retry logic
        retries = 10
        while retries > 0:
            try:
                self.db_connection = psycopg2.connect(**DB_CONFIG)
                print("✅ Successfully connected to PostgreSQL database.")
                return
            except psycopg2.OperationalError as e:
                print(f"❌ DB connection error: {e}. Retrying in 5s...")
                retries -= 1; time.sleep(5)
        raise Exception("Could not connect to the database.")

    def run_cleanup_phase(self, current_time):
        """
        Marks old trips as 'completed' and makes their buses 'available' again.
        This is the crucial step for replenishing the bus resource pool.
        """
        print(f"\n--- Phase C: Running Cleanup for Trips before {current_time.strftime('%Y-%m-%d %H:%M')} ---")
        completion_threshold = current_time - timedelta(minutes=TRIP_DURATION_MINUTES)
        
        with self.db_connection.cursor() as cur:
            # Find trips that started long enough ago to be considered complete
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

            # Update the schedule table
            update_schedule_query = """
                UPDATE hourly_dispatch_schedule SET status = 'completed'
                WHERE vehicle_id = ANY(%s) AND status = 'in_progress';
            """
            cur.execute(update_schedule_query, (vehicles_to_free,))

            # Update the vehicles_realtime table to make buses available
            update_vehicles_query = """
                UPDATE vehicles_realtime SET status = 'available'
                WHERE vehicle_id = ANY(%s);
            """
            cur.execute(update_vehicles_query, (vehicles_to_free,))
            
            self.db_connection.commit()
            print(f"✅ Freed {len(vehicles_to_free)} buses back into the available pool.")


    def run_prediction_phase(self, target_hour):
        print(f"\n--- Phase A: Running Predictions for Hour Starting {target_hour.strftime('%Y-%m-%d %H:00')} ---")
        routes_query = "SELECT DISTINCT route FROM historical_bus_data;"
        routes_df = pd.read_sql(routes_query, self.db_connection)
        
        predictions = []
        for route_id in routes_df['route']:
            query = f"""
                SELECT * FROM historical_bus_data 
                WHERE route = '{route_id}' AND transit_timestamp < '{target_hour.strftime('%Y-%m-%d %H:00:00')}'
                ORDER BY transit_timestamp DESC LIMIT 24;
            """
            historical_df = pd.read_sql(query, self.db_connection)
            historical_df = historical_df.sort_values('transit_timestamp').reset_index(drop=True)
            historical_df.rename(columns={'ridership': 'passengers'}, inplace=True)

            if len(historical_df) < 24:
                print(f"⚠️ Skipping prediction for route {route_id}: not enough data.")
                continue

            try:
                predicted_passengers = self.prediction_model.predict(historical_df)
                predictions.append((target_hour, route_id, int(predicted_passengers)))
                print(f"✅ Predicted {int(predicted_passengers)} passengers for route {route_id}.")
            except Exception as e:
                print(f"❌ Prediction failed for route {route_id}: {e}")

        if predictions:
            with self.db_connection.cursor() as cur:
                insert_query = "INSERT INTO route_demand_predictions (prediction_timestamp, route_id, predicted_passengers) VALUES (%s, %s, %s);"
                cur.executemany(insert_query, predictions)
                self.db_connection.commit()
            print(f"✅ Saved {len(predictions)} predictions to the database.")

    def run_scheduling_phase(self, target_hour):
        print(f"\n--- Phase B: Generating Schedule for Hour Starting {target_hour.strftime('%Y-%m-%d %H:00')} ---")
        
        preds_query = f"""
            SELECT p.route_id, p.predicted_passengers, r.start_stop_id 
            FROM route_demand_predictions p
            JOIN routes r ON p.route_id = r.route_short_name
            WHERE prediction_timestamp = '{target_hour.strftime('%Y-%m-%d %H:00:00')}';
        """
        predictions_df = pd.read_sql(preds_query, self.db_connection)
        if predictions_df.empty:
            print("No predictions found for the target hour. Skipping scheduling.")
            return
            
        predictions_df['required_buses'] = (predictions_df['predicted_passengers'] / EFFECTIVE_BUS_CAPACITY).apply(lambda x: max(1, round(x)))
        predictions_df['priority_score'] = predictions_df['predicted_passengers']
        predictions_df = predictions_df.sort_values('priority_score', ascending=False).reset_index()

        available_buses_query = "SELECT vehicle_id, home_depot_id FROM vehicles_realtime WHERE status = 'available';"
        available_buses_df = pd.read_sql(available_buses_query, self.db_connection)
        available_buses = available_buses_df.to_dict('records')
        
        new_schedule = []
        with self.db_connection.cursor() as cur:
            for _, route_info in predictions_df.iterrows():
                if not available_buses:
                    print("⚠️ Ran out of available buses. Cannot schedule remaining routes.")
                    break

                buses_needed = int(route_info['required_buses'])
                
                # *** NON-SIMPLIFIED BUS ASSIGNMENT LOGIC ***
                # Find the N closest available buses to the route's start point.
                find_closest_buses_query = """
                    SELECT v.vehicle_id, v.home_depot_id
                    FROM vehicles_realtime v
                    JOIN depots d ON v.home_depot_id = d.depot_id
                    WHERE v.status = 'available'
                    ORDER BY d.geom <-> (SELECT geom FROM stops WHERE stop_id = %s)
                    LIMIT %s;
                """
                cur.execute(find_closest_buses_query, (route_info['start_stop_id'], buses_needed))
                assigned_buses = [{'vehicle_id': row[0], 'home_depot_id': row[1]} for row in cur.fetchall()]

                if len(assigned_buses) < buses_needed:
                    print(f"⚠️ Could only find {len(assigned_buses)}/{buses_needed} buses for route {route_info['route_id']}.")
                
                if not assigned_buses: continue

                # Remove assigned buses from the available pool
                assigned_ids = {bus['vehicle_id'] for bus in assigned_buses}
                available_buses = [bus for bus in available_buses if bus['vehicle_id'] not in assigned_ids]
                
                # Calculate headway and generate schedule for this route
                headway_minutes = 60 / len(assigned_buses)
                for i, bus in enumerate(assigned_buses):
                    departure_time = target_hour + timedelta(minutes=i * headway_minutes)
                    trip_id = f"SCHED-{route_info['route_id']}-{departure_time.strftime('%Y%m%d%H%M%S')}-{i}"
                    new_schedule.append((route_info['route_id'], trip_id, bus['vehicle_id'], departure_time))

            # Batch insert the new schedule and update bus statuses
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
            # The hour we are planning FOR is the next full hour
            target_hour = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
            
            # Run the three phases in order
            self.run_cleanup_phase(now)
            self.run_prediction_phase(target_hour)
            self.run_scheduling_phase(target_hour)
            
            # Wait until the start of the next hour to run again
            next_run_time = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            wait_seconds = (next_run_time - datetime.now()).total_seconds()
            print(f"\n--- Cycle complete. Waiting {wait_seconds / 60:.2f} minutes for the next cycle. ---")
            time.sleep(max(1, wait_seconds))


if __name__ == '__main__':
    scheduler = DispatchScheduler()
    scheduler.run_hourly_cycle()
