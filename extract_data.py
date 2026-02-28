import fastf1
import pandas as pd
import os

# 1. Setup Cache (Crucial: FastF1 downloads gigabytes of telemetry)
cache_dir = 'f1_cache'
if not os.path.exists(cache_dir):
    os.makedirs(cache_dir)
fastf1.Cache.enable_cache(cache_dir)

# 2. Load the Session (Using 2024 as a complete, stable dataset)
print("Loading Belgian GP Race Session...")
session = fastf1.get_session(2024, 'Belgium', 'R')
session.load(telemetry=False, weather=True) # We don't need raw car telemetry (throttle/brake) for the strategy engine

# 3. Pick a Driver to model (e.g., 'HAM' for Lewis Hamilton)
driver_code = 'HAM'
print(f"Extracting lap data for {driver_code}...")
driver_laps = session.laps.pick_driver(driver_code)

# 4. Filter for clean racing laps (Remove Safety Cars, VSC, and Pit In/Out laps)
# TrackStatus '1' means green flag racing. IsAccurate ensures no timing glitches.
clean_laps = driver_laps.pick_track_status('1')
clean_laps = clean_laps[clean_laps['IsAccurate'] == True]

# 5. Fetch Weather Data and align it with the laps
weather_data = clean_laps.get_weather_data()
clean_laps.reset_index(drop=True, inplace=True)
weather_data.reset_index(drop=True, inplace=True)

# Combine lap data with weather data
full_data = pd.concat([clean_laps, weather_data.loc[:, ~(weather_data.columns.isin(clean_laps.columns))]], axis=1)

# 6. Extract only the features our C++ engine and Mistral agent need
extracted_features = pd.DataFrame({
    'LapNumber': full_data['LapNumber'],
    'Stint': full_data['Stint'],
    'Compound': full_data['Compound'],
    'TyreLife': full_data['TyreLife'],
    'TrackTemp': full_data['TrackTemp'],
    # Convert timedelta to raw seconds for the C++ Kalman Filter
    'LapTime_Sec': full_data['LapTime'].dt.total_seconds() 
})

# 7. Calculate the "Degradation Delta" (How much time is lost compared to the fastest lap of the stint)
# This is the 'noisy_measurement' (z_k) that we will feed into the C++ Kalman Filter
extracted_features['Degradation_Delta'] = extracted_features.groupby('Stint')['LapTime_Sec'].transform(lambda x: x - x.min())

# 8. Export to CSV
output_filename = f'belgian_gp_{driver_code}_telemetry.csv'
extracted_features.to_csv(output_filename, index=False)
print(f"Successfully exported {len(extracted_features)} laps to {output_filename}")