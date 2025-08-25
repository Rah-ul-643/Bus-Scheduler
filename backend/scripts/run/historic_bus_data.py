# generate_historical_bus_data.py
# This script generates a realistic 24-hour data snapshot for a specific list of NYC bus routes
# based on the current time, fetching REAL HISTORICAL weather from the NWS API,
# simulating route-specific traffic and ridership, and directly inserts the data
# into the historical_bus_data table in a PostgreSQL database.

import pandas as pd
import numpy as np
import holidays
import requests
from datetime import timedelta
import sys
import psycopg2
from psycopg2 import sql
from io import StringIO

# --- DATABASE CONFIGURATION ---
# Replace with your actual PostgreSQL connection details
DB_CONFIG = {
    "host": "localhost",
    "database": "best_transit",
    "user": "postgres",
    "password": "my_secure_password",
    "port": "5432"
}

# --- Hardcoded routes to generate data for ---
ROUTES = [
    'B1', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17'
]


class HistoricalDataGenerator:
    """
    Generates realistic 24-hour data snapshots for the historical_bus_data table,
    and inserts them directly into a PostgreSQL database.
    """

    def __init__(self):
        """Initializes the data generator and defines the 24-hour time window in UTC."""
        self.end_datetime_utc = pd.Timestamp.now(tz='UTC').floor('h')
        self.start_datetime_utc = self.end_datetime_utc - timedelta(hours=23)
        self.us_holidays = holidays.US(state='NY', years=self.end_datetime_utc.year)
        self.weather_data = None
        self.db_conn = None
        print("Initialized Historical Data Generator.")
        print(f"Generating data for UTC time window: {self.start_datetime_utc} to {self.end_datetime_utc}")

    def _fetch_weather_data_from_nws(self):
        """
        Fetches the last 24 hours of weather data from the NWS API.
        If the API returns incomplete data or null values, it simulates the missing hours
        using time-based linear interpolation.
        """
        print("\n--- Fetching Weather Data from api.weather.gov (NWS) ---")
        station_id = "KNYC"  # Central Park
        API_URL = f"https://api.weather.gov/stations/{station_id}/observations"
        params = {"start": self.start_datetime_utc.isoformat(), "end": self.end_datetime_utc.isoformat(), "limit": 100}
        headers = {"User-Agent": "Bus Scheduler Project (contact@example.com)"}

        try:
            response = requests.get(API_URL, params=params, headers=headers, timeout=15)
            response.raise_for_status()
            data = response.json().get('features', [])
            if not data:
                print("WARNING: No weather observations returned. Bypassing weather data.")
                return False

            weather_records = []
            for obs in data:
                props = obs.get('properties', {})
                temp_c = props.get('temperature', {}).get('value')
                precip_val = props.get('precipitationLastHour', {}).get('value')
                precip_mm = precip_val if precip_val is not None else 0
                wind_val = props.get('windSpeed', {}).get('value')
                wind_kmh = wind_val if wind_val is not None else 0
                snow_val = props.get('snowDepth', {}).get('value')
                snow_cm = (snow_val * 100) if snow_val is not None else 0

                weather_records.append({
                    'datetime': pd.to_datetime(props['timestamp']),
                    'temperature': temp_c, 'precipitation': precip_mm,
                    'wind_speed': wind_kmh, 'snowfall': snow_cm
                })

            df = pd.DataFrame(weather_records).set_index('datetime').sort_index()
            full_hourly_range = pd.date_range(start=self.start_datetime_utc, end=self.end_datetime_utc, freq='h')
            hourly_df = df.resample('h').mean()

            if len(hourly_df) < 24:
                print(f"WARNING: API returned only {len(hourly_df)} of 24 hours. Interpolating missing values...")
                hourly_df = hourly_df.reindex(full_hourly_range)
                hourly_df = hourly_df.interpolate(method='time').ffill().bfill()

            self.weather_data = hourly_df.reset_index().rename(columns={'index': 'datetime'})
            print("Successfully fetched and processed weather data.")
            return True

        except requests.exceptions.RequestException as e:
            print(f"ERROR: Could not fetch weather data: {e}")
            return False
        except Exception as e:
            print(f"ERROR: An error occurred while processing weather data: {e}")
            return False

    def _insert_data_to_db(self, df):
        """
        Connects to the database and bulk-inserts the generated data.
        Uses the fast COPY FROM method for efficiency.
        """
        conn = None
        try:
            print("\n--- Connecting to PostgreSQL database to insert data ---")
            conn = psycopg2.connect(**DB_CONFIG)
            cursor = conn.cursor()
            print("Database connection successful.")

            # Use StringIO buffer for efficient bulk insert
            buffer = StringIO()
            df.to_csv(buffer, index=False, header=False, na_rep='NULL')
            buffer.seek(0)
            
            table_name = 'historical_bus_data'
            columns = df.columns.tolist()

            # The COPY command is much faster for large inserts
            copy_sql = sql.SQL("COPY {} ({}) FROM stdin WITH CSV").format(
                sql.Identifier(table_name),
                sql.SQL(', ').join(map(sql.Identifier, columns))
            )

            print(f"Executing bulk insert into '{table_name}'...")
            cursor.copy_expert(sql=copy_sql, file=buffer)
            conn.commit()
            
            print(f"Successfully inserted {len(df)} rows into the database.")

        except psycopg2.Error as e:
            print(f"ERROR: Database error during insert: {e}")
            if conn:
                conn.rollback()
            sys.exit(1)
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                print("Database connection closed.")

    def generate_and_insert_data(self):
        """
        Main method to orchestrate data generation and insertion.
        """
        if not self._fetch_weather_data_from_nws():
            print("Aborting data generation due to weather data fetching errors.")
            sys.exit(1)

        print("\n--- Generating Historical Bus Data ---")
        all_routes_data = []
        hourly_range = pd.date_range(start=self.start_datetime_utc, end=self.end_datetime_utc, freq='h')

        for route in ROUTES:
            df = pd.DataFrame({'datetime': hourly_range, 'route': route})

            # Feature Engineering
            df['hour_of_day'] = df['datetime'].dt.hour
            df['day_of_week'] = df['datetime'].dt.weekday
            df['day_of_year'] = df['datetime'].dt.dayofyear
            df['month'] = df['datetime'].dt.month
            df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
            df['is_public_holiday'] = df['datetime'].dt.normalize().dt.date.isin(self.us_holidays).astype(int)
            df['is_local_event'] = 0
            df['hour_sin'] = np.sin(2 * np.pi * df['hour_of_day'] / 24)
            df['hour_cos'] = np.cos(2 * np.pi * df['hour_of_day'] / 24)
            df['day_of_week_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
            df['day_of_week_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)

            # Merge Weather and Simulated Traffic Data
            df = pd.merge(df, self.weather_data, on='datetime', how='left')
            speed = np.full(24, 50.0) + np.random.normal(0, 5, 24)
            df['avg_route_volume'] = 2500 - (speed * 30) + np.random.randint(-200, 200, 24)

            # Ridership Simulation
            priority = 3.0
            mean_ridership = priority * 120
            demand_profile = {
                0: 0.1, 1: 0.1, 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.5, 6: 0.8, 7: 1.5, 8: 2.0, 9: 1.5, 10: 1.0, 11: 0.9,
                12: 1.0, 13: 1.0, 14: 1.1, 15: 1.3, 16: 1.8, 17: 2.2, 18: 1.8, 19: 1.4, 20: 1.0, 21: 0.8, 22: 0.6, 23: 0.4
            }
            ridership = np.array([demand_profile.get(h, 1.0) for h in df['hour_of_day']]) * mean_ridership
            ridership += np.random.normal(0, mean_ridership * 0.1, 24)
            ridership[df['is_weekend'] == 1] *= 0.8
            if 'precipitation' in df.columns and not df['precipitation'].isnull().all():
                ridership[df['precipitation'] > 0.5] *= 1.25
            ridership[ridership < 10] = np.random.randint(0, 10, (ridership < 10).sum())
            df['ridership'] = ridership.astype(int)

            # Lag Features
            df['ridership_lag_1hr'] = df['ridership'].shift(1).fillna(df['ridership'].mean())
            df['ridership_lag_24hr'] = df['ridership'].iloc[0]
            df['ridership_lag_168hr'] = df['ridership'].mean()

            all_routes_data.append(df)
            print(f"  - Processed route: {route}")

        final_df = pd.concat(all_routes_data, ignore_index=True)
        final_df.rename(columns={'datetime': 'transit_timestamp'}, inplace=True)
        
        final_column_order = [
            'transit_timestamp', 'route', 'ridership', 'hour_of_day', 'day_of_week', 'day_of_year',
            'month', 'is_weekend', 'hour_sin', 'hour_cos', 'day_of_week_sin',
            'day_of_week_cos', 'is_public_holiday', 'is_local_event', 
            'ridership_lag_1hr', 'ridership_lag_24hr', 'ridership_lag_168hr',
            'temperature', 'precipitation', 'wind_speed', 'snowfall', 'avg_route_volume'
        ]
        final_df = final_df[final_column_order]

        # Insert the final DataFrame into the database
        self._insert_data_to_db(final_df)

        print(f"\n--- Data Generation and Insertion Complete! ---")

if __name__ == '__main__':
    generator = HistoricalDataGenerator()
    generator.generate_and_insert_data()
