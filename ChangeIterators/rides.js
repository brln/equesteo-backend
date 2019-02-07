import moment from 'moment'
import gcm from 'node-gcm'
import * as Sentry from '@sentry/node'

import { HORSES_DB, HORSES_DESIGN_DOC } from "../design_docs/horses"
import { RIDES_DB, RIDES_DESIGN_DOC } from "../design_docs/rides"
import { USERS_DB, USERS_DESIGN_DOC } from "../design_docs/users"
import { unixTimeNow } from '../helpers'
import {calcLeaderboards, summarizeRides} from './helpers'
import { configGet, COUCH_USERNAME, COUCH_PASSWORD, COUCH_HOST } from '../config'
import CouchService from '../services/Couch'

const TABLE_NAME = 'equesteo_fcm_tokens'

const couchService = new CouchService(
  configGet(COUCH_USERNAME),
  configGet(COUCH_PASSWORD),
  configGet(COUCH_HOST)
)

export default function startRideChangeIterator(slouch, gcmClient, ddbService) {
  let iterator = slouch.db.changes('rides', {
    include_docs: true,
    feed: 'continuous',
    heartbeat: true,
    since: 'now'
  })

  calcTrainingRecords(slouch)
  iterator.each((rideRecord) => {
    console.log('ride change iterator running')

    newRideNotification(rideRecord, slouch, gcmClient, ddbService)
    newCommentNotification(rideRecord, slouch, gcmClient, ddbService)
    newCarrotNotification(rideRecord, slouch, gcmClient, ddbService)
    recalcTrainingRecords(rideRecord, slouch)
  })
}

const trainingCache = {}
const cacheRefs = {}
class TrainingCache {
  static check(training) {
    if (!trainingCache[training.doc._id]) {
      trainingCache[training.doc._id] = training
      cacheRefs[training.doc._id] = 0
    }
    cacheRefs[training.doc._id] = cacheRefs[training.doc._id] + 1
    return trainingCache[training.doc._id]
  }

  static updateOrInvalidate(training) {
    if (cacheRefs[training.doc._id] === 1) {
      delete trainingCache[training.doc._id]
      delete cacheRefs[training.doc._id]
    } else if (cacheRefs[training.doc._id] > 1) {
      cacheRefs[training.doc._id] = cacheRefs[training.doc._id] - 1
    }
  }
}

function recalcTrainingRecords(rideRecord, slouch) {
  // If there is a new ride
  let leaderboardRecalc = false
  if (rideRecord.doc && rideRecord.doc.type === 'ride'
      && rideRecord.doc._rev.split('-')[0] === '1'
      && rideRecord.doc.isPublic === true) {
    console.log('new ride training recalc')
    leaderboardRecalc = true
    const rideID = rideRecord.doc._id
    const userID = rideRecord.doc.userID

    // Find all the horses that went on that ride
    const horseIDs = []
    const userIDs = [userID]
    slouch.db.view(RIDES_DB, RIDES_DESIGN_DOC, 'rideHorsesByRide', {include_docs: true, key: `"${rideID}"`}).each((rideHorse) => {
      horseIDs.push(rideHorse.doc.horseID)
    }).then(() => {

      // And all the users that ride those horses
      const jsonHorseIDs = JSON.stringify(horseIDs)
      return slouch.db.view(HORSES_DB, HORSES_DESIGN_DOC, 'horseUsersByHorseID', {include_docs: true, keys: jsonHorseIDs}).each(horseUser => {
        if (userIDs.indexOf(horseUser.doc.userID) < 0) {
          userIDs.push(horseUser.doc.userID)
        }
      })
    }).then(() => {
      return slouch.doc.get(RIDES_DB, `${rideRecord.doc._id}_elevations`)
    }).then((elevations) => {

      // And add the new ride to their training records
      const newRec = {
        rideID: rideRecord.doc._id,
        elapsedTimeSecs: rideRecord.doc.elapsedTimeSecs,
        startTime: rideRecord.doc.startTime,
        distance: rideRecord.doc.distance,
        userID: userID,
        elevationGain: elevations.elevationGain,
        horseIDs,
      }
      const jsonUserIDs = JSON.stringify(userIDs)
      return slouch.db.view(USERS_DB, USERS_DESIGN_DOC, 'trainingsByUserID', {include_docs: true, keys: jsonUserIDs}).each(training => {
        training = TrainingCache.check(training)
        training.doc.rides.push(newRec)
        console.log('saving training from new ride')
        return slouch.doc.upsert(USERS_DB, training.doc).then(() => {
          TrainingCache.updateOrInvalidate(training)
        })
      }).then(() => {
        console.log('new ride training record update complete')
      }).catch(e => {
        console.log(e)
      })
    })

    // If this is an old ride that was edited.
  } else if (rideRecord.doc && rideRecord.doc.type === 'ride'
    && parseInt(rideRecord.doc._rev.split('-')[0]) > 1
    && rideRecord.doc.isPublic === true) {
    console.log('ride update training recalc')
    leaderboardRecalc = true
    const key = `"${rideRecord.doc._id}"`

    slouch.doc.get(RIDES_DB, `${rideRecord.doc._id}_elevations`).then(elevations => {

      // Find all the trainings records that have that ride and update them
      // to reflect the new data.
      slouch.db.view(USERS_DB, USERS_DESIGN_DOC, 'trainingsByRideID', {include_docs: true, key}).each(training => {
        training = TrainingCache.check(training)
        const ride = training.doc.rides[training.value]
        ride.elapsedTimeSecs = rideRecord.doc.elapsedTimeSecs
        ride.startTime = rideRecord.doc.startTime
        ride.distance = rideRecord.doc.distance
        ride.deleted = rideRecord.doc.deleted
        ride.elevationGain = elevations.elevationGain
        console.log('saving training from ride update')
        return slouch.doc.upsert(USERS_DB, training.doc).then(() => {
          TrainingCache.updateOrInvalidate(training)
        })
      })
    }).then(() => {
      console.log('update ride training record update complete')
    }).catch(e => {
      console.log(e)
    })

    // If someone has created or edited a ride horse
  } else if (rideRecord.doc && rideRecord.doc.type === 'rideHorse') {
    console.log('ride horse training recalc')
    leaderboardRecalc = true
    const key = `"${rideRecord.doc.rideID}"`
      // Find all the users who have a record of that ride on their training
    return slouch.db.view(USERS_DB, USERS_DESIGN_DOC, 'trainingsByRideID', {include_docs: true, key}).each(training => {
      training = TrainingCache.check(training)
      // And update the horseIDs to show the change
      const horseID = rideRecord.doc.horseID
      const rideHorses = training.doc.rides[training.value].horseIDs
      const foundHorseIndex = rideHorses.indexOf(horseID)
      if (rideRecord.doc.deleted && foundHorseIndex >= 0) {
        rideHorses.splice(foundHorseIndex, 1)
      } else if (rideRecord.doc.deleted !== true && foundHorseIndex < 0) {
        rideHorses.push(horseID)
      }

      console.log('saving training from rideHorse')
      return slouch.doc.upsert(USERS_DB, training.doc).then(() => {
        TrainingCache.updateOrInvalidate(training)
      })
    }).then(() => {
      console.log('rideHorse update to training record complete')
    }).catch(e => {
      console.log(e)
    })
  }

  if (leaderboardRecalc) {
    const rideIDs = []
    let optOuts = null
    slouch.db.view(RIDES_DB, RIDES_DESIGN_DOC, 'ridesByStartTime', {startkey: moment().startOf('year').valueOf()}).each((ride) => {
      rideIDs.push(ride.id)
    }).then(() => {
      return couchService.getLeaderboardOptOutUsers()
    }).then(_optOuts => {
      optOuts = _optOuts.rows.reduce((a, o) => {
        a[o.key] = true
        return a
      }, {})
      return summarizeRides(couchService, rideIDs)
    }).then(({ rideSummaries }) => {
      const leaderboardRecord = calcLeaderboards(rideSummaries, optOuts)
      return slouch.doc.upsert(USERS_DB, leaderboardRecord)
    }).then(() => {
      console.log('leaderboards updated')
    })
  }
}

function calcTrainingRecords (slouch) {
  const users = {}
  const leaderboardOptOuts = {}
  slouch.db.view(USERS_DB, USERS_DESIGN_DOC, 'byID', { include_docs: true }).each(user => {
    // Fetch all users and the horses they have in their barn
    users[user.id] = []
    if (user.doc.leaderboardOptOut) {
      leaderboardOptOuts[user.id] = true
    }
    return slouch.db.view(HORSES_DB, HORSES_DESIGN_DOC, 'horseUsersByUserID', {include_docs: true, key: `"${user.id}"`}).each(horseUser => {
      users[user.id].push(horseUser.doc.horseID)
    })
  }).then(() => {
    summarizeRides(couchService).then(({ ridesPerHorse, rideSummaries, horselessRidesPerUserID }) => {
      const allUpdates = []
      for (let userID of Object.keys(users)) {
        // Go through all the users, and replace their horses IDs
        // with their horses rides.
        let rides = users[userID].reduce((accum, horseID) => {
          if (ridesPerHorse[horseID]) {
            for (let ride of ridesPerHorse[horseID]) {
              if (accum.indexOf(ride) < 0) {
                accum.push(ride)
              }
            }
          }
          return accum
        }, [])

        if (horselessRidesPerUserID[userID] && horselessRidesPerUserID[userID].length) {
          rides = rides.concat(horselessRidesPerUserID[userID])
        }

        // And save everyone's new training records.
        const trainingRecord = {
          _id: `${userID}_training`,
          rides,
          userID: userID,
          lastUpdate: unixTimeNow(),
          type: 'training'
        }
        allUpdates.push(
          slouch.doc.upsert(USERS_DB, trainingRecord)
        )
      }
      const leaderboardRecord = calcLeaderboards(rideSummaries, leaderboardOptOuts)
      allUpdates.push(
        slouch.doc.upsert(USERS_DB, leaderboardRecord)
      )

      return Promise.all(allUpdates)
    }).then(() => {
      console.log('training record initial generation complete')
    }).catch(e => {
      console.log(e)
    })
  })
}

function newCarrotNotification(carrotRecord, slouch, gcmClient, ddbService) {
  if (carrotRecord.doc && carrotRecord.doc.type === 'carrot'
    && carrotRecord.doc._rev.split('-')[0] === '1') {
      slouch.doc.get(RIDES_DB, carrotRecord.doc.rideID, {include_docs: true}).then(ride => {
        if (carrotRecord.doc.userID !== ride.userID) {
          Promise.all([
            slouch.doc.get(USERS_DB, ride.userID),
            slouch.doc.get(USERS_DB, carrotRecord.doc.userID)
          ]).then(([rideUser, carrotUser]) => {
            ddbService.getItem(TABLE_NAME, {id: {S: rideUser._id}}).then(ddbUser => {
              if (ddbUser && ddbUser.fcmToken) {
                const message = new gcm.Message({
                  data: {
                    type: 'newCarrot',
                    carrotRideID: carrotRecord.doc.rideID,
                    carroterName: `${carrotUser.firstName} ${carrotUser.lastName}`,
                  },
                  priority: 'high'
                });
                console.log(message)
                gcmClient.send(
                  message,
                  {registrationTokens: [ddbUser.fcmToken.S]},
                  (err, response) => {
                    if (err) {
                      console.log(err)
                      throw err
                    } else {
                      console.log('FCM send response: ============')
                      console.log(response);
                    }
                  }
                );
              }
            })
          })
        }
      })
  }
}

function newRideNotification (rideRecord, slouch, gcmClient, ddbService) {
  if (rideRecord.doc && rideRecord.doc.type === 'ride'
    && rideRecord.doc._rev.split('-')[0] === '1'
    && rideRecord.doc.isPublic === true) {
    const userID = rideRecord.doc.userID
    if (!userID) {
      throw Error('wut why not')
    }

    const followersPromise = slouch.db.viewArray(
      USERS_DB,
      USERS_DESIGN_DOC,
      'followers',
      {key: `"${userID}"`}
    )
    const userPromise = slouch.doc.get(USERS_DB, rideRecord.doc.userID)
    let foundUser
    Promise.all([followersPromise, userPromise]).then(([followers, userRecord]) => {
      foundUser = userRecord
      return Promise.all(followers.rows.map((followerFromView) => {
        return ddbService.getItem(TABLE_NAME, {id: {S: followerFromView.value}})
      }))
    }).then((ddbRecords) => {
      const allTokens = ddbRecords.reduce((accum, ddbRecord) => {
        if (ddbRecord && ddbRecord.fcmToken.S) {
          accum.push(ddbRecord.fcmToken.S)
        }
        return accum
      }, [])

      if (allTokens.length) {
        const message = new gcm.Message({
          data: {
            type: 'newRide',
            rideID: rideRecord.doc._id,
            userID: rideRecord.doc.userID,
            userName: `${foundUser.firstName} ${foundUser.lastName}`,
            distance: rideRecord.doc.distance,
          },
          priority: 'high'
        });
        gcmClient.send(
          message,
          {registrationTokens: allTokens},
          (err, response) => {
            if (err) {
              throw err
            } else {
              console.log('FCM send response: ============')
              console.log(response);
            }
          }
        );
      }
    }).catch(e => {
      Sentry.captureException(e)
      console.log(e)
    })
  }
}

function newCommentNotification (commentRecord, slouch, gcmClient, ddbService) {
  if (commentRecord.doc && commentRecord.doc.type === 'comment'
    && commentRecord.doc._rev.split('-')[0] === '1') {
    const ridePromise = slouch.doc.get(RIDES_DB, commentRecord.doc.rideID, {include_docs: true})
    const commentUsersPromise = slouch.db.viewArray(
      RIDES_DB,
      RIDES_DESIGN_DOC,
      'commentUsers',
      { key: `"${commentRecord.doc.rideID}"` }
    )
    let foundUser
    const userPromise = slouch.doc.get(USERS_DB, commentRecord.doc.userID)
    Promise.all([ridePromise, commentUsersPromise, userPromise]).then(([ride, commentUsers, user]) => {
      console.log('promises promises')
      foundUser = user
      let userIDs = {}
      if (user._id !== ride.userID) {
        userIDs[ride.userID] = true
      }
      userIDs = Object.keys(commentUsers.rows.reduce((accum, commentUser) => {
        const rideID = commentUser.key
        const commentID = commentUser.id
        const commentorUserID = commentUser.value
        if (commentorUserID !== user._id) {
          accum[commentUser.value] = true
        }
        return accum
      }, userIDs))
      return Promise.all(userIDs.map((userID) => {
        return ddbService.getItem(TABLE_NAME, {id: {S: userID}})
      }))
    }).then(ddbRecords => {
      const allTokens = ddbRecords.reduce((accum, ddbRecord) => {
        if (ddbRecord && ddbRecord.fcmToken.S && ddbRecord.distribution && ddbRecord.distribution.N > 40) {
          accum.push(ddbRecord.fcmToken.S)
        }
        return accum
      }, [])
      console.log(allTokens)


      if (allTokens.length) {
        const message = new gcm.Message({
          data: {
            type: 'newComment',
            commentRideID: commentRecord.doc.rideID,
            commenterName: `${foundUser.firstName} ${foundUser.lastName}`,
            comment: commentRecord.doc.comment
          },
          priority: 'high'
        });
        gcmClient.send(
          message,
          {registrationTokens: allTokens},
          (err, response) => {
            if (err) {
              console.log(err)
              console.log(response)
              throw err
            } else {
              console.log('FCM send response: ============')
              console.log(response);
            }
          }
        );
      } else {
        console.log('no one to send alerts to :(')
      }
    }).catch((e) => {
      console.log(e)
    })
  }
}
