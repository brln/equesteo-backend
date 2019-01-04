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
      },
      filters: {
        byUserIDs: function (doc, req) {
          let userIDs = req.query.userIDs.split(',');
          let followerIDs = req.query.followerUserIDs.split(',');
          if (doc.deleted) {
            return false;
          } else {
            return userIDs.indexOf(doc.userID) >= 0
              || (doc.type === 'comment' && followerIDs.indexOf(doc.userID) >= 0)
              || (doc.type === 'ridePhoto' && followerIDs.indexOf(doc.userID) >= 0)
              || (doc.type === 'rideHorse' && followerIDs.indexOf(doc.userID) >= 0);
          }
        }.toString()
      }
    })
  })
}
