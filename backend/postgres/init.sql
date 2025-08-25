-- =================================================================================
-- Final PostgreSQL/PostGIS Database Model for the Route-Based Scheduler (Simplified)
-- =================================================================================

-- Ensure the PostGIS extension is enabled in your database
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop tables in reverse order of dependency to ensure a clean setup
DROP TABLE IF EXISTS hourly_dispatch_schedule;
DROP TABLE IF EXISTS route_demand_predictions;
DROP TABLE IF EXISTS historical_bus_data;
DROP TABLE IF EXISTS vehicles_realtime;
DROP TABLE IF EXISTS depots;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS stops;


-- =================================================================================
-- Core Asset Tables
-- =================================================================================

CREATE TABLE depots (
    depot_id VARCHAR(255) PRIMARY KEY,
    depot_name VARCHAR(255) NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX idx_depots_geom ON depots USING GIST (geom);


CREATE TABLE stops (
    stop_id VARCHAR(255) PRIMARY KEY,
    stop_name VARCHAR(255) NOT NULL,
    stop_lat DOUBLE PRECISION NOT NULL,
    stop_lon DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326)
);
CREATE INDEX idx_stops_geom ON stops USING GIST (geom);


CREATE TABLE routes (
    route_id VARCHAR(255) PRIMARY KEY,
    route_short_name VARCHAR(50) NOT NULL,
    start_stop_id VARCHAR(255) REFERENCES stops(stop_id),
    end_stop_id VARCHAR(255) REFERENCES stops(stop_id) -- New column for the end point
);


CREATE TABLE vehicles_realtime (
    vehicle_id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(50) NOT NULL CHECK (status IN ('in_service', 'available', 'maintenance')),
    home_depot_id VARCHAR(255) REFERENCES depots(depot_id)
);


-- =================================================================================
-- Prediction & Scheduling Tables
-- =================================================================================

CREATE TABLE historical_bus_data (
    transit_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    route VARCHAR(255) NOT NULL,
    ridership REAL,
    hour_of_day INT,
    day_of_week INT,
    day_of_year INT,
    month INT,
    is_weekend INT,
    hour_sin REAL,
    hour_cos REAL,
    day_of_week_sin REAL,
    day_of_week_cos REAL,
    is_public_holiday INT,
    is_local_event INT,
    ridership_lag_1hr REAL,
    ridership_lag_24hr REAL,
    ridership_lag_168hr REAL,
    temperature REAL,
    precipitation REAL,
    wind_speed REAL,
    snowfall REAL,
    avg_route_volume REAL,
    PRIMARY KEY (transit_timestamp, route)
);
CREATE INDEX idx_historical_data_timestamp ON historical_bus_data (transit_timestamp DESC);


CREATE TABLE route_demand_predictions (
    prediction_id SERIAL PRIMARY KEY,
    prediction_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    route_id VARCHAR(255) NOT NULL,
    predicted_passengers INT NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


CREATE TABLE hourly_dispatch_schedule (
    schedule_id SERIAL PRIMARY KEY,
    route_id VARCHAR(255) NOT NULL,
    trip_id VARCHAR(255) NOT NULL UNIQUE,
    vehicle_id VARCHAR(255) NOT NULL REFERENCES vehicles_realtime(vehicle_id),
    scheduled_departure_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'))
);
CREATE INDEX idx_schedule_departure_time ON hourly_dispatch_schedule (scheduled_departure_time);


\echo 'Final (simplified) scheduler database model created successfully.'
