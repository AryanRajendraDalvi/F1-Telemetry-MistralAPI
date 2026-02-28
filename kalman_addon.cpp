#include <napi.h>
#include <cmath>

// This function receives the current state and the new noisy measurement from Node.js
Napi::Value UpdateState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // 1. Extract variables passed from JavaScript
    double x = info[0].As<Napi::Number>().DoubleValue();
    double P = info[1].As<Napi::Number>().DoubleValue();
    double Q = info[2].As<Napi::Number>().DoubleValue();
    double R = info[3].As<Napi::Number>().DoubleValue();
    double wear_rate = info[4].As<Napi::Number>().DoubleValue();
    double measurement = info[5].As<Napi::Number>().DoubleValue();

    // 2. The Predict Step
    double x_pred = x + wear_rate;
    double P_pred = P + Q;

    // 3. The Update Step (Kalman Gain)
    double K = P_pred / (P_pred + R);
    double new_x = x_pred + K * (measurement - x_pred);
    double new_P = (1.0 - K) * P_pred;

    // 4. Calculate Cliff Probability
    double cliff_threshold = 0.60; // Delta where tires fall off
    double steepness = 15.0;
    double cliff_prob = 1.0 / (1.0 + std::exp(-steepness * (new_x - cliff_threshold)));

    // 5. Package the results back into a JavaScript Object
    Napi::Object result = Napi::Object::New(env);
    result.Set("x", new_x);
    result.Set("P", new_P);
    result.Set("cliffProb", cliff_prob);

    return result;
}

// Initialize the addon and export the function
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "updateState"), Napi::Function::New(env, UpdateState));
    return exports;
}

NODE_API_MODULE(kalman_math, Init)