export const USERS_DB = 'users'
export const USERS_DESIGN_DOC = '_design/users'

export function createUsersDesignDoc (slouch) {
  slouch.db.create(USERS_DB).then(() => {
    slouch.doc.createOrUpdate(USERS_DB, {
      _id: USERS_DESIGN_DOC,
      views: {
        by_email: {
          map: function (doc) { emit(doc.email, doc.password); }.toString()
        },
        following: {
          map: function (doc) {
            if( doc.type === 'follow') {
              emit( doc.followerID, doc.followingID );
            }
          }.toString()
        },
        followers: {
          map: function (doc) {
            if( doc.type === 'follow') {
              emit( doc.followingID, doc.followerID );
            }
          }.toString()
        }
      },
      filters: {
        byUserIDs: function (doc, req) {
          let userIDs = req.query.userIDs.split(',');
          if (userIDs.indexOf(doc._id) >= 0
              || userIDs.indexOf(doc.followingID) >= 0
              || userIDs.indexOf(doc.followerID) >= 0) {
            return true
          }
        }.toString()
      }
    })
  })
}

