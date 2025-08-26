# generate_historical_bus_data.py
# This script generates a realistic 24-hour data snapshot for a specific list of NYC bus routes.
# It fetches real historical weather, simulates ridership, and inserts the data into a PostgreSQL database,
# clearing the table before each run.

# Ensure you have the required libraries installed:
# pip install pandas numpy holidays requests psycopg2-binary

import sys
import os
from datetime import timedelta
from io import StringIO
import holidays
import numpy as np
import pandas as pd
import psycopg2
import requests
from psycopg2 import sql

import time
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# --- DATABASE CONFIGURATION ---

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "best_transit"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "my_secure_password"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432")
}

# --- SCRIPT CONFIGURATION ---
# Hardcoded routes to generate data for
ROUTES = [
    'B1', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17'
]
# NWS station for weather data (KNYC = Central Park, NY)
WEATHER_STATION = "KNYC"


class HistoricalDataGenerator:
    """
    Generates a 24-hour historical data snapshot and upserts it into a PostgreSQL database.
    """

    def __init__(self):
        """Initializes the data generator and defines the 24-hour time window in UTC."""
        self.end_datetime_utc = pd.Timestamp.now(tz='UTC').floor('h')
        self.start_datetime_utc = self.end_datetime_utc - timedelta(hours=23)
        self.us_holidays = holidays.US(state='NY', years=self.end_datetime_utc.year)
        self.weather_data = None
        print("Initialized Historical Data Generator.")
        print(f"Generating data for UTC time window: {self.start_datetime_utc} to {self.end_datetime_utc}")


    def _fetch_weather_data(self):
        """
        Fetches the last 24 hours of weather data from the NWS API.
        Interpolates any missing hourly data and provides detailed logs on data quality.
        """
        print(f"\n--- Fetching Weather Data from NWS Station: {WEATHER_STATION} ---")
        api_url = f"https://api.weather.gov/stations/{WEATHER_STATION}/observations"
        params = {
            "start": self.start_datetime_utc.isoformat(),
            "end": self.end_datetime_utc.isoformat(),
            "limit": 100
        }
        headers = {"User-Agent": "Bus Scheduler Project (contact@example.com)"}

        # Configure retry strategy for transient failures
        session = requests.Session()
        retries = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
        session.mount('https://', HTTPAdapter(max_retries=retries))

        try:
            response = session.get(api_url, params=params, headers=headers, timeout=15)
            response.raise_for_status()
            data = response.json().get('features', [])
            if not data:
                print("❌ WARNING: No weather observations returned from API. Aborting.")
                return False

            records = []
            for obs in data:
                props = obs.get('properties', {})
                timestamp = props.get('timestamp')
                if not timestamp:
                    continue  # Skip malformed observations

                # Extract weather data with defaults
                temp_c = props.get('temperature', {}).get('value', None)
                precip_mm = props.get('precipitationLastHour', {}).get('value', 0)
                wind_ms = props.get('windSpeed', {}).get('value', 0)
                wind_kmh = wind_ms * 3.6 if wind_ms is not None else 0  # Convert m/s to km/h

                # Snowfall data is often unavailable; use 0 as fallback
                # Note: snowDepth is cumulative, not hourly snowfall
                snow_depth_m = props.get('snowDepth', {}).get('value', 0)
                snow_cm = snow_depth_m * 100 if snow_depth_m is not None else 0

                records.append({
                    'datetime': pd.to_datetime(timestamp),
                    'temperature': temp_c,
                    'precipitation': precip_mm,
                    'wind_speed': wind_kmh,
                    'snowfall': snow_cm
                })

            if not records:
                print("❌ ERROR: No valid weather records parsed from API response. Aborting.")
                return False

            df = pd.DataFrame(records).set_index('datetime').sort_index()
            # Resample to hourly mean
            hourly_df_raw = df.resample('h').mean()

            # Reindex to full 24-hour range
            full_hourly_range = pd.date_range(start=self.start_datetime_utc, end=self.end_datetime_utc, freq='h')
            hourly_df = hourly_df_raw.reindex(full_hourly_range)

            # Log data quality
            actual_observations = hourly_df_raw.notna().sum()
            print(f"✅ Fetched {len(hourly_df_raw)} observations with:")
            print(f"   - Temperature: {actual_observations.get('temperature', 0)} valid points")
            print(f"   - Precipitation: {actual_observations.get('precipitation', 0)} valid points")
            print(f"   - Wind Speed: {actual_observations.get('wind_speed', 0)} valid points")
            print(f"   - Snowfall (proxy): {actual_observations.get('snowfall', 0)} valid points")

            if len(hourly_df_raw) < 24:
                print(f"⚠️  Incomplete data: {len(hourly_df_raw)}/24 hourly observations. Interpolating...")
                hourly_df = hourly_df.infer_objects(copy=False).interpolate(method='time').ffill().bfill()
            else:
                print("✅ Complete 24-hour dataset fetched.")

            # Ensure no NaN values remain
            if hourly_df.isna().any().any():
                print("⚠️  Warning: Some NaN values remain after interpolation. Filling with defaults...")
                hourly_df = hourly_df.fillna({
                    'temperature': 20.0,  # Reasonable default for NYC
                    'precipitation': 0,
                    'wind_speed': 0,
                    'snowfall': 0
                })

            self.weather_data = hourly_df.reset_index().rename(columns={'index': 'datetime'})
            print("✅ Weather data processed successfully.")
            return True

        except requests.exceptions.RequestException as e:
            print(f"❌ ERROR: Failed to fetch weather data: {e}")
            return False
        except Exception as e:
            print(f"❌ ERROR: Unexpected error while processing weather data: {e}")
            return False

    def _clear_and_insert_data(self, df):
        """
        Connects to the database, clears the target table, and bulk-inserts the generated data.
        Uses the efficient TRUNCATE and COPY FROM methods.
        """
        table_name = 'historical_bus_data'
        conn = None
        try:
            print(f"\n--- Connecting to PostgreSQL to load data into '{table_name}' ---")
            conn = psycopg2.connect(**DB_CONFIG)
            with conn.cursor() as cursor:
                print(f"Clearing existing data from '{table_name}'...")
                truncate_sql = sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY").format(sql.Identifier(table_name))
                cursor.execute(truncate_sql)
                print("Table cleared successfully.")

                buffer = StringIO()
                df.to_csv(buffer, index=False, header=False)
                buffer.seek(0)

                columns = df.columns.tolist()
                copy_sql = sql.SQL("COPY {} ({}) FROM stdin WITH CSV").format(
                    sql.Identifier(table_name),
                    sql.SQL(', ').join(map(sql.Identifier, columns))
                )
                print(f"Executing bulk insert of {len(df)} rows...")
                cursor.copy_expert(sql=copy_sql, file=buffer)

            conn.commit()
            print("Data insertion successful.")

        except psycopg2.Error as e:
            print(f"❌ ERROR: Database operation failed: {e}")
            if conn:
                conn.rollback()
            sys.exit(1)
        finally:
            if conn:
                conn.close()
                print("Database connection closed.")

    def run(self):
        """
        Main method to orchestrate data generation and database insertion.
        """
        if not self._fetch_weather_data():
            sys.exit(1)

        print("\n--- Generating Historical Bus Data ---")
        all_routes_data = []
        hourly_range = pd.date_range(start=self.start_datetime_utc, end=self.end_datetime_utc, freq='h')

        for route in ROUTES:
            df = pd.DataFrame({'datetime': hourly_range, 'route': route})

            # --- Feature Engineering ---
            df['hour_of_day'] = df['datetime'].dt.hour
            df['day_of_week'] = df['datetime'].dt.weekday
            df['month'] = df['datetime'].dt.month
            df['day_of_year'] = df['datetime'].dt.dayofyear
            df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
            df['is_public_holiday'] = df['datetime'].dt.date.isin(self.us_holidays).astype(int)
            df['is_local_event'] = 0

            # Cyclical time features
            df['hour_sin'] = np.sin(2 * np.pi * df['hour_of_day'] / 24)
            df['hour_cos'] = np.cos(2 * np.pi * df['hour_of_day'] / 24)
            df['day_of_week_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
            df['day_of_week_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)

            # --- Data Merging ---
            df = pd.merge(df, self.weather_data, on='datetime', how='left')
            df['avg_route_volume'] = 0

            # --- Ridership Simulation ---
            demand_profile = [0.1, 0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 1.5, 2.0, 1.5, 1.0, 0.9,
                              1.0, 1.0, 1.1, 1.3, 1.8, 2.2, 1.8, 1.4, 1.0, 0.8, 0.6, 0.4]
            base_ridership = 360
            ridership = np.array(demand_profile) * base_ridership
            ridership += np.random.normal(0, base_ridership * 0.1, 24)
            ridership[df['is_weekend'] == 1] *= 0.8
            ridership[df['precipitation'] > 0.5] *= 1.25
            ridership[ridership < 10] = np.random.randint(0, 10, size=(ridership < 10).sum())
            df['ridership'] = ridership.astype(int)

            # --- Lag Feature Simulation ---
            df['ridership_lag_1hr'] = df['ridership'].shift(1).fillna(df['ridership'].mean())
            df['ridership_lag_24hr'] = df['ridership'].iloc[0]
            df['ridership_lag_168hr'] = df['ridership'].mean()

            all_routes_data.append(df)
            print(f"  - Processed route: {route}")

        final_df = pd.concat(all_routes_data, ignore_index=True)
        final_df.rename(columns={'datetime': 'transit_timestamp'}, inplace=True)
        
        final_column_order = [
            'transit_timestamp', 'route', 'ridership', 'hour_of_day', 'day_of_week',
            'day_of_year', 'month', 'is_weekend', 'hour_sin', 'hour_cos',
            'day_of_week_sin', 'day_of_week_cos', 'is_public_holiday', 'is_local_event',
            'ridership_lag_1hr', 'ridership_lag_24hr', 'ridership_lag_168hr',
            'temperature', 'precipitation', 'wind_speed', 'snowfall', 'avg_route_volume'
        ]
        final_df = final_df[final_column_order]

        self._clear_and_insert_data(final_df)
        print("\n--- Data Generation and Insertion Complete! ---")


if __name__ == '__main__':
    generator = HistoricalDataGenerator()
    generator.run()