import moment from 'moment'



const LEADERBOARD_STATS = [
  'distance',
  'elapsedTimeSecs',
  'elevationGain',
]

const LEADERBOARD_TIME_PERIODS = [
  'week',
  'month',
  'year',
]

export function calcLeaderboards (rideSummaries, leaderboardOptOuts) {
  // If you make these calls on the same moment() object you get
  // whacky results. Bug?
  const startOfWeek = moment().startOf('week')
  const startOfMonth = moment().startOf('month')
  const startOfYear = moment().startOf('year')

  const timePeriods = {
    week: startOfWeek,
    month: startOfMonth,
    year: startOfYear,
  }

  const leaderAccum = LEADERBOARD_TIME_PERIODS.reduce((a, t) => {
    a[t] = {}
    return a
  }, {})

  for (let ride of Object.values(rideSummaries)) {
    if (ride.isPublic && ride.riderHorseID && ride.distance > 0 && !leaderboardOptOuts[ride.userID]) {
      for (let timePeriod of Object.keys(timePeriods)) {
        if (moment(ride.startTime) > timePeriods[timePeriod]) {
          if (!leaderAccum[timePeriod][ride.userID]) {
            leaderAccum[timePeriod][ride.userID] = {}
          }
          if (!leaderAccum[timePeriod][ride.userID][ride.riderHorseID]) {
            leaderAccum[timePeriod][ride.userID][ride.riderHorseID] = {
              distance: 0,
              elapsedTimeSecs: 0,
              elevationGain: 0
            }
          }
          for (let stat of LEADERBOARD_STATS) {
            leaderAccum[timePeriod][ride.userID][ride.riderHorseID][stat] += ride[stat]
          }
        }
      }
    }
  }

  const LEADERBOARD_DEPTH = 50
  const ranked = LEADERBOARD_TIME_PERIODS.reduce((a, t) => {
    a[t] = {}
    return a
  }, {})
  for (let timeCat of Object.keys(ranked)) {
    for (let stat of LEADERBOARD_STATS) {
      if (!ranked[timeCat][stat]) {
        ranked[timeCat][stat] = []
      }

      for (let riderID of Object.keys(leaderAccum[timeCat])) {
        for (let horseID of Object.keys(leaderAccum[timeCat][riderID])) {

          const newStat = {
            riderID,
            horseID,
          }
          newStat[stat] = leaderAccum[timeCat][riderID][horseID][stat]
          ranked[timeCat][stat].push(newStat)
        }
      }
      ranked[timeCat][stat].sort((a, b) => {return b[stat] - a[stat]})
      ranked[timeCat][stat] = ranked[timeCat][stat].slice(0, LEADERBOARD_DEPTH)
    }
  }

  return {
    _id: `leaderboards`,
    type: 'leaderboards',
    values: ranked
  }
}

export function summarizeRides (couchService, rideIDs) {
  return new Promise((resolve, reject) => {
    const rideSummaries = {}
    const ridesPerHorse = {}
    const horselessRidesPerUserID = {}

    // Fetch all the rides, rideHorses, and rideElevations in the DB
    couchService.getAllRides(rideIDs).then(rides => {
      for (let record of rides.rows) {
        if (!horselessRidesPerUserID[record.doc.userID]) {
          // All rides start out horseless until we find the rideHorse records
          horselessRidesPerUserID[record.doc.userID] = []
        }

        if (!rideSummaries[record.key]) {
          // Make sure we have a place to store accumulated information about each ride.
          rideSummaries[record.key] = {}
        }
        if (record.doc.type === 'rideHorse') {
          if (!ridesPerHorse[record.doc.horseID]) {
            ridesPerHorse[record.doc.horseID] = []
          }

          // If the horses rides are not yet linked to the the ride referenced by the document
          if (ridesPerHorse[record.doc.horseID].indexOf(rideSummaries[record.key]) < 0) {

            // Save the horses ID to the ride record
            if (!rideSummaries[record.key].horseIDs) {
              rideSummaries[record.key].horseIDs = []
            }
            if (rideSummaries[record.key].horseIDs.indexOf(record.doc.horseID) < 0) {
              rideSummaries[record.key].horseIDs.push(record.doc.horseID)
            }
            if (record.doc.rideHorseType === 'rider') {
              rideSummaries[record.key].riderHorseID = record.doc.horseID
            }

            // We are going to end up with rides duplicated to different users
            // because we are showing all the users all the rides on all the
            // horses in their barn. Push the new reference to the ride into
            // ridesPerHorse so we can find it later.
            if (record.doc.horseID && ridesPerHorse[record.doc.horseID].indexOf() < 0) {
              ridesPerHorse[record.doc.horseID].push(rideSummaries[record.key])
              const foundHorseIndex = horselessRidesPerUserID[record.doc.userID].indexOf(rideSummaries[record.key])
              if (foundHorseIndex) {
                // We found a rideHorse for this ride, remove it from horselessRides
                delete horselessRidesPerUserID[record.doc.userID][foundHorseIndex]
              }
            } else {
              // This record has no horseID, it might be a ride with no horse if we
              // don't find any rideHorse later in the process.
              horselessRidesPerUserID[record.doc.userID].push(rideSummaries[record.key])
            }
          }
        }

        if (record.doc.type === 'ride') {
          rideSummaries[record.key].rideID = record.key
          rideSummaries[record.key].elapsedTimeSecs = record.doc.elapsedTimeSecs
          rideSummaries[record.key].startTime = record.doc.startTime
          rideSummaries[record.key].distance = record.doc.distance
          rideSummaries[record.key].userID = record.doc.userID
          rideSummaries[record.key].deleted = record.doc.deleted
          rideSummaries[record.key].isPublic = record.doc.isPublic
        } else if (record.doc.type === 'rideElevations') {
          rideSummaries[record.key].elevationGain = record.doc.elevationGain
        }
      }
    }).then(() => {
      resolve({
        rideSummaries,
        ridesPerHorse,
        horselessRidesPerUserID
      })
    }).catch(e => {
      reject(e)
    })
  })
}