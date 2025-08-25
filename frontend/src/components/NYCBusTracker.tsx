"use client"

import { useEffect, useRef, useState } from "react"
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

  const fetchData = async () => {
    setIsLoading(true);
    try {
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
      
      const updatedRoutes: Route[] = routesData.map(route => ({
        ...route,
        coordinates: geometryData[route.route_short_name] || [],
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
      });
      setDispatches(formattedDispatches);

    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsClient(true);
    fetchData();
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

  // --- Map initialization and rendering effects (UPDATED) ---
  useEffect(() => {
    // This effect now handles map initialization safely.
    if (isClient && mapRef.current && !map) {
      // Dynamically import Leaflet only on the client-side.
      import('leaflet').then(L => {
        // This part fixes a common issue with icons in React/Next.js
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png').default,
            iconUrl: require('leaflet/dist/images/marker-icon.png').default,
            shadowUrl: require('leaflet/dist/images/marker-shadow.png').default,
        });

        const mapInstance = L.map(mapRef.current!).setView([40.7128, -74.006], 11);
        setMap(mapInstance);
      });
    }
  }, [isClient, map]);

  useEffect(() => {
    // This effect handles the map's theme (tile layer).
    if (map) {
      import('leaflet').then(L => {
        map.eachLayer((layer) => {
          if (layer instanceof L.TileLayer) map.removeLayer(layer);
        });
        const tileUrl = darkMode
          ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
        L.tileLayer(tileUrl, { attribution: "© OpenStreetMap contributors" }).addTo(map);
      });
    }
  }, [darkMode, map]);

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

          const color = route.density > 150 ? "#DC3545" : route.density > 50 ? "#FFC107" : "#28A745";
          const dashArray = route.isActive ? undefined : "10, 10";

          const polyline = L.polyline(route.coordinates, {
            color: color, weight: 4, opacity: 0.8, dashArray: dashArray
          }).addTo(map);

          polyline.bindTooltip(
            `<strong>${route.route_short_name}</strong><br/>
             Predicted density: ${route.density}<br/>
             ${route.activebuses} buses active`,
            { permanent: false, direction: "top" }
          );
        });
      });
    }
  }, [map, routes]);

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

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
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

          {/* Map */}
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

        {/* Footer */}
        <footer className={`border-t px-6 py-3 ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}>
          <div className={`flex items-center justify-between text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
            <span>Powered by AI Predictions</span>
            <span>{isClient ? currentTime.toLocaleTimeString() : "--:--:--"}</span>
          </div>
        </footer>
      </div>

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
