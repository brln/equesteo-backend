import gcm from 'node-gcm'
import * as Sentry from '@sentry/node'

import { USERS_DB, USERS_DESIGN_DOC } from "../design_docs/users"
import { RIDES_DB, RIDES_DESIGN_DOC } from "../design_docs/rides"

const TABLE_NAME = 'equesteo_fcm_tokens'

export default function startRideChangeIterator(slouch, gcmClient, ddbService) {
  let iterator = slouch.db.changes('rides', {
    include_docs: true,
    feed: 'continuous',
    heartbeat: true,
    since: 'now'
  })

  iterator.each((rideRecord) => {
    console.log('ride change iterator running')
    newRideNotification(rideRecord, slouch, gcmClient, ddbService)
    newCommentNotification(rideRecord, slouch, gcmClient, ddbService)
    newCarrotNotification(rideRecord, slouch, gcmClient, ddbService)
  })
}

function newCarrotNotification(carrotRecord, slouch, gcmClient, ddbService) {
  if (carrotRecord.doc && carrotRecord.doc.type === 'carrot'
    && carrotRecord.doc._rev.split('-')[0] === '1') {
      slouch.doc.get(RIDES_DB, carrotRecord.doc.rideID, {include_docs: true}).then(ride => {
        if (carrotRecord.doc.userID !== ride.userID) {
          slouch.doc.get(USERS_DB, ride.userID).then(foundUser => {
            ddbService.getItem(TABLE_NAME, {id: {S: foundUser._id}}).then(ddbUser => {
              if (ddbUser && ddbUser.fcmToken) {
                const message = new gcm.Message({
                  data: {
                    type: 'newCarrot',
                    carrotRideID: carrotRecord.doc.rideID,
                    carroterName: `${foundUser.firstName} ${foundUser.lastName}`,
                  },
                  priority: 'high'
                });
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
        console.log(followerFromView)
        return ddbService.getItem(TABLE_NAME, {id: {S: followerFromView.value._id}})
      }))
    }).then((ddbRecords) => {
      const allTokens = ddbRecords.reduce((accum, ddbRecord) => {
        if (ddbRecord && ddbRecord.fcmToken.S) {
          accum.push(ddbRecord.fcmToken.S)
        }
        return accum
      }, [])

      console.log(allTokens)
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
