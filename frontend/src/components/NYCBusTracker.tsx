"use client"

import { useEffect, useRef, useState, useCallback } from "react"
// Import Leaflet's CSS directly into the component
import 'leaflet/dist/leaflet.css';

// --- Data Structures ---
interface RouteAPIResponse {
  route_id: string;
  route_short_name: string;
  density: number;
  activebuses: number;
}

interface Route extends RouteAPIResponse {
  coordinates: [number, number][];
  isActive: boolean;
}

interface DispatchAPIResponse {
  schedule_id: number;
  vehicle_id: string;
  route_id: string;
  scheduled_departure_time: string;
  predicted_passengers: number | null;
}

interface Dispatch {
  id: string;
  busId: string;
  route: string;
  time: string;
  density: string;
  densityColor: string;
}

type RouteCoordinates = { [key: string]: [number, number][] };

// GTFS Data Interfaces
interface RouteInfo {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_desc: string;
  borough: string;
}

interface TripInfo {
  route_id: string;
  trip_id: string;
  trip_headsign: string;
  direction_id: string;
  shape_id: string;
}

interface ShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

interface RouteDetails {
  route: RouteInfo;
  trips: TripInfo[];
  totalBuses: number;
  stops: ShapePoint[];
}

const API_BASE_URL = "http://localhost:5001/api";

export default function NYCBusTracker() {
  const mapRef = useRef<HTMLDivElement>(null)
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [map, setMap] = useState<L.Map | null>(null)
  const [routes, setRoutes] = useState<Route[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [isLoading, setIsLoading] = useState(true);
  
  // Route details panel state
  const [selectedRouteDetails, setSelectedRouteDetails] = useState<RouteDetails | null>(null);
  const [routeDetailsPanelOpen, setRouteDetailsPanelOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [gtfsRoutes, setGtfsRoutes] = useState<RouteInfo[]>([]);
  const [gtfsTrips, setGtfsTrips] = useState<TripInfo[]>([]);
  const [gtfsShapes, setGtfsShapes] = useState<ShapePoint[]>([]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [routesRes, dispatchesRes, localGeometryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/routes`),
        fetch(`${API_BASE_URL}/dispatches`),
        fetch(`/routes_coordinates.json`), // Fetch local route coordinates
      ]);

      if (!routesRes.ok || !dispatchesRes.ok || !localGeometryRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const routesData: RouteAPIResponse[] = await routesRes.json();
      const dispatchesData: DispatchAPIResponse[] = await dispatchesRes.json();
      const localGeometryData: RouteCoordinates = await localGeometryRes.json();
      
      const updatedRoutes: Route[] = routesData.map(route => ({
        ...route,
        coordinates: localGeometryData[route.route_short_name] || [],
        isActive: route.activebuses > 0,
      }));
      setRoutes(updatedRoutes);

      const formattedDispatches: Dispatch[] = dispatchesData.map((d) => {
        const densityVal = d.predicted_passengers || 0;
        const density = densityVal > 150 ? "High" : densityVal > 50 ? "Medium" : "Low";
        return {
          id: `dispatch-${d.schedule_id}`,
          busId: d.vehicle_id,
          route: d.route_id,
          time: new Date(d.scheduled_departure_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          density: density,
          densityColor: density === "High" ? "#DC3545" : density === "Medium" ? "#FFC107" : "#28A745",
        }
      }).sort((a, b) => b.time.localeCompare(a.time));
      setDispatches(formattedDispatches);

    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to parse CSV data
  const parseCSV = (csvText: string): Record<string, string>[] => {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');
    
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header.trim()] = values[index]?.trim() || '';
      });
      return obj;
    });
  };

  // Load GTFS data
  const loadGTFSData = async () => {
    try {
      const [routesText, tripsText, shapesText] = await Promise.all([
        fetch('/gtfs/routes.txt').then(res => res.text()),
        fetch('/gtfs/trips.txt').then(res => res.text()),
        fetch('/gtfs/shapes.txt').then(res => res.text())
      ]);

      const routesData = parseCSV(routesText) as RouteInfo[];
      const tripsData = parseCSV(tripsText) as TripInfo[];
      const shapesData = parseCSV(shapesText).map((shape: Record<string, string>) => ({
        ...shape,
        shape_pt_lat: parseFloat(shape.shape_pt_lat),
        shape_pt_lon: parseFloat(shape.shape_pt_lon),
        shape_pt_sequence: parseInt(shape.shape_pt_sequence)
      })) as ShapePoint[];

      setGtfsRoutes(routesData);
      setGtfsTrips(tripsData);
      setGtfsShapes(shapesData);
    } catch (error) {
      console.error('Error loading GTFS data:', error);
    }
  };

  // Function to get route details
  const getRouteDetails = useCallback((routeShortName: string): RouteDetails | null => {
    const route = gtfsRoutes.find(r => r.route_short_name === routeShortName);
    if (!route) return null;

    const routeTrips = gtfsTrips.filter(t => t.route_id === route.route_id);
    const uniqueShapeIds = [...new Set(routeTrips.map(t => t.shape_id))];
    
    // Get stops from shapes (shape points represent the route path)
    const stops = gtfsShapes.filter(s => uniqueShapeIds.includes(s.shape_id))
      .sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);

    // Get total buses from current routes data
    const currentRoute = routes.find(r => r.route_short_name === routeShortName);
    const totalBuses = currentRoute?.activebuses || 0;

    return {
      route,
      trips: routeTrips,
      totalBuses,
      stops
    };
  }, [gtfsRoutes, gtfsTrips, gtfsShapes, routes]);

  useEffect(() => {
    setIsClient(true);
    fetchData();
    loadGTFSData(); // Load GTFS data for route details
  }, []);

  useEffect(() => {
    if (isClient) {
      const timeInterval = setInterval(() => setCurrentTime(new Date()), 1000);
      const dataInterval = setInterval(fetchData, 60 * 1000);

      return () => {
        clearInterval(timeInterval);
        clearInterval(dataInterval);
      };
    }
  }, [isClient]);

// --- CORRECTED MAP HOOKS ---

  // Hook 1: Initialize the map instance ONCE.
  // This hook now has an empty dependency array `[]` to ensure it runs only after the initial render.
  useEffect(() => {
    // We only want to run this on the client side where `window` and `document` are available.
    if (typeof window !== "undefined" && mapRef.current && !map) {
      import('leaflet').then(L => {
        // Fix for default icon paths in bundlers like Webpack/Next.js
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: '/leaflet/marker-icon-2x.png',
          iconUrl: '/leaflet/marker-icon.png',
          shadowUrl: '/leaflet/marker-shadow.png',
        });

        // Create the map instance BUT DO NOT ADD A TILE LAYER HERE.
        const mapInstance = L.map(mapRef.current!).setView([40.7128, -74.006], 11);
        setMap(mapInstance);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // <-- CRITICAL CHANGE: Empty dependency array ensures this runs only ONCE.


  // Hook 2: Manage the tile layer (theme).
  // This hook runs after the map is created and EVERY time darkMode changes.
  useEffect(() => {
    // Only run if the map instance exists.
    if (map) {
      import('leaflet').then(L => {
        // First, remove any existing tile layers to prevent stacking them.
        map.eachLayer((layer) => {
          // Use `instanceof` for a reliable check, instead of the private `_url` property.
          if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
          }
        });

        // Define the new tile layer based on the current darkMode state.
        const newTileUrl = darkMode
          ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
        
        const newTileAttribution = darkMode
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

        const tileLayer = L.tileLayer(newTileUrl, {
          attribution: newTileAttribution,
          maxZoom: 19,
          subdomains: darkMode ? 'abcd' : 'abc'
        });

        // Add the new tile layer to the map.
        tileLayer.addTo(map);
      });
    }
  }, [darkMode, map]); // <-- This correctly depends on `darkMode` and `map`.

  useEffect(() => {
    // This effect handles drawing the routes on the map.
    if (map) {
      import('leaflet').then(L => {
        map.eachLayer((layer) => {
          if (layer instanceof L.Polyline || layer instanceof L.Marker) {
            map.removeLayer(layer);
          }
        });

        routes.forEach((route) => {
          if (!route.coordinates || route.coordinates.length < 2) return;

          // Check if this route is selected
          const isSelected = selectedRouteId === route.route_short_name;

          // Color logic: Selected route gets a special color, otherwise use density-based colors
          let color;
          if (isSelected) {
            color = "#8B5CF6"; // Purple color for selected route
          } else {
            // Original density-based color logic
            if (route.density > 150) {
              color = "#EF4444"; // Red for high density
            } else if (route.density > 50) {
              color = "#F59E0B"; // Yellow for medium density
            } else {
              color = "#28A745"; // Green for low density (including 0)
            }
          }

          // Different line styles for active vs inactive routes, with emphasis on selected
          const dashArray = route.isActive ? "10, 10" : undefined;
          const weight = isSelected ? 6 : 4; // Make selected route thicker
          const opacity = isSelected ? 1.0 : 0.8; // Make selected route more opaque

          const polyline = L.polyline(route.coordinates, {
            color: color, 
            weight: weight, 
            opacity: opacity, 
            dashArray: dashArray,
            className: isSelected ? "bus-route selected" : "bus-route"
          }).addTo(map);

          // Enhanced tooltip with more information
          polyline.bindTooltip(
            `<strong>${route.route_short_name}</strong><br/>
             Predicted density: ${route.density > 150 ? "High" : route.density > 50 ? "Medium" : "Low"}<br/>
             ${route.activebuses} buses dispatched`,
            { 
              permanent: false, 
              direction: "top"
            }
          );

          // Add click handler to show route details and highlight route
          polyline.on('click', () => {
            const routeDetails = getRouteDetails(route.route_short_name);
            if (routeDetails) {
              setSelectedRouteDetails(routeDetails);
              setSelectedRouteId(route.route_short_name); // Set selected route for highlighting
              setRouteDetailsPanelOpen(true);
            }
          });

          // Add start and end markers for the route
          if (route.coordinates.length >= 2) {
            const startCoord = route.coordinates[0];
            const endCoord = route.coordinates[route.coordinates.length - 1];

            // Start marker (green circle with route name)
            const startIcon = L.divIcon({
              html: `<div style="
                background-color: #22c55e; 
                color: white; 
                border-radius: 12px; 
                padding: 2px 6px;
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-weight: bold; 
                font-size: 10px;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                white-space: nowrap;
                min-width: 24px;
              ">${route.route_short_name}</div>`,
              iconSize: [30, 20],
              className: "route-start-marker",
            });

            // End marker (red circle with route name)
            const endIcon = L.divIcon({
              html: `<div style="
                background-color: #ef4444; 
                color: white; 
                border-radius: 12px; 
                padding: 2px 6px;
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-weight: bold; 
                font-size: 10px;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                white-space: nowrap;
                min-width: 24px;
              ">${route.route_short_name}</div>`,
              iconSize: [30, 20],
              className: "route-end-marker",
            });

            L.marker(startCoord, { icon: startIcon })
              .bindTooltip(`Start: Route ${route.route_short_name}`, { direction: "top" })
              .addTo(map);

            L.marker(endCoord, { icon: endIcon })
              .bindTooltip(`End: Route ${route.route_short_name}`, { direction: "top" })
              .addTo(map);
          }

          // Add intermediate stop markers (every 10th coordinate to avoid cluttering)
          if (route.coordinates.length > 20) {
            const stepSize = Math.max(10, Math.floor(route.coordinates.length / 15)); // Max 15 stops
            for (let i = stepSize; i < route.coordinates.length - stepSize; i += stepSize) {
              const stopCoord = route.coordinates[i];
              
              const stopIcon = L.divIcon({
                html: `<div style="
                  background-color: ${color}; 
                  border-radius: 50%; 
                  width: 8px; 
                  height: 8px; 
                  border: 2px solid white;
                  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
                "></div>`,
                iconSize: [8, 8],
                className: "route-stop-marker",
              });

              L.marker(stopCoord, { icon: stopIcon })
                .bindTooltip(`Route ${route.route_short_name} - Stop ${Math.floor(i / stepSize)}`, { 
                  direction: "top",
                  offset: [0, -5]
                })
                .addTo(map);
            }
          }

          // Add bus markers for active routes
          if (route.isActive) {
            for (let i = 0; i < route.activebuses; i++) {
              const coordIndex = Math.floor((i / route.activebuses) * route.coordinates.length);
              const coord = route.coordinates[coordIndex] || route.coordinates[0];

              const busIcon = L.divIcon({
                html: `<div style="
                  font-size: 16px;
                  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                ">🚌</div>`,
                iconSize: [20, 20],
                className: "bus-marker",
              });

              L.marker(coord, { icon: busIcon })
                .bindTooltip(`Bus on Route ${route.route_short_name}`, { direction: "top" })
                .addTo(map);
            }
          }
        });
      });
    }
  }, [map, routes, darkMode, getRouteDetails, selectedRouteId]);

  const getDensityBadgeClass = (density: string) => {
    if (density === "High") return "bg-red-500";
    if (density === "Medium") return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <>
      <div className={`h-screen flex flex-col transition-colors duration-300 ${darkMode ? "bg-gray-900" : "bg-gray-50"}`}>
        {/* Header */}
        <header className={`shadow-sm border-b px-6 py-4 transition-colors duration-300 ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-2xl font-bold transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}>NYC Bus Traffic Predictor</h1>
              <p className={`text-sm transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Real-time route density and dispatches</p>
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-md transition-colors duration-300 ${darkMode ? "bg-gray-700 text-yellow-400 hover:bg-gray-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden bg-blue-500 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-600 transition-colors duration-300">
                {sidebarOpen ? "Hide" : "Show"} Schedule
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <aside className={`${sidebarOpen ? "w-80" : "w-0"} lg:w-80 border-r shadow-sm transition-all duration-300 overflow-hidden ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
            <div className={`p-4 border-b transition-colors duration-300 ${darkMode ? "border-gray-700" : ""}`}>
              <h2 className={`text-lg font-semibold transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}>Current Hour Dispatch Schedule</h2>
            </div>
            <div className="overflow-y-auto h-full pb-20">
              <div className="p-4 space-y-3">
                {isLoading ? (
                  <div className="text-center text-gray-500">Loading...</div>
                ) : (
                  dispatches.map((dispatch) => (
                    <div key={dispatch.id} className={`rounded-lg p-3 border transition-colors duration-300 ${darkMode ? "bg-gray-700 border-gray-600" : "bg-gray-50 border-gray-200"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-medium text-sm transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}>Bus {dispatch.busId}</span>
                        <span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{dispatch.time}</span>
                      </div>
                      <div className={`text-sm mb-2 transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Route: <span className="font-medium">{dispatch.route}</span></div>
                      <div className="flex items-center">
                        <span className={`inline-block w-3 h-3 rounded-full mr-2 ${getDensityBadgeClass(dispatch.density)}`}></span>
                        <span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>{dispatch.density} density</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          {/* Map */}
          <main className="flex-1 relative">
            <div ref={mapRef} className="w-full h-full" />
            <div className={`absolute top-4 right-4 rounded-lg shadow-md p-3 transition-colors duration-300 ${darkMode ? "bg-gray-800 border border-gray-700" : "bg-white"}`}>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className={`text-sm transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Live Updates</span>
              </div>
            </div>
            <div className={`absolute bottom-4 right-4 rounded-lg shadow-md p-4 transition-colors duration-300 ${darkMode ? "bg-gray-800 border border-gray-700" : "bg-white"}`}>
              <h3 className={`text-sm font-semibold mb-3 transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}>Map Legend</h3>
              
              {/* Route Density */}
              <div className="mb-4">
                <h4 className={`text-xs font-medium mb-2 transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Route Density</h4>
                <div className="space-y-1">
                  <div className="flex items-center"><div className="w-4 h-1 bg-green-500 mr-2"></div><span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Low (&lt;50)</span></div>
                  <div className="flex items-center"><div className="w-4 h-1 bg-yellow-500 mr-2"></div><span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Medium (50-150)</span></div>
                  <div className="flex items-center"><div className="w-4 h-1 bg-red-500 mr-2"></div><span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>High (&gt;150)</span></div>
                  <div className="flex items-center"><div className="w-4 h-1 bg-blue-500 mr-2" style={{borderStyle: "dashed", borderWidth: "1px 0"}}></div><span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Active Route</span></div>
                </div>
              </div>

              {/* Route Markers */}
              <div className="mb-4">
                <h4 className={`text-xs font-medium mb-2 transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Route Markers</h4>
                <div className="space-y-1">
                  <div className="flex items-center">
                    <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded mr-2">
                      B11
                    </div>
                    <span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Start Point</span>
                  </div>
                  <div className="flex items-center">
                    <div className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded mr-2">
                      B11
                    </div>
                    <span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>End Point</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-gray-500 rounded-full mr-3 border border-white"></div>
                    <span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Route Stops</span>
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2 text-sm">🚌</span>
                    <span className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Active Buses</span>
                  </div>
                </div>
              </div>

              {/* Click Info */}
              <div className={`text-xs p-2 rounded ${darkMode ? "bg-gray-700 text-gray-300" : "bg-gray-50 text-gray-600"}`}>
                💡 Click on any route line to view detailed information
              </div>
            </div>
          </main>

          {/* Route Details Panel */}
          {routeDetailsPanelOpen && selectedRouteDetails && (
            <div className={`w-80 border-l transition-all duration-300 ${darkMode ? "bg-gray-800 border-gray-600" : "bg-white border-gray-300"}`}>
              {/* Simple Header */}
              <div className={`p-4 border-b ${darkMode ? "border-gray-600" : "border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-800"}`}>
                    Route {selectedRouteDetails.route.route_short_name}
                  </h2>
                  <button
                    onClick={() => {
                      setRouteDetailsPanelOpen(false);
                      setSelectedRouteId(null);
                    }}
                    className={`p-1 rounded ${darkMode ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto h-full">
                {/* Simple stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-3 rounded ${darkMode ? "bg-gray-700" : "bg-gray-100"}`}>
                    <div className={`text-sm font-medium ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Active Buses</div>
                    <div className={`text-xl font-bold ${darkMode ? "text-white" : "text-gray-800"}`}>
                      {selectedRouteDetails.totalBuses}
                    </div>
                  </div>
                  <div className={`p-3 rounded ${darkMode ? "bg-gray-700" : "bg-gray-100"}`}>
                    <div className={`text-sm font-medium ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Route Points</div>
                    <div className={`text-xl font-bold ${darkMode ? "text-white" : "text-gray-800"}`}>
                      {selectedRouteDetails.stops.length}
                    </div>
                  </div>
                </div>

                {/* Route Information */}
                <div>
                  <h3 className={`text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Route Information</h3>
                  <div className="space-y-2">
                    <div>
                      <div className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Name</div>
                      <div className={`text-sm ${darkMode ? "text-white" : "text-gray-800"}`}>{selectedRouteDetails.route.route_long_name}</div>
                    </div>
                    <div>
                      <div className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Description</div>
                      <div className={`text-sm ${darkMode ? "text-white" : "text-gray-800"}`}>{selectedRouteDetails.route.route_desc}</div>
                    </div>
                    <div>
                      <div className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Borough</div>
                      <div className={`text-sm ${darkMode ? "text-white" : "text-gray-800"}`}>{selectedRouteDetails.route.borough}</div>
                    </div>
                  </div>
                </div>

                {/* Trip Directions */}
                <div>
                  <h3 className={`text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                    Trip Directions ({selectedRouteDetails.trips.length} trips)
                  </h3>
                  <div className="space-y-1">
                    {[...new Set(selectedRouteDetails.trips.map(t => t.trip_headsign))].slice(0, 5).map((headsign, index) => (
                      <div key={index} className={`text-sm p-2 rounded ${darkMode ? "bg-gray-700 text-gray-200" : "bg-gray-100 text-gray-700"}`}>
                        {headsign}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Route Points */}
                <div>
                  <h3 className={`text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                    Route Points ({selectedRouteDetails.stops.length} points)
                  </h3>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {selectedRouteDetails.stops.slice(0, 20).map((stop, index) => (
                      <div key={index} className={`flex items-center space-x-2 p-2 rounded text-sm ${darkMode ? "bg-gray-700" : "bg-gray-100"}`}>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          index === 0 ? "bg-green-500 text-white" :
                          index === selectedRouteDetails.stops.slice(0, 20).length - 1 ? "bg-red-500 text-white" :
                          darkMode ? "bg-gray-600 text-gray-200" : "bg-gray-300 text-gray-700"
                        }`}>
                          {index === 0 ? "Start" : index === selectedRouteDetails.stops.slice(0, 20).length - 1 ? "End" : index + 1}
                        </span>
                        <div className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                          {stop.shape_pt_lat.toFixed(4)}, {stop.shape_pt_lon.toFixed(4)}
                        </div>
                      </div>
                    ))}
                    {selectedRouteDetails.stops.length > 20 && (
                      <div className={`text-center p-2 text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                        ... and {selectedRouteDetails.stops.length - 20} more points
                      </div>
                    )}
                  </div>
                </div>

                {/* Center Route Button */}
                <button
                  onClick={() => {
                    // Center map on route
                    if (map && selectedRouteDetails) {
                      const route = routes.find(r => r.route_short_name === selectedRouteDetails.route.route_short_name);
                      if (route && route.coordinates.length > 0) {
                        import('leaflet').then(L => {
                          const group = new L.FeatureGroup();
                          route.coordinates.forEach(coord => {
                            L.marker(coord).addTo(group);
                          });
                          map.fitBounds(group.getBounds().pad(0.1));
                        });
                      }
                    }
                  }}
                  className={`w-full py-2 px-4 rounded text-sm font-medium ${
                    darkMode 
                      ? "bg-blue-600 hover:bg-blue-700 text-white" 
                      : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                >
                  Center Route on Map
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className={`border-t px-6 py-3 transition-colors duration-300 ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
          <div className={`flex items-center justify-between text-sm transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
            <span>Powered by AI Predictions</span>
            <span>{isClient ? currentTime.toLocaleTimeString() : "--:--:--"}</span>
          </div>
        </footer>
      </div>

      <style jsx>{`
        .bus-marker {
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .leaflet-tooltip {
          background: ${darkMode ? "#374151" : "white"} !important;
          color: ${darkMode ? "white" : "black"} !important;
          border: 1px solid ${darkMode ? "#6B7280" : "#ccc"} !important;
          border-radius: 4px !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
        }
        
        /* Custom scrollbar styling for both light and dark modes */
        .overflow-y-auto {
          scrollbar-width: thin;
          scrollbar-color: ${darkMode ? "#4B5563 #374151" : "#CBD5E0 #F7FAFC"};
        }
        
        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }
        
        .overflow-y-auto::-webkit-scrollbar-track {
          background: ${darkMode ? "#374151" : "#F7FAFC"};
          border-radius: 3px;
        }
        
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: ${darkMode ? "#6B7280" : "#CBD5E0"};
          border-radius: 3px;
          transition: background 0.3s ease;
        }
        
        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: ${darkMode ? "#9CA3AF" : "#A0ADB8"};
        }
        
        /* Hide scrollbar on mobile for cleaner look */
        @media (max-width: 768px) {
          .overflow-y-auto::-webkit-scrollbar {
            display: none;
          }
          .overflow-y-auto {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        }
        
        .leaflet-container {
          font-family: system-ui, -apple-system, sans-serif !important;
        }
      `}</style>
    </>
  )
}