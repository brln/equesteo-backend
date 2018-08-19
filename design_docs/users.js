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
              emit( doc.followingID, {_id: doc.followerID} );
            }
          }.toString()
        }
      },
      filters: {
        byUserIDs: function (doc, req) {
          return true
        }.toString()
      }
    })
  })
}

