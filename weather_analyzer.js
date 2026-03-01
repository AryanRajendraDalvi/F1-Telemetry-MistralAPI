/**
 * Weather Analyzer Module
 * Analyzes weather conditions and their impact on tire degradation
 */

class WeatherAnalyzer {
  constructor() {
    this.weatherFactors = {
      DRY: { degradationMultiplier: 1.0, gripLevel: 'HIGH', blisteringRisk: false },
      WET: { degradationMultiplier: 1.5, gripLevel: 'MEDIUM', blisteringRisk: false, aquaplaning: true },
      INTERMEDIATE: { degradationMultiplier: 1.2, gripLevel: 'MEDIUM-HIGH', blisteringRisk: false },
      EXTREME_WET: { degradationMultiplier: 2.0, gripLevel: 'LOW', blisteringRisk: false, aquaplaning: true }
    };
  }

  analyzeWeatherImpact(trackTemp, airTemp, humidity, rainfall) {
    let condition = 'DRY';
    let riskFactors = [];

    // Determine weather condition STRICTLY
    if (rainfall > 0.5) {
      // Significant rain detected
      condition = rainfall > 2 ? 'EXTREME_WET' : 'WET';
    } else if (rainfall > 0.1 && rainfall <= 0.5) {
      // Light rain/sprinkles = INTERMEDIATE conditions
      condition = 'INTERMEDIATE';
    }
    // Only DRY if no rain, even if humidity is high and track temp is low
    // High humidity + cool track in dry weather is normal for European circuits

    const factors = this.weatherFactors[condition];
    
    // Check for blistering (overheating) - only in dry conditions
    if (trackTemp > 60 && condition === 'DRY') {
      riskFactors.push('BLISTERING_RISK');
      factors.blisteringRisk = true;
    }
    
    // Check for overheating on tight tracks
    if (trackTemp > 65) {
      riskFactors.push('EXTREME_HEAT');
    }

    // Check for cold tires
    if (trackTemp < 15) {
      riskFactors.push('COLD_TIRES');
    }

    return {
      condition,
      trackTemp: trackTemp.toFixed(1),
      airTemp: airTemp.toFixed(1),
      humidity: humidity.toFixed(1),
      rainfall: rainfall.toFixed(2),
      degradationMultiplier: factors.degradationMultiplier,
      gripLevel: factors.gripLevel,
      blisteringRisk: factors.blisteringRisk,
      aquaplaning: factors.aquaplaning || false,
      riskFactors,
      recommendedTireCompound: this.getTireRecommendation(condition)
    };
  }

  getTireRecommendation(condition) {
    const tireMap = {
      DRY: 'SOFT/MEDIUM',
      INTERMEDIATE: 'INTERMEDIATE',
      WET: 'WET',
      EXTREME_WET: 'EXTREME_WET'
    };
    return tireMap[condition];
  }

  getGripLevel(weatherCondition) {
    return this.weatherFactors[weatherCondition].gripLevel;
  }
}

module.exports = WeatherAnalyzer;
