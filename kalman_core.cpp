#include <iostream>
#include <cmath>
#include <vector>

class TireDegradationFilter {
private:
    double x; // State estimate (Current true degradation impact in seconds)
    double P; // Estimate error covariance
    double Q; // Process noise covariance (How unpredictable is the tire wear itself?)
    double R; // Measurement noise covariance (How noisy are the raw lap times?)
    double wear_rate; // Expected degradation per lap

public:
    // Initialize the filter with base assumptions
    TireDegradationFilter(double initial_deg, double initial_p, double q, double r, double expected_wear) {
        x = initial_deg;
        P = initial_p;
        Q = q;
        R = r;
        wear_rate = expected_wear;
    }

    // Step 1 & 2: Predict and Update based on a new noisy lap time reading
    double update(double noisy_measurement) {
        // --- PREDICT STEP ---
        // A priori state estimate: Add expected wear to the previous state
        double x_pred = x + wear_rate;
        // A priori estimate covariance
        double P_pred = P + Q;

        // --- UPDATE STEP ---
        // Calculate Kalman Gain
        double K = P_pred / (P_pred + R);
        
        // A posteriori state estimate (incorporating the new noisy measurement)
        x = x_pred + K * (noisy_measurement - x_pred);
        
        // A posteriori estimate covariance
        P = (1 - K) * P_pred;

        return x; // Return the smoothed true degradation state
    }

    // Calculate the probability of hitting the "Tire Cliff"
    // Uses a sigmoid function to map degradation to a probability [0, 1]
    double calculateCliffProbability(double cliff_threshold, double steepness) {
        // Bayesian mapping: As x approaches the cliff_threshold, probability spikes
        return 1.0 / (1.0 + std::exp(-steepness * (x - cliff_threshold)));
    }
};

int main() {
    // Initialization: 0.0s initial deg, 1.0 initial variance, 
    // 0.01 process noise, 0.5 measurement noise, 0.05s expected wear per lap
    TireDegradationFilter filter(0.0, 1.0, 0.01, 0.5, 0.05);

    // Simulated noisy telemetry (Raw lap time degradation deltas)
    std::vector<double> noisy_telemetry = {0.04, 0.12, 0.09, 0.25, 0.18, 0.35, 0.30, 0.55, 0.48, 0.70};
    
    double cliff_threshold = 0.60; // Degradation delta where the tire falls off the cliff
    double steepness = 15.0;       // How sudden the cliff is

    std::cout << "Lap\tRaw Delta\tSmoothed Deg\tCliff Probability\n";
    std::cout << "---------------------------------------------------------\n";

    for (size_t i = 0; i < noisy_telemetry.size(); ++i) {
        double smoothed_state = filter.update(noisy_telemetry[i]);
        double cliff_prob = filter.calculateCliffProbability(cliff_threshold, steepness);
        
        printf("%zu\t%.3fs\t\t%.3fs\t\t%.1f%%\n", i+1, noisy_telemetry[i], smoothed_state, cliff_prob * 100);
    }

    return 0;
}