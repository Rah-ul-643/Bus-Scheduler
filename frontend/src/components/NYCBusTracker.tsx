"use client"

import { useEffect, useRef, useState } from "react"
import * as L from 'leaflet'

// --- Data Structures ---
// Defines the shape of the raw route data received from the API.
interface RouteAPIResponse {
  route_id: string;
  route_short_name: string;
  density: number;
  activebuses: number;
}

// Extends the API response with frontend-specific properties.
interface Route extends RouteAPIResponse {
  coordinates: [number, number][];
  isActive: boolean;
}

// Defines the shape of the raw dispatch data from the API.
interface DispatchAPIResponse {
  schedule_id: number;
  vehicle_id: string;
  route_id: string;
  scheduled_departure_time: string;
  predicted_passengers: number | null;
}

// Defines the shape of the formatted dispatch data for UI display.
interface Dispatch {
  id: string;
  busId: string;
  route: string;
  time: string;
  density: string;
  densityColor: string;
}

// Defines the structure for the fetched route geometry data.
type RouteCoordinates = { [key: string]: [number, number][] };

// Makes the Leaflet library available on the global window object.
declare global {
  interface Window { L: typeof L }
}

// --- Constants ---
const API_BASE_URL = "http://localhost:5001/api";

export default function NYCBusTracker() {
  // --- State Management ---
  const mapRef = useRef<HTMLDivElement>(null) // Ref to the map container div.
  const [dispatches, setDispatches] = useState<Dispatch[]>([]) // Holds the formatted dispatch schedule for the sidebar.
  const [currentTime, setCurrentTime] = useState(new Date()) // Holds the current time for the footer clock.
  const [sidebarOpen, setSidebarOpen] = useState(true) // Controls the visibility of the sidebar on mobile.
  const [map, setMap] = useState<L.Map | null>(null) // Holds the Leaflet map instance.
  const [routes, setRoutes] = useState<Route[]>([]) // Holds the combined route data (API + geometry) for map display.
  const [darkMode, setDarkMode] = useState(false) // Toggles between light and dark themes.
  const [isClient, setIsClient] = useState(false) // Prevents server-side rendering issues.
  const [isLoading, setIsLoading] = useState(true); // Manages the loading state for the UI.

  // --- Data Fetching ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch all necessary data from the backend in parallel.
      const [routesRes, dispatchesRes, geometryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/routes`),
        fetch(`${API_BASE_URL}/dispatches`),
        fetch(`${API_BASE_URL}/route-geometry`),
      ]);

      if (!routesRes.ok || !dispatchesRes.ok || !geometryRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const routesData: RouteAPIResponse[] = await routesRes.json();
      const dispatchesData: DispatchAPIResponse[] = await dispatchesRes.json();
      const geometryData: RouteCoordinates = await geometryRes.json();
      
      // Combine dynamic route data with static geometry to create the full Route object.
      const updatedRoutes: Route[] = routesData.map(route => ({
        ...route,
        coordinates: geometryData[route.route_short_name] || [],
        isActive: route.activebuses > 0,
      }));
      setRoutes(updatedRoutes);

      // Format the raw dispatch data into a more display-friendly format.
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
      });
      setDispatches(formattedDispatches);

    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Effects ---
  // Effect to run once on component mount to confirm we are on the client-side.
  useEffect(() => {
    setIsClient(true);
    fetchData();
  }, []);

  // Effect to set up intervals for the clock and data polling.
  useEffect(() => {
    if (isClient) {
      const timeInterval = setInterval(() => setCurrentTime(new Date()), 1000);
      // Fetches new data every minute to check for the new hourly schedule.
      const dataInterval = setInterval(fetchData, 60 * 1000);

      return () => {
        clearInterval(timeInterval);
        clearInterval(dataInterval);
      };
    }
  }, [isClient]);

  // Effect to initialize the Leaflet map instance once.
  useEffect(() => {
    if (isClient && mapRef.current && !map) {
      const L = window.L;
      const mapInstance = L.map(mapRef.current!).setView([40.7128, -74.006], 11);
      setMap(mapInstance);
    }
  }, [isClient, map]);

  // Effect to switch the map's tile layer when dark mode changes.
  useEffect(() => {
    if (map) {
      const L = window.L;
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) map.removeLayer(layer);
      });
      const tileUrl = darkMode
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      L.tileLayer(tileUrl, { attribution: "© OpenStreetMap contributors" }).addTo(map);
    }
  }, [darkMode, map]);

  // Effect to redraw all route lines on the map whenever the routes data changes.
  useEffect(() => {
    if (map) {
      const L = window.L;
      // Clear all previous route layers before drawing new ones.
      map.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.Marker) {
          map.removeLayer(layer);
        }
      });

      routes.forEach((route) => {
        if (!route.coordinates || route.coordinates.length < 2) return;

        const color = route.density > 150 ? "#DC3545" : route.density > 50 ? "#FFC107" : "#28A745";
        const dashArray = route.isActive ? undefined : "10, 10"; // Dashed line for inactive routes.

        const polyline = L.polyline(route.coordinates, {
          color: color, weight: 4, opacity: 0.8, dashArray: dashArray
        }).addTo(map);

        // Add a tooltip to each route line.
        polyline.bindTooltip(
          `<strong>${route.route_short_name}</strong><br/>
           Predicted density: ${route.density}<br/>
           ${route.activebuses} buses active`,
          { permanent: false, direction: "top" }
        );
      });
    }
  }, [map, routes]);

  // --- Helper Functions ---
  // Determines the Tailwind CSS class for the density badge based on the density string.
  const getDensityBadgeClass = (density: string) => {
    if (density === "High") return "bg-red-500";
    if (density === "Medium") return "bg-yellow-500";
    return "bg-green-500";
  };

  // --- JSX Render ---
  return (
    <>
      {/* External stylesheets for Leaflet */}
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossOrigin="" />
      
      <div className={`h-screen flex flex-col transition-colors duration-300 ${darkMode ? "bg-gray-900" : "bg-gray-50"}`}>
        {/* Header Section */}
        <header className={`shadow-sm border-b px-6 py-4 transition-colors duration-300 ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>NYC Bus Traffic Predictor</h1>
              <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Real-time route density and dispatches</p>
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-md ${darkMode ? "bg-gray-700 text-yellow-400 hover:bg-gray-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`} title="Toggle dark mode">
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden bg-blue-500 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-600">
                {sidebarOpen ? "Hide" : "Show"} Schedule
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar for Dispatch Schedule */}
          <aside className={`${sidebarOpen ? "w-80" : "w-0"} lg:w-80 border-r shadow-sm transition-all duration-300 overflow-hidden ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
            <div className={`p-4 border-b ${darkMode ? "border-gray-700" : ""}`}>
              <h2 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Dispatch Schedule</h2>
            </div>
            <div className="overflow-y-auto h-full pb-20">
              <div className="p-4 space-y-3">
                {isLoading ? (
                  <div className="text-center text-gray-500">Loading...</div>
                ) : (
                  dispatches.map((dispatch) => (
                    <div key={dispatch.id} className={`rounded-lg p-3 border ${darkMode ? "bg-gray-700 border-gray-600" : "bg-gray-50 border-gray-200"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-medium text-sm ${darkMode ? "text-white" : "text-gray-900"}`}>Bus {dispatch.busId}</span>
                        <span className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{dispatch.time}</span>
                      </div>
                      <div className={`text-sm mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Route: <span className="font-medium">{dispatch.route}</span></div>
                      <div className="flex items-center">
                        <span className={`inline-block w-3 h-3 rounded-full mr-2 ${getDensityBadgeClass(dispatch.density)}`}></span>
                        <span className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>{dispatch.density} density</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          {/* Main Map Area */}
          <main className="flex-1 relative">
            <div ref={mapRef} className="w-full h-full" />
            <div className={`absolute top-4 right-4 rounded-lg shadow-md p-3 ${darkMode ? "bg-gray-800 border border-gray-700" : "bg-white"}`}>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Live Updates</span>
              </div>
            </div>
            <div className={`absolute bottom-4 right-4 rounded-lg shadow-md p-4 ${darkMode ? "bg-gray-800 border border-gray-700" : "bg-white"}`}>
              <h3 className={`text-sm font-semibold mb-2 ${darkMode ? "text-white" : "text-gray-900"}`}>Route Density</h3>
              <div className="space-y-2">
                <div className="flex items-center"><div className="w-4 h-1 bg-green-500 mr-2"></div><span className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Low</span></div>
                <div className="flex items-center"><div className="w-4 h-1 bg-yellow-500 mr-2"></div><span className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Medium</span></div>
                <div className="flex items-center"><div className="w-4 h-1 bg-red-500 mr-2"></div><span className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-700"}`}>High</span></div>
                <div className="flex items-center mt-2"><div className="w-4 h-1 border-t border-b border-gray-400 mr-2"></div><span className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Inactive</span></div>
              </div>
            </div>
          </main>
        </div>

        {/* Footer Section */}
        <footer className={`border-t px-6 py-3 ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
          <div className={`flex items-center justify-between text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
            <span>Powered by AI Predictions</span>
            <span>{isClient ? currentTime.toLocaleTimeString() : "--:--:--"}</span>
          </div>
        </footer>
      </div>

      {/* Scoped CSS for custom styling */}
      <style jsx>{`
        .leaflet-tooltip {
          background: ${darkMode ? "#374151" : "white"} !important;
          color: ${darkMode ? "white" : "black"} !important;
          border: 1px solid ${darkMode ? "#6B7280" : "#ccc"} !important;
        }
        .overflow-y-auto {
          scrollbar-width: thin;
          scrollbar-color: ${darkMode ? "#4B5563 #374151" : "#CBD5E0 #F7FAFC"};
        }
      `}</style>
    </>
  )
}
