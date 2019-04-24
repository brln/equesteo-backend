export const RIDES_DESIGN_DOC = '_design/rides'
export const RIDES_DB = 'rides'

export function createRidesDesignDoc (slouch) {
  slouch.db.create(RIDES_DB).then(() => {
    slouch.doc.createOrUpdate(RIDES_DB, {
      _id: RIDES_DESIGN_DOC,
      views: {
        ridesByID: {
          map: function (doc) {
            if (doc.type === 'ride') {
              emit(doc.id, null);
            }
          }.toString()
        },
        ridesByStartTime: {
          map: function (doc) {
            if (doc.type === 'ride') {
              emit(doc.startTime, null);
            }
          }.toString()
        },
        rideData: {
          map: function (doc) {
            if (doc.type === 'ride') {
              emit(doc._id, null)
            } else if (doc.type === 'rideHorse' || doc.type === 'rideElevations' || doc.type === 'rideCoordinates') {
              emit(doc.rideID, null)
            }
          }.toString()
        },
        commentUsers: {
          map: function (doc) {
            if( doc.type === 'comment') {
              emit( doc.rideID, doc.userID );
            }
          }.toString()
        },
        rideHorsesByRide: {
          map: function (doc) {
            if (doc.type === 'rideHorse' && doc.deleted !== true) {
              emit(doc.rideID, null)
            }
          }.toString()
        },
        ridePhotos: {
          map: function (doc) {
            if (doc.type === 'ridePhoto') {
              emit(doc._id, null)
            }
          }.toString()
        },
        followingRideDocIDs: {
          map: function (doc) {
            if (doc.deleted !== true && doc.type !== 'rideAtlasEntry') {
              emit(doc.userID)
            }
          }.toString()
        },
        followerRideDocIDs: {
          map: function (doc) {
            if (doc.deleted !== true) {
              if (
                doc.type === 'comment'
                || doc.type === 'carrot'
                || doc.type === 'ridePhoto'
                || doc.type === 'rideHorse'
              ) {
                emit(doc.userID)
              }
            }
          }.toString()
        },
        atlasEntryDocIDs: {
          map: function (doc) {
            if (doc.deleted !== true && doc.type === 'rideAtlasEntry') {
              emit(doc.userID)
            }
          }.toString()
        },
        ridesByDay: {
          map: function (doc) {
            if (doc.type === 'ride' && doc.deleted !== true) {
              var now = new Date(doc.startTime);
              now.setTime(now.getTime() - 7 * 60 * 60 * 1000) // timezone adjustment, yay CA
              var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
              startOfDay.setTime(startOfDay.getTime() + 7 * 60 * 60 * 1000) // TZ adjust
              var timestamp = (startOfDay) / 1000
              emit(timestamp, 1)
            }
          }.toString(),
          reduce: '_count'
        },
      },
      filters: {
        byUserIDs: function (doc, req) {
          let userIDs = req.query.userIDs.split(',');
          let ownID = req.query.ownUserID
          let followerIDs = req.query.followerUserIDs.split(',');
          if (doc.deleted) {
            return false;
          } else {
            return userIDs.indexOf(doc.userID) >= 0
              || (doc.type === 'comment' && followerIDs.indexOf(doc.userID) >= 0)
              || (doc.type === 'carrot' && followerIDs.indexOf(doc.userID) >= 0)
              || (doc.type === 'ridePhoto' && followerIDs.indexOf(doc.userID) >= 0)
              || (doc.type === 'rideHorse' && followerIDs.indexOf(doc.userID) >= 0)
              || (doc.type === 'rideAtlasEntry' && doc.userID === ownID)
          }
        }.toString()
      }
    })
  })
}
