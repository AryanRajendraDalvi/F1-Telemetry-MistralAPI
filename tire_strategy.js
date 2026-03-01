/**
 * Tire Strategy Module
 * Tracks tire compounds, pit stops, and stint management
 */

class TireStrategy {
  constructor(driverName, startingCompound = null, startingPosition = 1) {
    this.driverName = driverName;
    this.stints = [];
    
    // Randomize starting tire if not specified (50% SOFT, 30% MEDIUM, 20% HARD in DRY)
    const startCompound = startingCompound || this.getRandomStartingCompound();
    
    this.currentStint = {
      stintNumber: 1,
      startLap: 1,
      tireCompound: startCompound,
      startPosition: startingPosition,
      weatherAtStart: 'DRY',
      lapsCompleted: 0,
      maxExpectedLaps: this.getMaxLaps(startCompound),
      degradationAtStart: 0,
      ageRelativeToPeak: 0
    };
  }

  /**
   * Randomly select starting tire (realistic F1 strategy)
   * Returns: 50% SOFT, 30% MEDIUM, 20% HARD
   */
  getRandomStartingCompound() {
    const roll = Math.random();
    if (roll < 0.50) return 'SOFT';
    if (roll < 0.80) return 'MEDIUM';
    return 'HARD';
  }

  getMaxLaps(compound) {
    // Realistic tire lifetimes based on actual F1 compound characteristics
    const maxLapsMap = {
      SOFT: 18,      // Softest, least durable - 15-20 laps
      MEDIUM: 28,    // Mid compound - 25-30 laps
      HARD: 40,      // Hardest - 35-45 laps
      WET: 35,       // Wet weather - variable
      INTERMEDIATE: 30, // Between wet and dry
      EXTREME_WET: 25   // Heavy rain - aggressive wear
    };
    return maxLapsMap[compound] || 20;
  }

  /**
   * Get tire degradation curve multiplier based on lap age
   * Later laps in a stint have steeper degradation (cliff effect)
   * Returns a multiplier: 1.0 = normal, 2.0+ = cliff happening
   */
  getDegradationCurveMultiplier(currentLap, compound) {
    const maxLaps = this.getMaxLaps(compound);
    const percentageOfLife = currentLap / maxLaps;
    
    if (percentageOfLife < 0.3) return 1.0;      // Fresh tires, minimal wear
    if (percentageOfLife < 0.6) return 1.3;      // Linear wear phase
    if (percentageOfLife < 0.85) return 1.8;     // Entering degradation zone
    if (percentageOfLife < 0.95) return 2.5;     // Significant cliff
    return 4.0;                                   // Critical failure zone
  }

  /**
   * Determine if a pit stop is MANDATORY based on tire age
   * Returns true only if tire has exceeded safe operating window (99% - only true failures)
   */
  isPitStopMandatory(lapsCompleted, compound) {
    const maxLaps = this.getMaxLaps(compound);
    const criticalPercent = 0.99; // Only force pit at 99% - true tire failure imminent
    return lapsCompleted >= (maxLaps * criticalPercent);
  }

  /**
   * Get warning status when approaching tire limit
   * Returns: 'FRESH' | 'NORMAL' | 'WARNING' | 'CRITICAL' | 'MANDATORY'
   */
  getTireWearStatus(lapsCompleted, compound) {
    const maxLaps = this.getMaxLaps(compound);
    const percent = lapsCompleted / maxLaps;
    
    if (percent < 0.5) return 'FRESH';
    if (percent < 0.75) return 'NORMAL';
    if (percent < 0.85) return 'WARNING';
    if (percent < 0.95) return 'CRITICAL';
    return 'MANDATORY';
  }

  updateCurrentStint(currentLap, currentDegradation, currentPosition, weatherCondition) {
    const lapsInCurrentStint = currentLap - this.currentStint.startLap + 1;
    this.currentStint.lapsCompleted = lapsInCurrentStint;
    this.currentStint.currentDegradation = currentDegradation;
    this.currentStint.currentPosition = currentPosition;
    this.currentStint.weatherAtStart = weatherCondition;
    
    // Calculate age relative to peak performance
    const maxLaps = this.getMaxLaps(this.currentStint.tireCompound);
    this.currentStint.ageRelativeToPeak = Math.min(lapsInCurrentStint / maxLaps, 1.0);
    
    // Calculate effective degradation with tire age multiplier
    const curveMult = this.getDegradationCurveMultiplier(lapsInCurrentStint, this.currentStint.tireCompound);
    this.currentStint.effectiveDegradation = currentDegradation * curveMult;
    
    // Track wear status for pit decision
    this.currentStint.wearStatus = this.getTireWearStatus(lapsInCurrentStint, this.currentStint.tireCompound);
  }

  pitAndChangeCompound(lap, newCompound, newPosition, currentDegradation, weatherCondition) {
    // Save current stint
    this.currentStint.lapsCompleted = lap - this.currentStint.startLap;
    this.currentStint.endDegradation = currentDegradation;
    this.currentStint.endPosition = newPosition;
    this.stints.push({ ...this.currentStint });

    // Start new stint
    this.currentStint = {
      stintNumber: this.stints.length + 1,
      startLap: lap + 1,
      tireCompound: newCompound,
      startPosition: newPosition,
      weatherAtStart: weatherCondition,
      lapsCompleted: 0,
      maxExpectedLaps: this.getMaxLaps(newCompound),
      degradationAtStart: 0
    };

    return {
      stintHistory: this.stints,
      currentStint: this.currentStint
    };
  }

  getStrategyAnalysis() {
    return {
      driverName: this.driverName,
      totalStints: this.stints.length + 1,
      stints: [...this.stints, this.currentStint],
      riskAssessment: this.assessStrategy(),
      currentStint: this.currentStint
    };
  }

  assessStrategy() {
    if (this.stints.length > 3) return 'AGGRESSIVE (4+ stops)';
    if (this.stints.length === 0) return 'ONE-STOP (or still on first stint)';
    if (this.stints.length === 1) return 'TWO-STOP';
    if (this.stints.length === 2) return 'THREE-STOP';
    return 'BALANCED';
  }

  getStintSummary(indexOrCurrent = 'current') {
    const stint = indexOrCurrent === 'current' ? this.currentStint : this.stints[indexOrCurrent];
    if (!stint) return null;

    return {
      num: stint.stintNumber,
      compound: stint.tireCompound,
      laps: stint.lapsCompleted,
      startPos: stint.startPosition,
      endPos: stint.endPosition || 'Active',
      weather: stint.weatherAtStart
    };
  }

  getAllStintsSummary() {
    const completed = this.stints.map((s, idx) => ({
      num: s.stintNumber,
      compound: s.tireCompound,
      laps: s.lapsCompleted,
      startPos: s.startPosition,
      endPos: s.endPosition,
      weather: s.weatherAtStart
    }));

    return completed;
  }
}

module.exports = TireStrategy;
