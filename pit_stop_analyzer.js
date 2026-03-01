/**
 * Pit Stop Analyzer Module
 * Calculates realistic pit stop timing and position changes
 */

class PitStopAnalyzer {
  constructor(trackLength = 7.0) {
    this.trackLength = trackLength; // km (Belgian GP ~7km)
    this.pitLaneLength = 0.400; // km (typical pit lane ~400m)
    this.avgLapTime = 190; // seconds (typical F1 lap)
    this.pitStopDuration = 24; // seconds (modern F1 pit stop: tires + fuel + adjustments)
  }

  /**
   * Calculate realistic pit stop time loss
   * Based on lap time and pit stop duration
   */
  calculateTimeLoss(avgLapTime = this.avgLapTime) {
    return this.pitStopDuration + (this.pitLaneLength / this.trackLength) * avgLapTime;
  }

  /**
   * Estimate positions lost due to pit stop
   * Considers current position and field compression
   */
  estimatePositionLoss(currentPosition, lap, raceLength = 300) {
    // Earlier in race = positions spread out = more position loss
    // Later in race = positions compressed = less position loss
    const raceProgress = lap / raceLength;
    const spreadFactor = 1 - (raceProgress * 0.5); // 100% early, 50% late
    
    // Calculate time loss to positions lost conversion
    const timeLossSeconds = this.pitStopDuration;
    const avgLapSeconds = this.avgLapTime;
    
    // Every ~2-3 seconds of time loss = 1 position loss
    let positionsLost = Math.ceil(timeLossSeconds / (avgLapSeconds * 0.15)) * spreadFactor;
    
    // Cap based on position (can't lose more positions than behind you)
    positionsLost = Math.max(1, Math.min(positionsLost, currentPosition - 1));
    
    // Add variance (±0.5 positions)
    const variance = (Math.random() - 0.5) * 1;
    positionsLost = Math.max(1, positionsLost + variance);
    
    return {
      timeLossSeconds: timeLossSeconds,
      positionsLost: Math.round(positionsLost),
      newPosition: currentPosition + Math.round(positionsLost),
      detail: `Pit stop loses ~${timeLossSeconds}s (${Math.round(positionsLost)} positions)`
    };
  }

  /**
   * Estimate position gain/recovery after pit stop
   * Fresh tires allow faster pace vs degraded opponents
   */
  estimatePositionRecovery(currentPosition, lapsAfterPit, tireCompound, competitorTires) {
    // Fresh tires are typically 0.5-1.0s faster per lap than worn tires
    const tireAdvantagePerLap = 0.7; // seconds/lap
    const avgLapTime = this.avgLapTime;
    
    // Maximum positions that can be gained
    const maxGainPerLap = (tireAdvantagePerLap / avgLapTime) * 20; // scale to position changes
    
    // Can only gain on cars ahead
    const availablePositionsToGain = currentPosition - 1;
    const positionGain = Math.min(
      maxGainPerLap * lapsAfterPit,
      availablePositionsToGain
    );
    
    return {
      lapsAnalyzed: lapsAfterPit,
      estimatedPositionGain: positionGain,
      tireAdvantage: tireAdvantagePerLap,
      finalPosition: Math.max(1, currentPosition - Math.round(positionGain))
    };
  }

  /**
   * Determine optimal pit stop window
   * When cliff probability reaches critical threshold
   */
  determineOptimalPitWindow(currentLap, currentCliffProb, lapsSinceLastPit, tireAge = 0, maxTireAge = 25) {
    const criticalCliff = 0.75;
    const warningCliff = 0.65;
    
    // TIRE AGE CRITICAL: If near end of tire life, pit immediately
    if (tireAge >= maxTireAge * 0.95) {
      return {
        recommendation: 'PIT_IMMEDIATELY',
        urgency: 'CRITICAL',
        lapsToGo: 0,
        reason: 'Tire age at critical limit - immediate pit required'
      };
    }
    
    // Already at critical level = PIT NOW
    if (currentCliffProb >= criticalCliff) {
      return {
        recommendation: 'PIT_IMMEDIATELY',
        urgency: 'CRITICAL',
        lapsToGo: 0,
        reason: 'Tires at critical degradation level'
      };
    }
    
    // At warning level = pit within 2 laps
    if (currentCliffProb >= warningCliff) {
      return {
        recommendation: 'PIT_SOON',
        urgency: 'HIGH',
        lapsToGo: 1,
        reason: 'Tires approaching cliff, pit in next lap'
      };
    }
    
    // Safe zone but track usage
    if (lapsSinceLastPit > 20 && currentCliffProb > 0.50) {
      return {
        recommendation: 'CONSIDER_PIT',
        urgency: 'MEDIUM',
        lapsToGo: 2,
        reason: 'Tires degrading, consider strategic pit'
      };
    }
    
    // Fresh tires, stay out
    return {
      recommendation: 'STAY_OUT',
      urgency: 'LOW',
      lapsToGo: 5,
      reason: 'Tires fresh, extend current stint'
    };
  }

  /**
   * Strategic pit window analysis
   * Consider fuel, weather, position relative to field, and TIRE AGE
   */
  analyzePitStrategy(currentState) {
    const {
      lap,
      currentPosition,
      gapToLeader,
      cliffProb,
      fuel,
      fuelPerLap,
      weather,
      lapsSincePit,
      tireAge = 0,        // New: current tire age in laps
      maxTireAge = 25     // New: max lifespan for current compound
    } = currentState;
    
    const analysis = {
      shouldPit: false,
      reason: [],
      tireUrgency: 0, // 0-10 scale
      fuelUrgency: 0,
      strategyUrgency: 0
    };
    
    // TIRE AGE URGENCY (0-10) - NEW CRITICAL FACTOR
    const tireAgePercent = tireAge / maxTireAge;
    if (tireAgePercent >= 0.95) {
      analysis.tireUrgency = 10;
      analysis.reason.push('CRITICAL: Tire at maximum age limit');
      analysis.shouldPit = true;
    } else if (tireAgePercent >= 0.85) {
      analysis.tireUrgency = 9;
      analysis.reason.push('CRITICAL: Tire age 85%+ of lifespan');
      analysis.shouldPit = true;
    } else if (tireAgePercent >= 0.75) {
      analysis.tireUrgency = 7;
      analysis.reason.push('HIGH: Tire approaching age limit');
    } else if (tireAgePercent >= 0.60) {
      analysis.tireUrgency = 4;
      analysis.reason.push('MEDIUM: Tire halfway through lifespan');
    } else {
      analysis.tireUrgency = Math.round(cliffProb * 5); // Scale cliff prob to 0-5 range when tires fresh
    }
    
    // CLIFF PROBABILITY URGENCY (0-10)
    if (cliffProb > 0.75) {
      analysis.tireUrgency = Math.max(analysis.tireUrgency, 10);
      analysis.reason.push('CRITICAL: Tires at cliff');
      analysis.shouldPit = true;
    } else if (cliffProb > 0.65) {
      analysis.tireUrgency = Math.max(analysis.tireUrgency, 7);
      analysis.reason.push('HIGH: Tires degrading rapidly');
    } else if (cliffProb > 0.50) {
      analysis.tireUrgency = Math.max(analysis.tireUrgency, 4);
      analysis.reason.push('MEDIUM: Tires wearing');
    }
    
    // FUEL URGENCY (0-10)
    const lapsRemaining = Math.ceil(fuel / fuelPerLap);
    if (lapsRemaining < 5) {
      analysis.fuelUrgency = 10;
      analysis.reason.push('CRITICAL: Fuel critically low');
      analysis.shouldPit = true;
    } else if (lapsRemaining < 10) {
      analysis.fuelUrgency = 6;
      analysis.reason.push('HIGH: Must pit for fuel soon');
    } else {
      analysis.fuelUrgency = 1;
    }
    
    // STRATEGY URGENCY (0-10) based on position
    if (currentPosition > 10 && cliffProb > 0.50 && lapsSincePit > 15) {
      analysis.strategyUrgency = 6;
      analysis.reason.push('MEDIUM: Use pit to change tire strategy');
    } else if (weather === 'WET' || weather === 'INTERMEDIATE') {
      analysis.strategyUrgency = 5;
      analysis.reason.push('MEDIUM: Weather changing - consider fresh tires');
    } else {
      analysis.strategyUrgency = 1;
    }
    
    // Combined urgency - weighted more toward tire age now
    const totalUrgency = (analysis.tireUrgency * 1.5 + analysis.fuelUrgency + analysis.strategyUrgency) / 3.5;
    
    return {
      ...analysis,
      totalUrgency: Math.round(totalUrgency),
      decision: analysis.shouldPit ? 'BOX' : 'STAY'
    };
  }
}

module.exports = PitStopAnalyzer;
