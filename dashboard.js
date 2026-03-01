require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const { Mistral } = require('@mistralai/mistralai');

// Import strategy modules
const WeatherAnalyzer = require('./weather_analyzer');
const TireStrategy = require('./tire_strategy');
const CompetitiveAnalysis = require('./competitive_analysis');
const FuelStrategy = require('./fuel_strategy');
const PitStopAnalyzer = require('./pit_stop_analyzer');

// Check Mistral AI Key
const apiKey = process.env.MISTRAL_API_KEY;
if (!apiKey) {
    console.error("MISTRAL_API_KEY not found in .env. Please set it and run again.");
    process.exit(1);
}

const client = new Mistral({ apiKey });

// Import C++ math engine
let kalmanMath;
try {
    kalmanMath = require('./build/Release/kalman_math.node');
} catch (err) {
    console.error("Could not load native module `kalman_math.node`: " + err.message);
    process.exit(1);
}

// Randomize starting grid position (P1-P20) with uniform distribution
// Using ceil ensures we get exactly 1-20 with equal probability
const startingPosition = Math.ceil(Math.random() * 20);

// Initialize strategy modules
const weatherAnalyzer = new WeatherAnalyzer();
const tireStrategy = new TireStrategy('HAM', null, startingPosition); // Random tire + position
const competitiveAnalysis = new CompetitiveAnalysis();
const fuelStrategy = new FuelStrategy(110, 44); // 110kg fuel, 44 lap race
const pitStopAnalyzer = new PitStopAnalyzer(7.0);

// Initial Kalman Filter State
let state = {
    x: 0.0,
    P: 1.0,
    Q: 0.002,
    R: 1.5,
    wear_rate: 0.045
};

// Simulation state for track and weather conditions
let raceState = {
    currentPosition: startingPosition,
    gapToLeader: startingPosition === 1 ? 0.0 : (startingPosition - 1) * 0.5 + (Math.random() * 2), // Gap increases with position
    trackTemp: 25,
    airTemp: 20,
    humidity: 65,
    rainfall: 0,
    enduranceMultiplier: 1.0
};

// UI SETUP (Blessed) - Enhanced Grid
const screen = blessed.screen({
    smartCSR: true,
    title: 'F1 Pit Wall Strategist Dashboard - Enhanced'
});

const grid = new contrib.grid({ rows: 20, cols: 16, screen: screen });

// Window 1 (Left): Raw Telemetry Log
const telemetryLog = grid.set(0, 0, 10, 8, contrib.log, {
    fg: 'green',
    label: 'Raw Telemetry Stream',
    height: '100%',
    width: '100%',
    border: { type: 'line', fg: 'cyan' }
});

// Window 3 (Right Top): Agent Terminal Log
const agentTerminal = grid.set(0, 8, 5, 8, contrib.log, {
    fg: 'yellow',
    label: 'Agent Terminal (Pit Strategist)',
    height: '100%',
    width: '100%',
    border: { type: 'line', fg: 'yellow' }
});

// Window 4: Tire Strategy Info
const strategyBox = grid.set(5, 8, 3, 8, contrib.log, {
    fg: 'cyan',
    label: 'Tire Strategy & Stints',
    height: '100%',
    width: '100%',
    border: { type: 'line', fg: 'cyan' }
});

// Window 5: Weather & Conditions
const weatherBox = grid.set(8, 8, 2, 8, contrib.log, {
    fg: 'magenta',
    label: 'Weather Conditions',
    height: '100%',
    width: '100%',
    border: { type: 'line', fg: 'magenta' }
});

// Window 2 (Bottom Left): Line Chart for Tire Degradation and Cliff Prob
const lineChart = grid.set(10, 0, 10, 8, contrib.line, {
    label: 'Tire State vs Laps',
    showLegend: true,
    legend: { width: 14 },
    style: {
        line: 'red',
        text: 'white',
        baseline: 'black'
    },
    xLabelPadding: 3,
    xPadding: 5,
    showNumb: true,
    numStyle: 'yellow'
});

// Window 6: Fuel & Track Position
const fuelPosBox = grid.set(10, 8, 5, 8, contrib.log, {
    fg: 'blue',
    label: 'Fuel & Track Position',
    height: '100%',
    width: '100%',
    border: { type: 'line', fg: 'blue' }
});

// Window 7: Competitive Analysis
const compAnalysisBox = grid.set(15, 8, 5, 8, contrib.log, {
    fg: 'white',
    label: 'Competitive Analysis',
    height: '100%',
    width: '100%',
    border: { type: 'line', fg: 'white' }
});

// To view "Wear (s)" and "Cliff Prob %" on the same chart logically,
// We will scale "Wear" by a factor of 100 on the graph view so it visually aligns with % Prob,
// or we keep them on different lines. Since Blessedcontrib scales globally, we'll scale wear by 100.
const wearSeries = {
    title: 'Wear (sx100)',
    x: [],
    y: [],
    style: { line: 'red' }
};

const cliffSeries = {
    title: 'Cliff Prob %',
    x: [],
    y: [],
    style: { line: 'magenta' }
};

// Key binding to quit
screen.key(['escape', 'q', 'C-c'], function (ch, key) {
    return process.exit(0);
});

screen.render();

const CSV_FILE = 'belgian_gp_HAM_telemetry.csv';

// State variables for tracking
let isAgentThinking = false;
let lastDecisionLap = -5; // prevent immediate double trigger
let currentLap = 0;
let executePitStop = false;
let pitStopCount = 0;
let currentTireCompound = tireStrategy.currentStint.tireCompound; // Use actual starting compound!
let previousTireCompound = tireStrategy.currentStint.tireCompound;
let startingTireCompound = tireStrategy.currentStint.tireCompound;
let positionBeforePit = 1;
let lapsSinceLastPit = 0;

function wrapAndLog(terminal, text, maxWidth = 45) {
    if (!text) return;
    const lines = text.split('\n');
    for (const line of lines) {
        const words = line.split(' ');
        let currentLine = '';
        for (const word of words) {
            if ((currentLine + word).length > maxWidth) {
                terminal.log(currentLine);
                currentLine = word + ' ';
            } else {
                currentLine += word + ' ';
            }
        }
        if (currentLine.trim()) terminal.log(currentLine.trim());
    }
}

function updateStrategyDisplay(lap) {
    const stintInfo = tireStrategy.getStintSummary('current');
    const allStints = tireStrategy.getAllStintsSummary();

    strategyBox.setContent('');
    strategyBox.log(`\x1b[36m=== TIRE STRATEGY ===\x1b[0m`);
    strategyBox.log(`Strategy: ${tireStrategy.assessStrategy()}`);
    strategyBox.log(`Total Pit Stops: ${pitStopCount}`);
    strategyBox.log(``);
    strategyBox.log(`\x1b[33mCurrent Stint:\x1b[0m`);
    if (stintInfo) {
        strategyBox.log(`  Stint #${stintInfo.num} | ${stintInfo.compound}`);
        strategyBox.log(`  Laps Done: ${stintInfo.laps}`);
        strategyBox.log(`  Started P${stintInfo.startPos} (${stintInfo.weather})`);
    }

    if (allStints.length > 0) {
        strategyBox.log(``);
        strategyBox.log(`\x1b[33mPrevious Stints:\x1b[0m`);
        allStints.forEach(stint => {
            strategyBox.log(`  S${stint.num}: ${stint.compound} (${stint.laps}L) P${stint.startPos}→P${stint.endPos}`);
        });
    }
}

function updateWeatherDisplay() {
    weatherBox.setContent('');
    const weather = weatherAnalyzer.analyzeWeatherImpact(
        raceState.trackTemp,
        raceState.airTemp,
        raceState.humidity,
        raceState.rainfall
    );

    weatherBox.log(`\x1b[35m=== WEATHER CONDITIONS ===\x1b[0m`);
    weatherBox.log(`${weather.condition} | Grip: ${weather.gripLevel}`);
    weatherBox.log(`Track: ${weather.trackTemp}°C | Air: ${weather.airTemp}°C | RH: ${weather.humidity}%`);
    if (weather.riskFactors.length > 0) {
        weatherBox.log(`⚠️  ${weather.riskFactors.join(', ')}`);
    }
}

function updateFuelDisplay(currentLap = 0) {
    const fuelStatus = fuelStrategy.getFuelStatus();
    const lapsRemaining = fuelStrategy.getLapsRemaining(currentLap);

    fuelPosBox.setContent('');
    fuelPosBox.log(`\x1b[36m=== FUEL & POSITION ===\x1b[0m`);
    fuelPosBox.log(`Position: P${raceState.currentPosition}`);
    fuelPosBox.log(`Gap to Leader: ${raceState.gapToLeader.toFixed(3)}s`);
    fuelPosBox.log(``);
    fuelPosBox.log(`Fuel: ${fuelStatus.currentFuel}kg (${fuelStatus.percentage}%)`);
    fuelPosBox.log(`Laps Remaining: ${lapsRemaining}`);

    if (fuelStatus.critical) {
        fuelPosBox.log(`\x1b[31m🚨 CRITICAL FUEL\x1b[0m`);
    } else if (fuelStatus.warning) {
        fuelPosBox.log(`\x1b[33m⚠️  LOW FUEL\x1b[0m`);
    }
}

function updateCompetitiveDisplay() {
    compAnalysisBox.setContent('');
    const analysis = competitiveAnalysis.analyzeCompetitiveAdvantage('HAM');

    compAnalysisBox.log(`\x1b[37m=== COMPETITIVE ANALYSIS ===\x1b[0m`);
    if (analysis) {
        compAnalysisBox.log(`Your Position: P${analysis.myPosition}`);
        compAnalysisBox.log(``);

        if (analysis.competitorComparison.length > 0) {
            compAnalysisBox.log(`\x1b[33mNearby Competitors:\x1b[0m`);
            analysis.competitorComparison.forEach(comp => {
                const posStr = comp.positionDiff > 0 ? `+${comp.positionDiff}` : `${comp.positionDiff}`;
                compAnalysisBox.log(`  ${comp.driver}: P${comp.position} (${posStr}) | Stops: ${comp.pitstops}`);
            });
        }

        if (analysis.opportunities.length > 0) {
            compAnalysisBox.log(``);
            compAnalysisBox.log(`\x1b[32m✓ Opportunities:\x1b[0m`);
            analysis.opportunities.slice(0, 2).forEach(opp => compAnalysisBox.log(`  • ${opp}`));
        }

        if (analysis.risks.length > 0) {
            compAnalysisBox.log(``);
            compAnalysisBox.log(`\x1b[31m✗ Risks:\x1b[0m`);
            analysis.risks.slice(0, 2).forEach(risk => compAnalysisBox.log(`  • ${risk}`));
        }
    }
}

function handleAiDecision(lap, dropObj, currentP, currentCliff) {
    if (isAgentThinking) return;

    // ============================================
    // MANDATORY PIT STOP CHECK - ONLY FOR CRITICAL TIRE FAILURE
    // ============================================
    const isMandatoryPit = tireStrategy.isPitStopMandatory(lapsSinceLastPit, currentTireCompound);
    if (isMandatoryPit) {
        agentTerminal.log(`\n[Lap ${lap}] 🚨 CRITICAL TIRE FAILURE - Immediate pit required for ${currentTireCompound} (age ${lapsSinceLastPit}/${tireStrategy.getMaxLaps(currentTireCompound)})`);
        executePitStop = true;
        positionBeforePit = raceState.currentPosition;
        return;
    }

    // ============================================
    // STANDARD STRATEGY CHECK
    // ============================================

    // Use pit stop analyzer to determine if pit is strategically needed
    const pitAnalysis = pitStopAnalyzer.analyzePitStrategy({
        lap,
        currentPosition: raceState.currentPosition,
        gapToLeader: raceState.gapToLeader,
        cliffProb: currentCliff,
        fuel: parseFloat(fuelStrategy.getFuelStatus().currentFuel),
        fuelPerLap: fuelStrategy.getAverageConsumption(),
        weather: weatherAnalyzer.analyzeWeatherImpact(raceState.trackTemp, raceState.airTemp, raceState.humidity, raceState.rainfall).condition,
        lapsSincePit: lapsSinceLastPit,
        tireAge: lapsSinceLastPit,
        maxTireAge: tireStrategy.getMaxLaps(currentTireCompound)
    });

    // Only trigger AI decision if pit is strategically important or cliff is critical
    const shouldDecide = currentCliff > 0.40 || (lap > 0 && lap % 4 === 0) || pitAnalysis.shouldPit;

    if (shouldDecide) {
        if (lap - lastDecisionLap < 2) return;

        lastDecisionLap = lap;
        isAgentThinking = true;
        agentTerminal.log(`\n[Lap ${lap}] 🚨 Strategy check (Cliff: ${(currentCliff * 100).toFixed(1)}%, Urgency: ${pitAnalysis.totalUrgency}/10)`);
        screen.render();

        const weatherData = weatherAnalyzer.analyzeWeatherImpact(
            raceState.trackTemp,
            raceState.airTemp,
            raceState.humidity,
            raceState.rainfall
        );

        const fuelStatus = fuelStrategy.getFuelStatus();
        const competitive = competitiveAnalysis.analyzeCompetitiveAdvantage('HAM');

        // Calculate pit stop impact
        const pitImpact = pitStopAnalyzer.estimatePositionLoss(raceState.currentPosition, lap);
        const timeLossStr = `${pitImpact.timeLossSeconds}s (~${pitImpact.positionsLost} positions)`;

        // Get tire wear status
        const tireWearStatus = tireStrategy.getTireWearStatus(lapsSinceLastPit, currentTireCompound);
        const maxLapsForCompound = tireStrategy.getMaxLaps(currentTireCompound);
        const degradationMultiplier = tireStrategy.getDegradationCurveMultiplier(lapsSinceLastPit, currentTireCompound);

        const prompt = `You are the lead race strategist for F1 Hamilton's team. Analyze race data and decide whether to pit now or stay out. Return JSON: {"decision": "BOX" or "STAY", "confidence": 0.0-1.0, "reasoning": "explanation", "tireRecommendation": "SOFT/MEDIUM/HARD/WET"}.

CRITICAL RULES:
- PODIUM PROTECTION: If in P1-P3, ONLY pit if Cliff > 85% AND more than 10 laps remaining. Podium > everything else.
- PIT (BOX) if: (Cliff Prob > 75% AND not podium) OR Fuel < 10 laps, OR degradation multiplier > 3.0, OR strategic advantage clear
- STAY OUT if: Tire is FRESH/NORMAL, Cliff < 65%, fuel adequate - early pits waste races. ESPECIALLY if in podium position.
- TIRE AGE: Each compound has realistic lifespan. Softs degrade fastest (18 laps max), Hards last longest (40 laps max)
- Each pit stop costs ${timeLossStr} - must be justified. AVOID if in podium unless catastrophic tire failure.

TIRE COMPOUND LIFETIMES (max safe laps):
- SOFT: 18 laps (aggressive degradation late-stint)
- MEDIUM: 28 laps (balanced wear)
- HARD: 40 laps (conservative degradation)

TELEMETRY (Lap ${lap}):
- Current Tires: ${currentTireCompound}
- Laps on Current Tires: ${lapsSinceLastPit}/${maxLapsForCompound} (${Math.round((lapsSinceLastPit / maxLapsForCompound) * 100)}% of lifespan)
- Tire Wear Status: ${tireWearStatus}
- Degradation Curve Multiplier: ${degradationMultiplier.toFixed(2)}x (1.0=normal, 4.0+=critical cliff)
- Cliff Probability: ${(currentCliff * 100).toFixed(1)}% (CRITICAL if >75%)
- True Tire Wear: ${dropObj.toFixed(3)}s
- Pit Stops Made: ${pitStopCount}

POSITION & GAP:
- Current Position: P${raceState.currentPosition} ${raceState.currentPosition <= 3 ? '🏆 PODIUM POSITION - PROTECT!' : ''}
- Gap to Leader: ${raceState.gapToLeader.toFixed(3)}s
- PIT IMPACT: Lose ${timeLossStr} → P${pitImpact.newPosition}

FUEL SITUATION:
- Fuel: ${fuelStatus.currentFuel}kg (${fuelStatus.percentage}%)
- Laps Remaining: ${fuelStrategy.getLapsRemaining(lap)}
- Avg Consumption: ${fuelStatus.avgConsumption}kg/lap
${fuelStatus.critical ? '⚠️  CRITICAL LOW FUEL' : fuelStatus.warning ? '⚠️  LOW FUEL' : '✓ Fuel OK'}

WEATHER:
- Current: ${weatherData.condition}
- Grip: ${weatherData.gripLevel}
- Recommended Compound: ${weatherData.recommendedTireCompound}
${weatherData.riskFactors.length > 0 ? '- Risks: ' + weatherData.riskFactors.join(', ') : ''}

STRATEGY ANALYSIS:
- Total Pit Urgency: ${pitAnalysis.totalUrgency}/10
- Reasons: ${pitAnalysis.reason.slice(0, 2).join('; ')}`;

        client.chat.complete({
            model: 'mistral-large-latest',
            messages: [{ role: 'system', content: prompt }],
            responseFormat: { type: 'json_object' }
        }).then(res => {
            try {
                const responseContent = res.choices[0].message.content;
                const parsed = JSON.parse(responseContent);
                const reasoning = parsed.reasoning || parsed.Reasoning || "No reasoning provided by agent.";
                const tireRec = parsed.tireRecommendation || 'MEDIUM';

                agentTerminal.log(``);
                agentTerminal.log(`\x1b[4m>>> STRATEGY DECISION (Lap ${lap}) <<<\x1b[0m`);
                agentTerminal.log(`Urgency: ${pitAnalysis.totalUrgency}/10 | Cliff: ${(currentCliff * 100).toFixed(1)}%`);
                agentTerminal.log(`Decision:   \x1b[35m${parsed.decision}\x1b[0m`);
                agentTerminal.log(`Confidence: \x1b[36m${(parsed.confidence * 100).toFixed(1)}%\x1b[0m`);

                agentTerminal.log(`Pit Impact: ${timeLossStr}`);
                agentTerminal.log(`Tire Choice: ${tireRec}`);
                agentTerminal.log(`Reasoning:`);
                wrapAndLog(agentTerminal, reasoning, 45);
                agentTerminal.log(`-----------------------------`);

                // Trust AI decisions: if it says BOX with reasonable confidence, execute pit stop
                if (parsed.decision === 'BOX' && parsed.confidence >= 0.65) {
                    executePitStop = true;
                    positionBeforePit = raceState.currentPosition;
                    agentTerminal.log(`✅ Executing pit stop (Confidence: ${(parsed.confidence * 100).toFixed(0)}%)`);
                } else if (parsed.decision === 'BOX' && parsed.confidence < 0.65 && pitAnalysis.totalUrgency > 5) {
                    // Execute pit if urgency is genuinely high, even with lower confidence
                    executePitStop = true;
                    positionBeforePit = raceState.currentPosition;
                    agentTerminal.log(`✅ Forced pit (Urgency critical: ${pitAnalysis.totalUrgency}/10)`);
                } else if (parsed.decision === 'BOX' && parsed.confidence < 0.65) {
                    agentTerminal.log(`⏳ BOX recommended but confidence low (${(parsed.confidence * 100).toFixed(0)}%) - STAYING OUT`);
                }
            } catch (err) {
                try {
                    const extractJson = responseContent.match(/\{[\s\S]*\}/)[0];
                    const parsedFallback = JSON.parse(extractJson);
                    const reasoningFallback = parsedFallback.reasoning || "No reasoning";

                    agentTerminal.log(``);
                    agentTerminal.log(`\x1b[4m>>> STRATEGY DECISION (Lap ${lap}) <<<\x1b[0m`);
                    agentTerminal.log(`Decision:   \x1b[35m${parsedFallback.decision}\x1b[0m`);
                    agentTerminal.log(`Confidence: \x1b[36m${(parsedFallback.confidence * 100).toFixed(1)}%\x1b[0m`);
                    agentTerminal.log(`Reasoning:`);
                    wrapAndLog(agentTerminal, reasoningFallback, 45);
                    agentTerminal.log(`-----------------------------`);

                    // Trust AI decisions in fallback too
                    if (parsedFallback.decision === 'BOX' && parsedFallback.confidence >= 0.65) {
                        executePitStop = true;
                        positionBeforePit = raceState.currentPosition;
                        agentTerminal.log(`✅ [FALLBACK] Executing pit stop (Confidence: ${(parsedFallback.confidence * 100).toFixed(0)}%)`);
                    } else if (parsedFallback.decision === 'BOX' && pitAnalysis.totalUrgency > 5) {
                        executePitStop = true;
                        positionBeforePit = raceState.currentPosition;
                    }
                } catch (fallbackErr) {
                    agentTerminal.log(`[Error parsing API response]: ${err.message}`);
                }
            }
            screen.render();
        }).catch(err => {
            agentTerminal.log(`[Mistral API Error]: ${err.message}`);
            screen.render();
        }).finally(() => {
            isAgentThinking = false;
        });
    }
}

function startRaceSimulation() {
    const telemetryStream = [];

    if (!fs.existsSync(CSV_FILE)) {
        console.error("CSV File not found: " + CSV_FILE);
        process.exit(1);
    }

    fs.createReadStream(CSV_FILE)
        .pipe(csv())
        .on('data', (row) => telemetryStream.push(row))
        .on('end', () => {
            telemetryLog.log('--- Telemetry Loaded. Starting Live Race Simulation ---');
            telemetryLog.log(`Starting Position: P${startingPosition}`);
            telemetryLog.log(`Starting Tire Compound: ${startingTireCompound}`);
            screen.render();

            const interval = setInterval(() => {
                if (currentLap >= telemetryStream.length) {
                    clearInterval(interval);
                    telemetryLog.log('--- Race Finished ---');
                    telemetryLog.log(`Final Pit Stops: ${pitStopCount}`);
                    telemetryLog.log(`Final Position: P${raceState.currentPosition}`);
                    telemetryLog.log('Press [ESC], [Q], or [CTRL-C] to exit.');
                    screen.render();
                    return;
                }

                const rawData = telemetryStream[currentLap];
                const actualLap = Math.round(parseFloat(rawData.LapNumber));
                const lapNumStr = actualLap.toString().padStart(2, '0');
                const degradationDelta = parseFloat(rawData.Degradation_Delta);

                // Simulate dynamic weather (changes every 5 laps)
                if (actualLap % 5 === 1) {
                    raceState.trackTemp = 20 + Math.random() * 40;
                    raceState.airTemp = 15 + Math.random() * 25;
                    raceState.humidity = 40 + Math.random() * 60;
                    // Only 15% chance of rain (less aggressive than before)
                    raceState.rainfall = Math.random() < 0.15 ? Math.random() * 3 : 0;
                }

                // Simulate position changes (±1 position randomly)
                if (Math.random() < 0.1) {
                    const posChange = Math.random() < 0.5 ? -1 : 1;
                    raceState.currentPosition = Math.max(1, Math.min(20, raceState.currentPosition + posChange));
                }

                // Simulate gap development
                raceState.gapToLeader += (Math.random() - 0.4) * 0.3;
                raceState.gapToLeader = Math.max(0, raceState.gapToLeader);

                // Update tire strategy info
                tireStrategy.updateCurrentStint(actualLap, state.x, raceState.currentPosition, `${raceState.trackTemp.toFixed(0)}°C`);
                lapsSinceLastPit++;

                // Handle pit stop and tire change
                if (executePitStop) {
                    pitStopCount++;
                    positionBeforePit = raceState.currentPosition;
                    previousTireCompound = currentTireCompound; // Save what we're coming off

                    // Calculate realistic position change from pit stop
                    const pitImpact = pitStopAnalyzer.estimatePositionLoss(raceState.currentPosition, actualLap);
                    const newPosition = pitImpact.newPosition;

                    // Intelligently choose next tire compound based on weather
                    const weather = weatherAnalyzer.analyzeWeatherImpact(
                        raceState.trackTemp, raceState.airTemp, raceState.humidity, raceState.rainfall
                    );

                    const tireChoices = {
                        'DRY': ['MEDIUM', 'HARD', 'SOFT'],
                        'INTERMEDIATE': ['INTERMEDIATE'],
                        'WET': ['WET', 'INTERMEDIATE'],
                        'EXTREME_WET': ['EXTREME_WET']
                    };

                    // Select new compound intelligently
                    let availableCompounds = tireChoices[weather.condition] || ['MEDIUM'];

                    // If previous stint was SOFT, prefer harder compounds next
                    if (previousTireCompound === 'SOFT' && weather.condition === 'DRY') {
                        availableCompounds = ['MEDIUM', 'HARD']; // Harder after SOFT
                    } else if (previousTireCompound === 'HARD' && weather.condition === 'DRY' && lapsSinceLastPit > 25) {
                        availableCompounds = ['SOFT', 'MEDIUM']; // Softer for grip if stint was long
                    }

                    // CRITICAL: Never pick the same compound (no point in changing tires to same compound)
                    availableCompounds = availableCompounds.filter(c => c !== previousTireCompound);
                    // If all options filtered out, fall back to preferred options excluding previous
                    if (availableCompounds.length === 0) {
                        availableCompounds = tireChoices[weather.condition].filter(c => c !== previousTireCompound) || ['HARD'];
                    }

                    const newCompound = availableCompounds[Math.floor(Math.random() * availableCompounds.length)];

                    // Record pit and update tire strategy
                    tireStrategy.pitAndChangeCompound(
                        actualLap,
                        newCompound,
                        newPosition,
                        state.x,
                        weather.condition
                    );

                    // Update position to post-pit position
                    raceState.currentPosition = newPosition;

                    // Reset tire degradation state after pit
                    state.x = 0.0;
                    state.P = 1.0;

                    // Update tire compound AFTER logging previous one
                    currentTireCompound = newCompound;

                    // Reset laps counter for new stint
                    lapsSinceLastPit = 0;

                    // Log pit stop with detailed analysis - showing ACTUAL tire change
                    telemetryLog.log('');
                    telemetryLog.log(`\x1b[33m╔════════════════════════════════════════╗\x1b[0m`);
                    telemetryLog.log(`\x1b[33m║   PIT STOP #${pitStopCount} (Lap ${actualLap})                    ║\x1b[0m`);
                    telemetryLog.log(`\x1b[33m╠════════════════════════════════════════╣\x1b[0m`);
                    telemetryLog.log(`\x1b[33m║ Position: P${positionBeforePit} → P${newPosition} (-${pitImpact.positionsLost} pos)  \x1b[0m`);
                    telemetryLog.log(`\x1b[33m║ Time Loss: ${pitImpact.timeLossSeconds}s                    \x1b[0m`);
                    telemetryLog.log(`\x1b[33m║ Tires: ${previousTireCompound.padEnd(8)} → ${newCompound.padEnd(8)}        \x1b[0m`);
                    telemetryLog.log(`\x1b[33m║ Weather: ${weather.condition.padEnd(12)} (${weather.gripLevel})   \x1b[0m`);
                    telemetryLog.log(`\x1b[33m║ Rainfall: ${weather.rainfall}mm                    \x1b[0m`);
                    telemetryLog.log(`\x1b[33m╚════════════════════════════════════════╝\x1b[0m`);
                    telemetryLog.log('');


                    executePitStop = false;
                }

                // Process Kalman filter with degradation
                if (!isNaN(degradationDelta)) {
                    // Apply tire age degradation multiplier
                    // Tires degrade faster as they age (cliff effect)
                    const degradationMultiplier = tireStrategy.getDegradationCurveMultiplier(lapsSinceLastPit, currentTireCompound);
                    const adjustedDegradationDelta = degradationDelta * degradationMultiplier;

                    // C++ Update with age-adjusted degradation
                    const result = kalmanMath.updateState(
                        state.x, state.P, state.Q, state.R, state.wear_rate, adjustedDegradationDelta
                    );

                    state.x = result.x;
                    state.P = result.P;

                    // ==========================================
                    // REALISTIC POSITION DYNAMICS (based on tire condition)
                    // ==========================================
                    const tireAgePercent = lapsSinceLastPit / tireStrategy.getMaxLaps(currentTireCompound);

                    // Calculate position change based on tire condition and cliff probability
                    let positionChange = 0;
                    if (tireAgePercent < 0.4) {
                        // Fresh tires: GAIN 1 position every 5-8 laps (better chance to overtake)
                        if (result.cliffProb < 0.6 && Math.random() < 0.20) {
                            positionChange = -1; // -1 = better position (lower number)
                        }
                    } else if (tireAgePercent > 0.8) {
                        // Degraded tires: Lose 1 position only in critical cliff (fair chance to defend)
                        if (result.cliffProb > 0.75 && Math.random() < 0.15) {
                            positionChange = 1; // +1 = worse position (higher number)
                        }
                    } else {
                        // Normal operation: balanced - gain if catching up, lose only in critical situations
                        if (raceState.gapToLeader < 0.5 && Math.random() < 0.12) {
                            positionChange = -1; // Catching up leader - gain position
                        } else if (result.cliffProb > 0.80 && Math.random() < 0.08) {
                            positionChange = 1; // Only lose in critical cliff (> 80%)
                        }
                    }

                    // Apply realistic position change
                    if (positionChange !== 0) {
                        raceState.currentPosition = Math.max(1, Math.min(20, raceState.currentPosition + positionChange));
                    }

                    // ==========================================
                    // REALISTIC GAP DEVELOPMENT
                    // ==========================================
                    // Gap should naturally decrease (we catch up) unless tires are critical
                    const baseGapChange = -0.03; // Natural gain (catching up)
                    const cliffPenalty = Math.max(0, (result.cliffProb - 0.65) * 0.15); // Only penalize if cliff > 65%
                    const tireAdvantage = tireAgePercent < 0.35 ? -0.08 : 0; // Fresh tires help close gap
                    const degradationPenalty = tireAgePercent > 0.90 ? 0.10 : 0; // Only late in stint (>90%)

                    raceState.gapToLeader += baseGapChange + cliffPenalty + tireAdvantage + degradationPenalty;
                    raceState.gapToLeader = Math.max(0, raceState.gapToLeader);

                    // Simulate driving intensity and fuel consumption
                    const drivingIntensity = result.cliffProb > 0.5 ? 'AGGRESSIVE' : 'NORMAL';
                    const fuelInfo = fuelStrategy.updateFuelLevel(actualLap, result.x, drivingIntensity);

                    // Log to telemetry window with pit stop relevant info
                    const lapDisplay = `Lap ${lapNumStr}`;
                    const tireDisplay = `${currentTireCompound}(L${lapsSinceLastPit})`;
                    const wearDisplay = `${result.x.toFixed(3)}s`;
                    const cliffDisplay = `${(result.cliffProb * 100).toFixed(0)}%`;
                    const fuelDisplay = `${fuelInfo.currentFuel}kg`;

                    const paceDisplay = `${(compoundPaceDelta + wearPenalty).toFixed(2)}s/l`;

                    telemetryLog.log(`${lapDisplay} | ${tireDisplay.padEnd(12)} | Pace: ${paceDisplay.padStart(6)} | Wear: ${wearDisplay} | Cliff: ${cliffDisplay} | Fuel: ${fuelDisplay}`);

                    // Update Chart Data
                    wearSeries.x.push(lapNumStr);
                    wearSeries.y.push(result.x * 100);

                    cliffSeries.x.push(lapNumStr);
                    cliffSeries.y.push(result.cliffProb * 100);

                    if (wearSeries.x.length > 20) {
                        wearSeries.x.shift();
                        wearSeries.y.shift();
                        cliffSeries.x.shift();
                        cliffSeries.y.shift();
                    }

                    lineChart.setData([wearSeries, cliffSeries]);

                    // Trigger AI decision
                    handleAiDecision(actualLap, result.x, result.P, result.cliffProb);

                    // Update all info displays
                    updateStrategyDisplay(actualLap);
                    updateWeatherDisplay();
                    updateFuelDisplay(actualLap);
                    updateCompetitiveDisplay();

                    // Update competitors
                    competitiveAnalysis.updateCompetitor('HAM', raceState.currentPosition, actualLap, currentTireCompound);

                    screen.render();
                }
                currentLap++;
            }, 1000); // 1 sec stream
        })
        .on('error', (err) => {
            console.error("Error reading CSV:", err);
            process.exit(1);
        });
}

startRaceSimulation();
