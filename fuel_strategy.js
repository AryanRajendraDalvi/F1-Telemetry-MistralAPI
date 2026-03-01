/**
 * Fuel Strategy Module
 * Manages fuel consumption and determines fuel-based pit strategy
 */

class FuelStrategy {
  constructor(totalFuelCapacity = 110, raceLength = 44) {
    this.totalFuel = totalFuelCapacity; // F1 max fuel is 110kg
    this.currentFuel = totalFuelCapacity;
    this.fuelConsumptionPerLap = 1.2; // kg/lap average
    this.raceLength = raceLength; // Total race laps
    this.fuelHistory = [];
    this.consumptionAdjustment = 1.0; // multiplier based on driving style
  }

  updateFuelLevel(lap, currentDegradation, drivingIntensity = 'NORMAL') {
    // Adjust consumption based on driving intensity
    const intensityMultiplier = {
      AGGRESSIVE: 1.3,
      NORMAL: 1.0,
      FUEL_SAVE: 0.75
    };

    const multiplier = intensityMultiplier[drivingIntensity] || 1.0;
    const consumption = (this.fuelConsumptionPerLap * multiplier) * (1 + currentDegradation / 100);

    this.currentFuel -= consumption;
    
    this.fuelHistory.push({
      lap,
      consumption,
      remaining: this.currentFuel,
      intensity: drivingIntensity
    });

    return {
      currentFuel: Math.max(0, this.currentFuel).toFixed(2),
      fuelRemaining: ((Math.max(0, this.currentFuel) / this.totalFuel) * 100).toFixed(1),
      consumption: consumption.toFixed(3),
      lapsUntilEmpty: (Math.max(0, this.currentFuel) / this.fuelConsumptionPerLap).toFixed(1),
      critical: this.currentFuel < 5,
      intensityMode: drivingIntensity
    };
  }

  canFinishRace(lapsRemaining) {
    const fuelNeeded = lapsRemaining * this.fuelConsumptionPerLap * 1.1; // 1.1 safety factor
    return this.currentFuel >= fuelNeeded;
  }

  recommendFuelSave(targetLaps) {
    const requiredConsumption = this.currentFuel / targetLaps;
    const currentAvgConsumption = this.getAverageConsumption();

    return {
      targetLaps,
      currentFuel: this.currentFuel.toFixed(2),
      requiredConsumption: requiredConsumption.toFixed(3),
      currentAvgConsumption: currentAvgConsumption.toFixed(3),
      needToSave: requiredConsumption < currentAvgConsumption,
      savingRequired: (currentAvgConsumption - requiredConsumption).toFixed(3),
      recommendation: requiredConsumption < currentAvgConsumption ? 'FUEL_SAVE_MODE' : 'NORMAL_PACE'
    };
  }

  getAverageConsumption() {
    if (this.fuelHistory.length === 0) return this.fuelConsumptionPerLap;
    const sum = this.fuelHistory.reduce((acc, entry) => acc + entry.consumption, 0);
    return sum / this.fuelHistory.length;
  }

  refuel(amount) {
    this.currentFuel = Math.min(this.totalFuel, this.currentFuel + amount);
    return {
      currentFuel: this.currentFuel.toFixed(2),
      percentage: ((this.currentFuel / this.totalFuel) * 100).toFixed(1)
    };
  }

  getFuelStatus() {
    return {
      totalCapacity: this.totalFuel,
      currentFuel: Math.max(0, this.currentFuel).toFixed(2),
      percentage: ((Math.max(0, this.currentFuel) / this.totalFuel) * 100).toFixed(1),
      avgConsumption: this.getAverageConsumption().toFixed(3),
      critical: this.currentFuel < 5,
      warning: this.currentFuel < 15
    };
  }

  getLapsRemaining(currentLap = 0) {
    // Calculate ACTUAL laps remaining based on race distance
    // Not theoretical laps the car could do on fuel alone
    if (this.raceLength && currentLap > 0) {
      const actualLapsRemaining = Math.max(0, this.raceLength - currentLap);
      return actualLapsRemaining;
    }
    
    // Fallback to fuel-based calculation if race distance unknown
    const baseConsumption = this.fuelConsumptionPerLap * 1.1; // Add 10% safety margin
    return Math.floor(Math.max(0, this.currentFuel) / baseConsumption);
  }
}

module.exports = FuelStrategy;
