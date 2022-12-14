export const USERS_DB = 'users'
export const USERS_DESIGN_DOC = '_design/users'

export function createUsersDesignDoc (slouch) {
  slouch.db.create(USERS_DB).then(() => {
    slouch.doc.createOrUpdate(USERS_DB, {
      _id: USERS_DESIGN_DOC,
      validate_doc_update: function (newDoc, oldDoc, userCtx, secObj) {
        const sourceUserID = userCtx.name
        if (sourceUserID === 'equesteo') {
          return
        }

        if (oldDoc && oldDoc.type !== newDoc.type) {
          log('bad user update 1')
          throw({forbidden: `Bad user doc update 1: ${newDoc._id}, ${sourceUserID}`});
        }

        if (!oldDoc && newDoc.type === 'follow' && newDoc.followerID !== sourceUserID) {
          log('bad user update 2')
          throw({forbidden: `Bad user doc update 2: ${newDoc._id}, ${sourceUserID}`});
        }
        if (oldDoc && oldDoc.type === 'follow' && (oldDoc.followerID !== newDoc.followerID || oldDoc.followingID !== newDoc.followingID)) {
          log('bad user update 3')
          throw({forbidden: `Bad user doc update 3: ${newDoc._id}, ${sourceUserID}`});
        }

        if (newDoc.type === 'userPhoto' && newDoc.userID !== sourceUserID) {
          log('bad user update 5')
          throw({forbidden: `Bad user doc update 5: ${newDoc._id}, ${sourceUserID}`});
        }

        if (newDoc.type === 'leaderboards') {
          log('bad user update 6')
          throw({forbidden: `Bad user doc update 6: ${newDoc._id}, ${sourceUserID}`});
        }

        if (newDoc.type === 'training') {
          log('bad user update 4')
          throw({forbidden: `Bad user doc update 4: ${newDoc._id}, ${sourceUserID}`});
        }
      }.toString(),
      views: {
        types: {
          map: function (doc) {
            emit(doc.type, null)
          }.toString(),
          reduce: '_count'
        },
        byID: {
          map: function (doc) {
            if (doc.type === "user") {
              emit(doc._id, null)
            }
          } .toString()
        },
        by_email: {
          map: function (doc) { emit(doc.email, doc.password); }.toString()
        },
        following: {
          map: function (doc) {
            if (doc.type === 'follow' && doc.deleted !== true) {
              emit(doc.followerID, doc.followingID);
            }
          }.toString()
        },
        followers: {
          map: function (doc) {
            if (doc.type === 'follow' && doc.deleted !== true) {
              emit(doc.followingID, doc.followerID );
            }
          }.toString()
        },
        leaderboardUsers: {
          map: function (doc) {
            if (doc.type === 'leaderboards') {
              var userIDs = []
              for (var timePeriod in doc.values) {
                if (doc.values.hasOwnProperty(timePeriod)) {

                  for (var statType in doc.values[timePeriod]) {
                    if (doc.values[timePeriod].hasOwnProperty(statType)) {

                      for (let i = 0; i < doc.values[timePeriod][statType].length; i++) {
                        const pair = doc.values[timePeriod][statType][i]
                        if (userIDs.indexOf(pair.riderID) < 0) {
                          emit(pair.riderID, null)
                          userIDs.push(pair.riderID)
                        }
                      }
                    }
                  }
                }
              }
            }
          }.toString()
        },
        leaderboardOptOuts: {
          map: function (doc) {
            if (doc.type === 'user' && doc.leaderboardOptOut === true) {
              emit(doc._id, null)
            }
          }.toString()
        },
        relevantFollows: {
          map: function (doc) {
            if (doc.type === 'follow' && doc.deleted !== true) {
              emit(doc.followingID, [doc.followerID, 'following'])
              emit(doc.followerID, [doc.followingID, 'follower'])
            }
          }.toString()
        },
        trainingsByUserID: {
          map: function (doc) {
            if (doc.type === 'training') {
              emit(doc.userID, null)
            }
          }.toString()
        },
        userDocIDs: {
          map: function(doc) {
            if (doc.deleted !== true) {
              if (doc.type === 'training' || doc.type === 'userPhoto') {
                emit(doc.userID, null)
              } else if (doc.type === 'user') {
                emit(doc._id, null)
              } else if (doc.type === 'follow') {
                emit(doc.followingID, null)
                emit(doc.followerID, null)
              }
            }
          }.toString()
        },
        trainingsByRideID: {
          map: function (doc) {
            if (doc.type === 'training') {
              for (let i = 0; i < doc.rides.length; i++) {
                emit(doc.rides[i].rideID, i)
              }
            }
          }.toString()
        },
        userCount: {
          map: function (doc) {
            if (doc.type === 'user') {
              emit(doc._id, null)
            }
          }.toString(),
          reduce: '_count'
        },
        usersByDay: {
          map: function (doc) {
            if (doc.type === 'user') {
              var now = new Date(doc.createTime);
              now.setTime(now.getTime() - 7 * 60 * 60 * 1000) // timezone adjustment, yay CA
              var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
              startOfDay.setTime(startOfDay.getTime() + 7 * 60 * 60 * 1000) // TZ adjust
              var timestamp = (startOfDay) / 1000
              emit(timestamp, 1)
            }
          }.toString(),
          reduce: '_count'
        },
        userPhotos: {
          map: function (doc) {
            if (doc.type === 'userPhoto') {
              emit(doc._id, null)
            }
          } .toString()
        },
      },
      filters: {
        byUserIDs: function (doc, req) {
          if (doc.type === 'training' && doc.userID === req.query.ownUserID) {
            return true
          } else if (doc.type === 'user' || doc.type === 'follow') {
            return true
          }
        }.toString(),
        byUserIDs2: function (doc, req) {
          let userIDs = req.query.userIDs.split(',') // All following and followers
          let ownID = req.query.ownUserID
          if (doc.type === 'training' || doc.type === 'userPhoto') {
            if (doc.userID === ownID || userIDs.indexOf(doc.userID) >= 0) {
              return true
            }
          } else if (doc.type === 'user') {
            if (doc._id === ownID || userIDs.indexOf(doc._id) >= 0) {
              return true
            }
          } else if (doc.type === 'follow') {
            if (userIDs.indexOf(doc.followingID) >= 0 || userIDs.indexOf(doc.followerID) >= 0) {
              return true
            }
          } else if (doc.type === 'leaderboards') {
            return true
          }
        }.toString()
      }
    })
  })
}

