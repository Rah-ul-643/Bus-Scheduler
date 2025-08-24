"use client"

import { useEffect, useRef, useState } from "react"
import * as L from 'leaflet'

interface Route {
  id: string
  name: string
  coordinates: [number, number][]
  density: number
  activeBuses: number
  isActive: boolean
}

interface Dispatch {
  id: string
  busId: string
  route: string
  time: string
  density: string
  densityColor: string
}

declare global {
  interface Window {
    L: typeof L
  }
}

const mockRoutes: Route[] = [
  {
    id: "route-1",
    name: "Manhattan-Brooklyn",
    coordinates: [
      [40.7831, -73.9712],
      [40.7589, -73.9851],
      [40.7505, -73.9934],
      [40.7282, -73.9942],
      [40.6892, -73.9442],
      [40.6782, -73.9442],
    ],
    density: 75,
    activeBuses: 3,
    isActive: true,
  },
  {
    id: "route-2",
    name: "Uptown-Downtown",
    coordinates: [
      [40.8176, -73.9482],
      [40.7831, -73.9712],
      [40.7505, -73.9934],
      [40.7282, -73.9942],
      [40.7074, -74.0113],
    ],
    density: 45,
    activeBuses: 2,
    isActive: false,
  },
  {
    id: "route-3",
    name: "Queens-Manhattan",
    coordinates: [
      [40.7282, -73.7949],
      [40.7505, -73.837],
      [40.7614, -73.9776],
      [40.7831, -73.9712],
    ],
    density: 120,
    activeBuses: 4,
    isActive: true,
  },
  {
    id: "route-4",
    name: "Bronx-Manhattan",
    coordinates: [
      [40.8448, -73.8648],
      [40.8176, -73.9482],
      [40.7831, -73.9712],
      [40.7505, -73.9934],
    ],
    density: 180,
    activeBuses: 5,
    isActive: true,
  },
  {
    id: "route-5",
    name: "Staten Island Ferry",
    coordinates: [
      [40.644, -74.074],
      [40.7074, -74.0113],
    ],
    density: 30,
    activeBuses: 1,
    isActive: false,
  },
]

// Mock dispatch history
const generateMockDispatches = (): Dispatch[] => {
  const dispatches: Dispatch[] = []
  const now = new Date()

  for (let i = 0; i < 15; i++) {
    const time = new Date(now.getTime() - i * 4 * 60 * 1000) // Every 4 minutes
    const route = mockRoutes[Math.floor(Math.random() * mockRoutes.length)]
    const busId = Math.floor(Math.random() * 999) + 100

    dispatches.push({
      id: `dispatch-${i}`,
      busId: `#${busId}`,
      route: route.name,
      time: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      density: route.density > 150 ? "High" : route.density > 50 ? "Medium" : "Low",
      densityColor: route.density > 150 ? "#DC3545" : route.density > 50 ? "#FFC107" : "#28A745",
    })
  }

  return dispatches.sort((a, b) => b.time.localeCompare(a.time))
}

export default function NYCBusTracker() {
  const mapRef = useRef<HTMLDivElement>(null)
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [map, setMap] = useState<L.Map | null>(null)
  const [routes, setRoutes] = useState<Route[]>(mockRoutes)
  const [darkMode, setDarkMode] = useState(false)
  const [isClient, setIsClient] = useState(false)

  // Fix hydration issue by only generating data on client
  useEffect(() => {
    setIsClient(true)
    setDispatches(generateMockDispatches())
  }, [])

  useEffect(() => {
    // Update current time every second (only on client)
    if (isClient) {
      const timeInterval = setInterval(() => {
        setCurrentTime(new Date())
      }, 1000)

      // Update dispatches every 10 seconds
      const dispatchInterval = setInterval(() => {
        setDispatches(generateMockDispatches())

        // Update route densities randomly
        setRoutes((prevRoutes) =>
          prevRoutes.map((route) => ({
            ...route,
            density: Math.floor(Math.random() * 200) + 20,
            activeBuses: Math.floor(Math.random() * 6) + 1,
            isActive: Math.random() > 0.3,
          })),
        )
      }, 10000)

      return () => {
        clearInterval(timeInterval)
        clearInterval(dispatchInterval)
      }
    }
  }, [isClient])

  useEffect(() => {
    if (typeof window !== "undefined" && mapRef.current && !map) {
      const initMap = () => {
        const LeafletLib = window.L
        if (!LeafletLib) {
          setTimeout(initMap, 100)
          return
        }

        const mapInstance = LeafletLib.map(mapRef.current!).setView([40.7128, -74.006], 11)

        const tileLayer = darkMode
          ? LeafletLib.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
              attribution: "© OpenStreetMap contributors © CARTO",
              subdomains: "abcd",
              maxZoom: 19,
            })
          : LeafletLib.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
              attribution: "© OpenStreetMap contributors",
            })

        tileLayer.addTo(mapInstance)
        setMap(mapInstance)
      }

      initMap()
    }
  }, [map, darkMode])

  useEffect(() => {
    if (map && typeof window !== "undefined") {
      const LeafletLib = window.L

      // Remove existing tile layers
      map.eachLayer((layer: L.Layer) => {
        if (layer instanceof LeafletLib.TileLayer) {
          map.removeLayer(layer)
        }
      })

      // Add new tile layer based on dark mode
      const tileLayer = darkMode
        ? LeafletLib.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
            attribution: "© OpenStreetMap contributors © CARTO",
            subdomains: "abcd",
            maxZoom: 19,
          })
        : LeafletLib.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
          })

      tileLayer.addTo(map)
    }
  }, [darkMode, map])

  useEffect(() => {
    if (map && typeof window !== "undefined") {
      const LeafletLib = window.L

      // Clear existing layers
      map.eachLayer((layer: L.Layer) => {
        if (layer.options && (layer.options as L.PolylineOptions).className === "bus-route") {
          map.removeLayer(layer)
        }
      })

      // Add route polylines
      routes.forEach((route) => {
        const color = route.density > 150 ? "#DC3545" : route.density > 50 ? "#FFC107" : "#28A745"
        const dashArray = route.isActive ? "10, 10" : undefined

        const polyline = LeafletLib.polyline(route.coordinates, {
          color: color,
          weight: 4,
          opacity: 0.8,
          dashArray: dashArray,
          className: "bus-route",
        }).addTo(map)

        // Add tooltip
        polyline.bindTooltip(
          `<strong>${route.name}</strong><br/>
           Predicted density: ${route.density > 150 ? "High" : route.density > 50 ? "Medium" : "Low"}<br/>
           ${route.activeBuses} buses dispatched`,
          { permanent: false, direction: "top" },
        )

        // Add bus markers for active routes
        if (route.isActive) {
          for (let i = 0; i < route.activeBuses; i++) {
            const coordIndex = Math.floor((i / route.activeBuses) * route.coordinates.length)
            const coord = route.coordinates[coordIndex] || route.coordinates[0]

            const busIcon = LeafletLib.divIcon({
              html: "🚌",
              iconSize: [20, 20],
              className: "bus-marker",
            })

            LeafletLib.marker(coord, { icon: busIcon }).addTo(map)
          }
        }
      })
    }
  }, [map, routes])

  const getDensityBadgeClass = (density: string) => {
    switch (density) {
      case "High":
        return "bg-red-500"
      case "Medium":
        return "bg-yellow-500"
      case "Low":
        return "bg-green-500"
      default:
        return "bg-gray-500"
    }
  }

  return (
    <>
      {/* Load Leaflet CSS and JS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
        crossOrigin=""
        async
      />

      <div
        className={`h-screen flex flex-col transition-colors duration-300 ${darkMode ? "bg-gray-900" : "bg-gray-50"}`}
      >
        {/* Header */}
        <header
          className={`shadow-sm border-b px-6 py-4 transition-colors duration-300 ${darkMode ? "bg-gray-800 border-gray-700" : "bg-white"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h1
                className={`text-2xl font-bold transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}
              >
                NYC Bus Traffic Predictor
              </h1>
              <p className={`text-sm transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                Real-time route density and dispatches
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`p-2 rounded-md transition-colors duration-300 ${
                  darkMode
                    ? "bg-gray-700 text-yellow-400 hover:bg-gray-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden bg-blue-500 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-600 transition-colors duration-300"
              >
                {sidebarOpen ? "Hide" : "Show"} Schedule
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div
            className={`${sidebarOpen ? "w-80" : "w-0"} lg:w-80 border-r shadow-sm transition-all duration-300 overflow-hidden ${
              darkMode ? "bg-gray-800 border-gray-700" : "bg-white"
            }`}
          >
            <div className={`p-4 border-b transition-colors duration-300 ${darkMode ? "border-gray-700" : ""}`}>
              <h2
                className={`text-lg font-semibold transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}
              >
                Past Hour Dispatch Schedule
              </h2>
            </div>
            <div className="overflow-y-auto h-full pb-20">
              <div className="p-4 space-y-3">
                {!isClient ? (
                  // Show loading skeleton during SSR
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className={`rounded-lg p-3 border animate-pulse transition-colors duration-300 ${
                          darkMode ? "bg-gray-700 border-gray-600" : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className={`h-4 w-16 rounded ${darkMode ? "bg-gray-600" : "bg-gray-300"}`}></div>
                          <div className={`h-3 w-12 rounded ${darkMode ? "bg-gray-600" : "bg-gray-300"}`}></div>
                        </div>
                        <div className={`h-3 w-24 rounded mb-2 ${darkMode ? "bg-gray-600" : "bg-gray-300"}`}></div>
                        <div className="flex items-center">
                          <div className={`w-3 h-3 rounded-full mr-2 ${darkMode ? "bg-gray-600" : "bg-gray-300"}`}></div>
                          <div className={`h-3 w-16 rounded ${darkMode ? "bg-gray-600" : "bg-gray-300"}`}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  dispatches.map((dispatch) => (
                    <div
                      key={dispatch.id}
                      className={`rounded-lg p-3 border transition-colors duration-300 ${
                        darkMode ? "bg-gray-700 border-gray-600" : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`font-medium text-sm transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                          Bus {dispatch.busId}
                        </span>
                        <span
                          className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-400" : "text-gray-500"}`}
                        >
                          {dispatch.time}
                        </span>
                      </div>
                      <div
                        className={`text-sm mb-2 transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                      >
                        Route: <span className="font-medium">{dispatch.route}</span>
                      </div>
                      <div className="flex items-center">
                        <span
                          className={`inline-block w-3 h-3 rounded-full mr-2 ${getDensityBadgeClass(dispatch.density)}`}
                        ></span>
                        <span
                          className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-400" : "text-gray-600"}`}
                        >
                          {dispatch.density} density
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="flex-1 relative">
            <div ref={mapRef} className="w-full h-full" />

            {/* Loading overlay */}
            <div
              className={`absolute top-4 right-4 rounded-lg shadow-md p-3 transition-colors duration-300 ${
                darkMode ? "bg-gray-800 border border-gray-700" : "bg-white"
              }`}
            >
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                <span
                  className={`text-sm transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-600"}`}
                >
                  Live Updates
                </span>
              </div>
            </div>

            {/* Legend */}
            <div
              className={`absolute bottom-4 right-4 rounded-lg shadow-md p-4 transition-colors duration-300 ${
                darkMode ? "bg-gray-800 border border-gray-700" : "bg-white"
              }`}
            >
              <h3
                className={`text-sm font-semibold mb-2 transition-colors duration-300 ${darkMode ? "text-white" : "text-gray-900"}`}
              >
                Route Density
              </h3>
              <div className="space-y-2">
                <div className="flex items-center">
                  <div className="w-4 h-1 bg-green-500 mr-2"></div>
                  <span
                    className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                  >
                    Low (&lt;50)
                  </span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-1 bg-yellow-500 mr-2"></div>
                  <span
                    className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                  >
                    Medium (50-150)
                  </span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-1 bg-red-500 mr-2"></div>
                  <span
                    className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                  >
                    High (&gt;150)
                  </span>
                </div>
                <div className="flex items-center mt-3">
                  <div
                    className="w-4 h-1 bg-blue-500 mr-2"
                    style={{ borderStyle: "dashed", borderWidth: "1px 0" }}
                  ></div>
                  <span
                    className={`text-xs transition-colors duration-300 ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                  >
                    Active Route
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer
          className={`border-t px-6 py-3 transition-colors duration-300 ${
            darkMode ? "bg-gray-800 border-gray-700" : "bg-white"
          }`}
        >
          <div
            className={`flex items-center justify-between text-sm transition-colors duration-300 ${
              darkMode ? "text-gray-300" : "text-gray-600"
            }`}
          >
            <span>Powered by Mock AI Predictions</span>
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
      `}</style>
    </>
  )
}
