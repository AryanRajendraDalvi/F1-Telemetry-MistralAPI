const express = require('express');
const http = require('http');
const fs = require('fs');
const csv = require('csv-parser');

// 🚀 Import your compiled C++ math engine
const kalmanMath = require('./build/Release/kalman_math.node');

const app = express();
const server = http.createServer(app);

// Initial Kalman Filter State (Matching our C++ defaults)
let state = {
    x: 0.0,        // Initial degradation state
    P: 1.0,        // Initial variance
    Q: 0.01,       // Process noise
    R: 0.5,        // Measurement noise
    wear_rate: 0.05 // Expected wear per lap
};

// Make sure this matches the filename of the CSV you generated earlier!
const CSV_FILE = 'belgian_gp_HAM_telemetry.csv'; 

function startRaceSimulation() {
    const telemetryStream = [];
    
    // Read the CSV file into memory
    fs.createReadStream(CSV_FILE)
        .pipe(csv())
        .on('data', (row) => telemetryStream.push(row))
        .on('end', () => {
            console.log('--- Telemetry Loaded. Starting Live Race Simulation ---');
            let currentLap = 0;

            // Simulate receiving a new telemetry packet every 1 second
            const interval = setInterval(() => {
                if (currentLap >= telemetryStream.length) {
                    clearInterval(interval);
                    console.log('--- Race Finished ---');
                    return;
                }

                const rawData = telemetryStream[currentLap];
                const degradationDelta = parseFloat(rawData.Degradation_Delta);

                if (!isNaN(degradationDelta)) {
                    // ⚡ PASS DATA TO NATIVE C++ ENGINE ⚡
                    const result = kalmanMath.updateState(
                        state.x, state.P, state.Q, state.R, state.wear_rate, degradationDelta
                    );

                    // Update our JS state for the next lap iteration
                    state.x = result.x;
                    state.P = result.P;

                    // Format the output for the console
                    console.log(`Lap ${rawData.LapNumber.padStart(2, '0')} | ` +
                                `Raw Drop: ${degradationDelta.toFixed(3)}s | ` +
                                `Smoothed True Wear: ${result.x.toFixed(3)}s | ` +
                                `Cliff Prob: ${(result.cliffProb * 100).toFixed(1)}%`);

                    // 🧠 THE AI TRIGGER 🧠
                    if (result.cliffProb > 0.70) {
                        console.log('\n🚨 TIRE CLIFF PROBABILITY > 70%! 🚨');
                        console.log('--> Suspending telemetry stream...');
                        console.log('--> Triggering Mistral API to formulate pit strategy...\n');
                        
                        clearInterval(interval); // Pause the simulation while Mistral "thinks"
                        // TODO: Integrate Mistral API call here
                    }
                }
                currentLap++;
            }, 1000); // 1000ms = 1 second per lap
        });
}

server.listen(3000, () => {
    console.log('Pit Wall Strategist Server running on port 3000');
    startRaceSimulation();
});