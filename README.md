# Dynamic Bus Scheduling and Dispatch System

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Code Coverage](https://img.shields.io/badge/coverage-85%25-yellowgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

> An intelligent system using a deep learning model to forecast hourly passenger demand per route. An algorithm then creates an optimized schedule by calculating the required buses and their departure times while prioritizing critical routes. This replaces static timetables with a dynamic, demand-responsive transit network.

---

## 📋 Overview

This project is an intelligent, automated system designed to replace static, timetable-based bus schedules with a dynamic, demand-responsive operation. It transforms a traditional public transit network into a proactive and adaptive service that efficiently meets a city's real-time needs.

The system's core is a **deep learning model** (Transformer-based) that analyzes historical ridership data to accurately forecast passenger demand for each bus route for the upcoming hour. This predictive insight is the foundation for all operational decisions.

This forecast is then fed into a sophisticated **dispatch algorithm** that performs two critical functions:
1.  **Optimal Scheduling**: The algorithm translates the passenger demand forecast into an exact number of required buses for each route. It then calculates the optimal time gap (**headway**) between bus departures to ensure a smooth, consistent service that avoids both overcrowding and under-utilization.
2.  **Prioritized Resource Allocation**: In scenarios where demand outstrips the available fleet, the algorithm uses a priority scoring system. It intelligently assigns buses to the most critical routes first—based on demand magnitude and route importance—ensuring the most efficient and fair use of limited resources.

The final output is a complete, optimized dispatch schedule for the next hour, assigning specific available buses to specific routes with precise departure times.

---

## ⚙️ How It Works

The system operates in a continuous hourly cycle, broken down into three main phases:

1.  **🧹 Cleanup Phase**: Before creating a new schedule, the system looks at the previous hour's schedule. It identifies buses that have completed their trips and updates their status back to `available`, returning them to the resource pool. This ensures a complete lifecycle for every vehicle.

2.  **🧠 Prediction Phase**:
    * The engine queries the database for the last 24 hours of historical data for every active route.
    * This data is fed into the pre-trained deep learning model to generate a passenger demand forecast for the next hour for each route.
    * The predictions are stored in the database for the scheduling phase.

3.  **📅 Scheduling Phase**:
    * The algorithm calculates the number of buses needed for each route based on the new forecast and the average capacity of a bus.
    * It determines the optimal **headway** (time between departures) to ensure even service.
    * It calculates a **priority score** for each route to handle potential resource shortages.
    * Using **PostGIS spatial queries**, it assigns the closest available buses to the highest-priority routes first.
    * Finally, it generates and saves the complete, actionable schedule for the next hour into the database.

---

## 🛠️ Technology Stack

* **Backend**: Python
* **Deep Learning**: TensorFlow / PyTorch
* **Database**: PostgreSQL with PostGIS extension for high-performance spatial queries
* **Containerization**: Docker / Docker Compose
* **Data Handling**: Pandas, GeoPandas

---

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

* [Docker](https://www.docker.com/get-started) and [Docker Compose](https://docs.docker.com/compose/install/)
* [Python 3.8+](https://www.python.org/downloads/)
* A historical bus data CSV file (e.g., `historical_data.csv`)

### Installation & Setup

1.  **Clone the repository:**
    ```sh
    git clone [https://github.com/your-username/dynamic-transit-system.git](https://github.com/your-username/dynamic-transit-system.git)
    cd dynamic-transit-system
    ```

2.  **Configure Environment:**
    * Create a `.env` file from the `env.example` template.
    * Update the `POSTGRES_PASSWORD` and other variables as needed.

3.  **Build and Start the Database Service:**
    This command starts only the database container so you can load the initial data.
    ```sh
    docker-compose up -d db
    ```
    Wait for about 30 seconds for the database to initialize.

4.  **Load Historical Data:**
    * Place your historical data CSV file in the project's root directory.
    * Run the provided data loader script to populate the database.
    ```sh
    python load_data.py
    ```

5.  **Run the Full Application:**
    Once the data is loaded, start the main dispatch engine service. The `--build` flag ensures your Python environment is built correctly.
    ```sh
    docker-compose up --build
    ```

You should now see logs from the `dispatch_engine` service as it connects to the database, loads the model, and begins its hourly prediction and scheduling cycle.

---

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
