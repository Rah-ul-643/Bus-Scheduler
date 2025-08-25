import os
import psycopg2
import psycopg2.extras
from flask import Flask, jsonify
from flask_cors import CORS
from datetime import datetime, timedelta

# --- Configuration ---
DB_CONFIG = {
    "dbname": "best_transit",
    "user": "postgres",
    "password": "my_secure_password",
    "host": "localhost",
    "port": "5432"
}

app = Flask(__name__)
CORS(app)

def get_db_connection():
    """Establishes a connection to the database."""
    return psycopg2.connect(**DB_CONFIG)

@app.route('/api/route-geometry', methods=['GET'])
def get_route_geometry():
    """
    Fetches the start and end coordinates for each route from the database.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        query = """
            SELECT
                r.route_short_name,
                start_stop.stop_lat as start_lat,
                start_stop.stop_lon as start_lon,
                end_stop.stop_lat as end_lat,
                end_stop.stop_lon as end_lon
            FROM routes r
            JOIN stops AS start_stop ON r.start_stop_id = start_stop.stop_id
            JOIN stops AS end_stop ON r.end_stop_id = end_stop.stop_id;
        """
        
        cur.execute(query)
        geometry_data = {}
        for row in cur.fetchall():
            geometry_data[row['route_short_name']] = [
                [row['start_lat'], row['start_lon']],
                [row['end_lat'], row['end_lon']]
            ]
        
        cur.close()
        return jsonify(geometry_data)
    except psycopg2.Error as e:
        print(f"Database error in /api/route-geometry: {e}")
        return jsonify({"error": "Database error occurred"}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/routes', methods=['GET'])
def get_routes():
    """
    Fetches the current state of all routes.
    Returns empty lists if prediction or schedule tables are empty.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        query = """
            WITH LatestPredictions AS (
                SELECT
                    route_id,
                    predicted_passengers,
                    ROW_NUMBER() OVER(PARTITION BY route_id ORDER BY generated_at DESC) as rn
                FROM route_demand_predictions
            ),
            ActiveBuses AS (
                SELECT
                    s.route_id,
                    COUNT(s.vehicle_id) as active_bus_count
                FROM hourly_dispatch_schedule s
                WHERE s.status = 'in_progress'
                GROUP BY s.route_id
            )
            SELECT
                r.route_id,
                r.route_short_name,
                COALESCE(lp.predicted_passengers, 0) as density,
                COALESCE(ab.active_bus_count, 0) as activebuses
            FROM routes r
            LEFT JOIN LatestPredictions lp ON r.route_short_name = lp.route_id AND lp.rn = 1
            LEFT JOIN ActiveBuses ab ON r.route_short_name = ab.route_id;
        """
        
        cur.execute(query)
        routes_data = cur.fetchall()
        cur.close()
        return jsonify([dict(row) for row in routes_data])
    except psycopg2.Error as e:
        print(f"Database error in /api/routes: {e}")
        return jsonify({"error": "Database error occurred"}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/dispatches', methods=['GET'])
def get_dispatches():
    """
    Fetches the dispatch schedule.
    Returns an empty list if no schedule is found.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        current_hour_start = datetime.now().replace(minute=0, second=0, microsecond=0)
        
        query = """
            SELECT
                s.schedule_id,
                s.vehicle_id,
                s.route_id,
                s.scheduled_departure_time,
                p.predicted_passengers
            FROM hourly_dispatch_schedule s
            LEFT JOIN route_demand_predictions p 
                ON s.route_id = p.route_id AND date_trunc('hour', s.scheduled_departure_time) = date_trunc('hour', p.prediction_timestamp)
            WHERE s.scheduled_departure_time >= %s
            ORDER BY s.scheduled_departure_time DESC
            LIMIT 50;
        """
        
        cur.execute(query, (current_hour_start,))
        dispatches_data = cur.fetchall()
        cur.close()
        return jsonify([dict(row) for row in dispatches_data])
    except psycopg2.Error as e:
        print(f"Database error in /api/dispatches: {e}")
        return jsonify({"error": "Database error occurred"}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
