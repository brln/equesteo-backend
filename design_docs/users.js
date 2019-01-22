export const USERS_DB = 'users'
export const USERS_DESIGN_DOC = '_design/users'

export function createUsersDesignDoc (slouch) {
  slouch.db.create(USERS_DB).then(() => {
    slouch.doc.createOrUpdate(USERS_DB, {
      _id: USERS_DESIGN_DOC,
      views: {
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
            if (doc.type === 'follow') {
              emit(doc.followerID, doc.followingID);
            }
          }.toString()
        },
        followers: {
          map: function (doc) {
            if (doc.type === 'follow') {
              emit(doc.followingID, doc.followerID );
            }
          }.toString()
        },
        relevantFollows: {
          map: function (doc) {
            if (doc.type === 'follow') {
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
        trainingsByRideID: {
          map: function (doc) {
            if (doc.type === 'training') {
              for (let i = 0; i < doc.rides.length; i++) {
                emit(doc.rides[i].rideID, i)
              }
            }
          }.toString()
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
          }
        }.toString()
      }
    })
  })
}

