/**
 * Competitive Analysis Module
 * Analyzes competitor strategies and provides competitive advantage analysis
 */

class CompetitiveAnalysis {
  constructor() {
    this.driverStrategies = new Map();
    this.gridPositions = new Map();
  }

  updateCompetitor(driverCode, position, currentLap, tireCompound, laptimes = []) {
    if (!this.driverStrategies.has(driverCode)) {
      this.driverStrategies.set(driverCode, {
        code: driverCode,
        position,
        currentLap,
        tireCompound,
        pitstops: 0,
        avgLapTime: 0,
        gapToLeader: 0,
        strategy: 'UNKNOWN'
      });
    }

    const driverData = this.driverStrategies.get(driverCode);
    driverData.position = position;
    driverData.currentLap = currentLap;
    driverData.tireCompound = tireCompound;
    
    if (laptimes && laptimes.length > 0) {
      driverData.avgLapTime = this.calculateAvgLapTime(laptimes);
    }

    this.gridPositions.set(position, driverCode);
  }

  recordPitStop(driverCode) {
    if (this.driverStrategies.has(driverCode)) {
      this.driverStrategies.get(driverCode).pitstops++;
    }
  }

  analyzeCompetitiveAdvantage(myDriver, allCompetitors = []) {
    const myStrat = this.driverStrategies.get(myDriver);
    if (!myStrat) return null;

    const analysis = {
      myDriver: myDriver,
      myPosition: myStrat.position,
      timeGainOpportunity: 0,
      positionGainPotential: 0,
      risks: [],
      opportunities: [],
      competitorComparison: []
    };

    // Only analyze direct competitors (within 5 positions)
    for (let [code, data] of this.driverStrategies) {
      if (code !== myDriver) {
        const positionDiff = Math.abs(data.position - myStrat.position);
        
        if (positionDiff <= 5) {
          const comparison = {
            driver: code,
            position: data.position,
            positionDiff: data.position - myStrat.position,
            tireCompound: data.tireCompound,
            pitstops: data.pitstops,
            lapDiff: data.currentLap - myStrat.currentLap
          };

          analysis.competitorComparison.push(comparison);

          // Identify opportunities
          if (data.tireCompound === 'SOFT' && myStrat.tireCompound !== 'SOFT') {
            analysis.opportunities.push(`${code} on SOFT, degrades faster`);
          }

          if (data.pitstops > myStrat.pitstops + 1) {
            analysis.risks.push(`${code} may have different strategy (${data.pitstops} stops)`);
          }
        }
      }
    }

    return analysis;
  }

  getGridSummary() {
    const gridSummary = [];
    
    for (let i = 1; i <= 20; i++) {
      const driverCode = this.gridPositions.get(i);
      if (driverCode && this.driverStrategies.has(driverCode)) {
        const data = this.driverStrategies.get(driverCode);
        gridSummary.push({
          position: i,
          driver: driverCode,
          tireCompound: data.tireCompound,
          pitstops: data.pitstops,
          gaps: data.gapToLeader
        });
      }
    }

    return gridSummary;
  }

  calculateAvgLapTime(laptimes) {
    if (!laptimes || laptimes.length === 0) return 0;
    const sum = laptimes.reduce((a, b) => a + b, 0);
    return sum / laptimes.length;
  }

  compareStrategies(driver1, driver2) {
    const data1 = this.driverStrategies.get(driver1);
    const data2 = this.driverStrategies.get(driver2);

    if (!data1 || !data2) return null;

    return {
      driver1: {
        driver: driver1,
        pitstops: data1.pitstops,
        tireStrategy: data1.tireCompound
      },
      driver2: {
        driver: driver2,
        pitstops: data2.pitstops,
        tireStrategy: data2.tireCompound
      },
      stopDifference: Math.abs(data1.pitstops - data2.pitstops),
      timeGain: Math.abs((data1.avgLapTime || 0) - (data2.avgLapTime || 0))
    };
  }
}

module.exports = CompetitiveAnalysis;
