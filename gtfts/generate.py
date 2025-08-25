import pandas as pd
import os
import json

def get_shape_for_route(route_name: str, gtfs_dir: str = 'gtfs'):
    """
    Finds the geographic shape (a list of coordinates) for a given bus route name.

    This function links data from routes.txt, trips.txt, and shapes.txt to
    extract the ordered points that form the route's path.

    Args:
        route_name (str): The short name of the route (e.g., 'B46-SBS', 'M15').
        gtfs_dir (str): The directory where the GTFS files are located.

    Returns:
        list: A list of [latitude, longitude] coordinates for the route's shape.
              Returns None if the route or its shape cannot be found.
    """
    try:
        # --- 1. Load the GTFS data from CSV files ---
        routes_df = pd.read_csv(os.path.join(gtfs_dir, 'routes.txt'))
        trips_df = pd.read_csv(os.path.join(gtfs_dir, 'trips.txt'))
        shapes_df = pd.read_csv(os.path.join(gtfs_dir, 'shapes.txt'))
    except FileNotFoundError as e:
        print(f"❌ Error: Could not find a required GTFS file. {e}")
        return None

    # --- 2. Find the route_id for the given route_name ---
    # We make a case-insensitive match on the route's short name
    route = routes_df[routes_df['route_short_name'].str.lower() == route_name.lower()]

    if route.empty:
        print(f"❌ Error: Route '{route_name}' not found in routes.txt.")
        return None
    
    # Take the first result if there are multiple matches (e.g., in different boroughs)
    route_id = route.iloc[0]['route_id']

    # --- 3. Find a shape_id for that route_id from the trips file ---
    # A route has many trips. We'll take the first trip's shape as a representative path.
    trip = trips_df[trips_df['route_id'] == route_id]

    if trip.empty:
        print(f"❌ Error: No trips found for route_id '{route_id}' in trips.txt.")
        return None
        
    shape_id = trip.iloc[0]['shape_id']

    # --- 4. Get all points for that shape_id from the shapes file ---
    shape_points = shapes_df[shapes_df['shape_id'] == shape_id]

    if shape_points.empty:
        print(f"❌ Error: No shape data found for shape_id '{shape_id}' in shapes.txt.")
        return None

    # --- 5. Sort the points by their sequence number and create the coordinate list ---
    shape_points = shape_points.sort_values(by='shape_pt_sequence')
    
    # Create a list of [lat, lon] pairs
    coordinates = shape_points[['shape_pt_lat', 'shape_pt_lon']].values.tolist()
    
    return coordinates


# --- Main execution block ---
if __name__ == "__main__":
    # List of registered routes
    REGISTERED_ROUTES = [
        'B1', 'B100', 'B101', 'B103', 'B106', 'B11', 'B111', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17'
    ]

    print(f"🗺️  Generating coordinates for {len(REGISTERED_ROUTES)} registered routes...\n")
    
    # Dictionary to hold all routes' coordinates
    routes_coordinates = {}
    
    for route in REGISTERED_ROUTES:
        print(f"Processing route: {route}")
        coordinates = get_shape_for_route(route)
        if coordinates:
            routes_coordinates[route] = coordinates
            print(f"✅ Added {len(coordinates)} coordinates for '{route}'.")
        else:
            print(f"⚠️ Skipping '{route}' due to missing data.")
        print("---")
    
    # Save to JSON file
    output_file = 'routes_coordinates.json'
    with open(output_file, 'w') as f:
        json.dump(routes_coordinates, f, indent=4)
    
    print(f"\n🎉 Success! Coordinates saved to '{output_file}'.")
    print("You can now import this JSON file in your frontend (e.g., in JavaScript) and use the data for mapping.")
    print("Example usage in JS: fetch('routes_coordinates.json').then(response => response.json()).then(data => console.log(data['B1']));")