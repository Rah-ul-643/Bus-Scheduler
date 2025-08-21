import os
import pickle
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler, LabelEncoder

class DemandPredictionModel:
    """
    Loads and uses the pre-trained bus demand prediction model.
    """
    def __init__(self, model_path, preprocessor_path, route_encoder_path):
        print("Initializing Demand Prediction Model...")
        self.model = None
        self.preprocessor = None
        self.route_encoder = None
        self.feature_names = None
        self.passenger_col_index = -1
        self._load_artifacts(model_path, preprocessor_path, route_encoder_path)

    def _load_artifacts(self, model_path, preprocessor_path, route_encoder_path):
        try:
            print(f"Loading model from: {model_path}")
            self.model = tf.keras.models.load_model(model_path)

            print(f"Loading preprocessor from: {preprocessor_path}")
            with open(preprocessor_path, 'rb') as f:
                self.preprocessor = pickle.load(f)
            
            # Get feature names from the scaler to find the passenger column
            self.feature_names = self.preprocessor.feature_names_in_
            self.passenger_col_index = np.where(self.feature_names == 'passengers')[0][0]
            print(f"Determined 'passengers' column index: {self.passenger_col_index}")

            print(f"Loading route encoder from: {route_encoder_path}")
            with open(route_encoder_path, 'rb') as f:
                self.route_encoder = pickle.load(f)

            print("✅ All model artifacts loaded successfully.")
        except Exception as e:
            print(f"❌ FATAL ERROR: Could not load model artifacts. {e}")
            raise

    def _inverse_transform_values(self, scaled_values):
        min_val = self.preprocessor.min_[self.passenger_col_index]
        scale_val = self.preprocessor.scale_[self.passenger_col_index]
        return scaled_values.flatten() / scale_val + min_val

    def predict(self, input_df: pd.DataFrame, time_sequence_length: int = 24):
        if len(input_df) < time_sequence_length:
            raise ValueError(f"Input data must have at least {time_sequence_length} rows.")

        df = input_df.copy()
        df['route'] = self.route_encoder.transform(df['route'])
        
        # Ensure columns are in the exact order the scaler expects
        df = df[self.feature_names]

        sequence_data = df.tail(time_sequence_length)
        scaled_data = self.preprocessor.transform(sequence_data)
        model_input = np.expand_dims(scaled_data, axis=0)
        predicted_scaled = self.model.predict(model_input)
        predicted_passengers = self._inverse_transform_values(predicted_scaled)
        return predicted_passengers[0]
